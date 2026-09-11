'use strict';

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cron = require('node-cron');
const logger = require('./src/utils/logger');

const path = require('path');
const admin = require('firebase-admin');

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} else {
  serviceAccount = require(path.resolve(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './serviceAccount.json'
  ));
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: process.env.FIREBASE_PROJECT_ID,
});

logger.info('Firebase Admin SDK initialized');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com", "https://static.cloudflareinsights.com", "https://cdn.jsdelivr.net", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc:  ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://identitytoolkit.googleapis.com", "https://pakkorder.com", "https://cdn.jsdelivr.net", "https://challenges.cloudflare.com"],
      frameSrc: ["https://challenges.cloudflare.com"],
      scriptSrcAttr: ["'unsafe-inline'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  permittedCrossDomainPolicies: false,
}));
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-License-Key', 'Authorization'],
}));
const shopifyWebhookRouter = require('./src/routes/shopify-webhook');
app.use('/shopify-webhook', express.raw({ type: 'application/json' }), shopifyWebhookRouter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/snippet.js', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});
app.use(express.static('public', { maxAge: '1h' }));

const ordersRouter      = require('./src/routes/orders');
const metaWebhookRouter = require('./src/routes/meta-webhook');
const confirmRouter     = require('./src/routes/confirm');
const adminRouter       = require('./src/routes/admin');
const clientRouter      = require('./src/routes/client');
const shopifyAppRouter  = require('./src/routes/shopify-app');
const demoRouter        = require('./src/routes/demo');
const bulkRouter        = require('./src/routes/bulk');

app.use('/', ordersRouter);
app.use('/', metaWebhookRouter);
app.use('/', confirmRouter);
app.use('/admin', adminRouter);
app.use('/api', clientRouter);
app.use('/api', demoRouter);
app.use('/api/bulk', bulkRouter);
app.use('/shopify', shopifyAppRouter);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), version: '1.0.0', provider: 'meta' });
});

app.use((err, req, res, next) => {
  logger.error('Unhandled error in request', err);
  res.status(500).json({ error: 'Internal server error', message: 'Kuch masla aa gaya. Dobara try karein.' });
});

cron.schedule('0 0 1 * *', async () => {
  logger.info('Running monthly order count reset + report send');
  try {
    const { resetAllOrderCounts, resetDailyMessageCount, getAllClients, getClientOrdersBetween } = require('./src/services/firebase');
    const { sendMonthlyReport } = require('./src/services/email');
    const { addToQueue } = require('./src/services/queue');
    await resetAllOrderCounts();
    await resetDailyMessageCount();
    logger.info('Monthly order counts reset for all clients');
    const now = new Date();
    const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const from = new Date(year, month, 1, 0, 0, 0);
    const to = new Date(year, month + 1, 0, 23, 59, 59);
    const monthName = from.toLocaleString('en-US', { month: 'long' });
    const clients = await getAllClients();
    logger.info(`Sending monthly reports to ${clients.length} clients`);
    for (const client of clients) {
      try {
        if (!client.is_active) continue;
        const orders = await getClientOrdersBetween(client.id, from, to);
        if (orders.length === 0) continue;
        await sendMonthlyReport(client, orders, monthName, year);
        if (client.phone) addToQueue(client.phone, `Your PakkOrder report for ${monthName} ${year} is ready! Check your email (${client.email}) for the full stats and order history.`);
      } catch (err) {
        logger.error(`Monthly report failed for client ${client.id}:`, err.message);
      }
    }
    logger.info(`Monthly reports sent for ${monthName} ${year}`);
  } catch (err) {
    logger.error('Monthly reset cron failed', err);
  }
});

cron.schedule('0 0 * * *', async () => {
  logger.info('Running daily message count reset');
  try {
    const { resetDailyMessageCount } = require('./src/services/firebase');
    const { resetMemoryCounters } = require('./src/services/queue');
    await resetDailyMessageCount();
    resetMemoryCounters(true);
    logger.info('Daily message counts reset');
  } catch (err) {
    logger.error('Daily reset cron failed', err);
  }
});

cron.schedule('0 * * * *', async () => {
  logger.info('Running expired order cleanup + retry reminders');
  try {
    const { expireStaleOrders, sendRetryReminders } = require('./src/services/orders');
    await expireStaleOrders();
    await sendRetryReminders();
  } catch (err) {
    logger.error('Hourly cron failed', err);
  }
});

cron.schedule('0 6 * * *', async () => {
  logger.info('Running referral claim check');
  try {
    const { processPendingReferrals } = require('./src/services/referrals');
    await processPendingReferrals();
  } catch (err) {
    logger.error('Referral claim cron failed', err);
  }
});

setTimeout(() => {
  try {
    const { startQueue } = require('./src/services/queue');
    startQueue();
    logger.info('Message queue processor started');
  } catch (err) {
    logger.error('Failed to start queue processor', err);
  }
}, 2000);

process.on('SIGTERM', () => { logger.info('SIGTERM received — shutting down gracefully'); process.exit(0); });
process.on('SIGINT', () => { logger.info('SIGINT received — shutting down gracefully'); process.exit(0); });
process.on('unhandledRejection', (reason) => { logger.error(`Unhandled promise rejection: ${reason}`); });
process.on('uncaughtException', (err) => { logger.error('Uncaught exception — continuing', err); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`PakkOrder server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
