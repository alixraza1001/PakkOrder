'use strict';

const express = require('express');
const router  = express.Router();
const _cache = new Map();
const CACHE_TTL_MS = 60 * 1000;
function getCached(clientId) {
  const entry = _cache.get(clientId);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) { _cache.delete(clientId); return null; }
  return entry.data;
}
function setCached(clientId, data) { _cache.set(clientId, { data, timestamp: Date.now() }); }
function invalidateCache(clientId) { _cache.delete(clientId); }

const jwt = require('jsonwebtoken');
const axios = require('axios');
const https = require('https');
const {
  getClientById, getClientOrdersSince, getClientOrdersBetween, getClientAllOrders,
  getOrderById, updateOrderStatus, incrementClientFakeCaught, updateOnboardingStep,
  getNotifications, markAllNotificationsRead, createNotification, upsertBuyerProfile,
  getBlacklistEntry, addToBlacklist, removeFromBlacklist, getBlacklistCount,
  createAuditLog, getBuyerHistory, db,
} = require('../services/firebase');
const { sendConfirmationEmail, sendContactNotification } = require('../services/email');
const { addToQueue } = require('../services/queue');
const { generalLimiter } = require('../middleware/rateLimiter');
const { ensureReferralCode } = require('../../lib/referral');
const logger = require('../utils/logger');

function verifyClientToken(req, res) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized', message: 'Authorization header missing' });
    return null;
  }
  try { return jwt.verify(authHeader.slice(7), process.env.JWT_SECRET); }
  catch (err) { res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' }); return null; }
}

router.post('/client-login', generalLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Missing fields', message: 'Email and password required' });
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'Login unavailable', message: 'Firebase Web API key not configured' });
    let firebaseUid;
    try {
      const resp = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, { email, password, returnSecureToken: true });
      firebaseUid = resp.data.localId;
    } catch (err) {
      const code = err.response?.data?.error?.message || 'INVALID_CREDENTIALS';
      logger.warn(`Login failed for ${email.slice(0, 3)}***: ${code}`);
      return res.status(401).json({ error: 'Invalid credentials', message: 'Email ya password galat hai' });
    }
    const snap = await db.collection('clients').where('email', '==', email.toLowerCase()).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: 'Account not found', message: 'Is email ka koi account nahi mila' });
    const clientDoc = snap.docs[0];
    const client = clientDoc.data();
    if (!client.is_active) return res.status(403).json({ error: 'Account suspended', message: 'Aapka account suspend hai' });
    const token = jwt.sign({ client_id: clientDoc.id, email: client.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    logger.info(`Client login: ${clientDoc.id}`);
    ensureReferralCode(clientDoc.id).catch(() => {});
    return res.status(200).json({ success: true, token });
  } catch (err) {
    logger.error('POST /api/client-login error', err);
    return res.status(500).json({ error: 'Internal server error', message: 'Login mein masla aaya' });
  }
});

router.get('/order-check', generalLimiter, async (req, res) => {
  try {
    const payload = verifyClientToken(req, res); if (!payload) return;
    const snap = await db.collection('orders').where('client_id', '==', payload.client_id).orderBy('created_at', 'desc').limit(1).get();
    if (snap.empty) return res.json({ latest_id: null });
    const doc = snap.docs[0];
    return res.json({ latest_id: doc.id, order_id: doc.data().order_id, status: doc.data().status });
  } catch (err) { logger.error('GET /api/order-check error', err); return res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/forgot-password', generalLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    const apiKey = process.env.FIREBASE_WEB_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'Service unavailable' });
    await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`, { requestType: 'PASSWORD_RESET', email: email.trim().toLowerCase() });
  } catch (_) {}
  return res.json({ success: true });
});

router.get('/client-data', generalLimiter, async (req, res) => {
  try {
    const payload = verifyClientToken(req, res); if (!payload) return;
    const force = req.query.force === 'true';
    if (!force) { const cached = getCached(payload.client_id); if (cached) return res.status(200).json(cached); }
    const client = await getClientById(payload.client_id);
    if (!client) return res.status(404).json({ error: 'Client not found', message: 'Account nahi mila' });
    const since = new Date(); since.setDate(since.getDate() - 30);
    const allOrders = await getClientOrdersSince(client.id, since);
    const total = allOrders.length;
    const confirmed = allOrders.filter(o => o.status === 'confirmed').length;
    const cancelled = allOrders.filter(o => o.status === 'cancelled').length;
    const expired = allOrders.filter(o => o.status === 'expired').length;
    const pending = allOrders.filter(o => o.status === 'pending').length;
    const blacklisted_orders = allOrders.filter(o => o.status === 'blacklisted').length;
    const fake_caught = cancelled + expired;
    const money_saved = fake_caught * 500;
    const confirmation_rate = total > 0 ? Math.round((confirmed / total) * 100) : 0;
    let blacklisted_count = 0; try { blacklisted_count = await getBlacklistCount(); } catch (_) {}
    const all_time_fake = client.all_time_fake_caught || fake_caught;
    const daily_trend = [];
    try {
      for (let i = 29; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i); const key = d.toISOString().slice(0, 10);
        const dayOrders = allOrders.filter(o => { const ts = o.created_at?.toDate ? o.created_at.toDate() : new Date(o.created_at); return ts.toISOString().slice(0, 10) === key; });
        const dayTotal = dayOrders.length; const dayConfirmed = dayOrders.filter(o => o.status === 'confirmed').length;
        daily_trend.push({ date: key, rate: dayTotal > 0 ? Math.round((dayConfirmed / dayTotal) * 100) : null, total: dayTotal });
      }
    } catch (_) {}
    const city_breakdown = [];
    try {
      const cityMap = {};
      allOrders.forEach(o => { const city = o.buyer_city || 'Unknown'; if (!cityMap[city]) cityMap[city] = { total: 0, confirmed: 0, cancelled: 0 }; cityMap[city].total++; if (o.status === 'confirmed') cityMap[city].confirmed++; if (o.status === 'cancelled' || o.status === 'expired') cityMap[city].cancelled++; });
      Object.entries(cityMap).map(([city, s]) => ({ city, total: s.total, confirmed: s.confirmed, cancelled: s.cancelled, fake_rate: s.total > 0 ? Math.round((s.cancelled / s.total) * 100) : 0 })).sort((a, b) => b.fake_rate - a.fake_rate).slice(0, 5).forEach(r => city_breakdown.push(r));
    } catch (_) {}
    const plan = client.plan || 'starter';
    const plan_features = { show_analytics: plan !== 'starter', show_robo_call: plan !== 'starter', show_custom_templates: plan === 'pro', show_number_status: plan === 'pro', show_risk_score: plan !== 'starter', show_blacklist_manual: plan !== 'starter', order_limit: client.order_limit };
    const onboarding_steps = { storeConnected: client.onboardingSteps?.storeConnected ?? true, whatsappConnected: client.onboardingSteps?.whatsappConnected ?? false, firstOrder: client.onboardingSteps?.firstOrder ?? false, firstConfirmation: client.onboardingSteps?.firstConfirmation ?? false, firstFakeCaught: client.onboardingSteps?.firstFakeCaught ?? false };
    const wa_number = process.env.META_WHATSAPP_NUMBER || null; const wa_group = client.whatsappGroup || 'shared';
    let unread_notifications = 0; try { const notifs = await getNotifications(client.id); unread_notifications = notifs.filter(n => !n.read).length; } catch (_) {}
    const orders = allOrders.slice(0, 50).map(o => ({ id: o.id, order_id: o.order_id, store_name: o.store_name, buyer_phone: '***' + String(o.buyer_phone).slice(-4), buyer_city: o.buyer_city || null, buyer_name: o.buyer_name || null, order_amount: o.order_amount || null, status: o.status, whatsapp_status: o.whatsapp_status || null, email_status: o.email_status || null, created_at: o.created_at?.toDate ? o.created_at.toDate().toISOString() : o.created_at, confirmed_at: o.confirmed_at?.toDate ? o.confirmed_at.toDate().toISOString() : null, buyerRiskScore: o.buyerRiskScore || null, manuallyUpdated: o.manuallyUpdated || false }));
    const responseData = { client: { name: client.name, email: client.email, domain: client.domain, plan, orders_this_month: client.orders_this_month || 0, order_limit: client.order_limit, license_key: client.license_key, is_active: client.is_active, wa_number, wa_group, created_at: client.created_at?.toDate ? client.created_at.toDate().toISOString() : null }, stats: { total, confirmed, cancelled, pending, expired, blacklisted_orders, fake_orders_caught: fake_caught, money_saved, all_time_money_saved: all_time_fake * 500, confirmation_rate, blacklisted_count }, daily_trend, city_breakdown, onboarding_steps, unread_notifications, orders, plan_features };
    setCached(payload.client_id, responseData);
    return res.status(200).json(responseData);
  } catch (err) { logger.error('GET /api/client-data error', err); return res.status(500).json({ error: 'Internal server error', message: 'Data load karte waqt masla aaya' }); }
});

router.get('/order-detail/:orderId', generalLimiter, async (req, res) => {
  try {
    const payload = verifyClientToken(req, res); if (!payload) return;
    const order = await getOrderById(req.params.orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.client_id !== payload.client_id) return res.status(403).json({ error: 'Forbidden' });
    let buyerBlacklisted = false;
    if (order.buyer_phone) { try { buyerBlacklisted = !!(await getBlacklistEntry(order.buyer_phone)); } catch (_) {} }
    return res.status(200).json({ id: order.id, order_id: order.order_id, store_name: order.store_name, buyer_phone: order.buyer_phone, buyer_email: order.buyer_email || null, buyer_name: order.buyer_name || null, buyer_city: order.buyer_city || null, order_details: order.order_details, order_amount: order.order_amount || null, status: order.status, whatsapp_status: order.whatsapp_status || null, email_status: order.email_status || null, buyerRiskScore: order.buyerRiskScore || null, manuallyUpdated: order.manuallyUpdated || false, updatedBy: order.updatedBy || null, updateReason: order.updateReason || null, cancelReason: order.cancelReason || null, buyerBlacklisted, created_at: order.created_at?.toDate ? order.created_at.toDate().toISOString() : order.created_at, confirmed_at: order.confirmed_at?.toDate ? order.confirmed_at.toDate().toISOString() : null, cancelled_at: order.cancelled_at?.toDate ? order.cancelled_at.toDate().toISOString() : null, expires_at: order.expires_at?.toDate ? order.expires_at.toDate().toISOString() : null });
  } catch (err) { logger.error('GET /api/order-detail error', err); return res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/order-action', generalLimiter, async (req, res) => {
  try {
    const payload = verifyClientToken(req, res); if (!payload) return;
    const { orderId, action } = req.body;
    if (!orderId || !action) return res.status(400).json({ error: 'orderId and action required' });
    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.client_id !== payload.client_id) return res.status(403).json({ error: 'Forbidden' });
    if (action === 'confirm') { await updateOrderStatus(orderId, 'confirmed'); updateOnboardingStep(payload.client_id, 'firstConfirmation').catch(() => {}); createNotification(payload.client_id, { type: 'confirmed', message: `Order #${order.order_id} marked confirmed`, orderId }).catch(() => {}); return res.json({ success: true }); }
    if (action === 'cancel') { await updateOrderStatus(orderId, 'cancelled'); updateOnboardingStep(payload.client_id, 'firstFakeCaught').catch(() => {}); createNotification(payload.client_id, { type: 'cancelled', message: `Order #${order.order_id} cancelled`, orderId }).catch(() => {}); incrementClientFakeCaught(payload.client_id).catch(() => {}); return res.json({ success: true }); }
    if (action === 'resend-wa') {
      if (!order.buyer_phone) return res.status(400).json({ error: 'No phone on order' });
      const deliveryAddress = [order.buyer_address, order.buyer_city].filter(Boolean).join(', ') || 'Pakistan';
      addToQueue(order.buyer_phone, null, order.order_id, payload.client_id, orderId, { buyerName: order.buyer_name || 'Valued Customer', orderIdDisplay: '#' + String(order.order_id), items: order.order_details || '', totalAmount: String(order.order_amount || ''), deliveryAddress });
      return res.json({ success: true });
    }
    if (action === 'resend-email') {
      if (!order.buyer_email) return res.status(400).json({ error: 'No email on order' });
      await sendConfirmationEmail({ buyerEmail: order.buyer_email, storeName: order.store_name, orderDetails: order.order_details, orderId, storeOrderId: order.order_id, clientId: payload.client_id });
      return res.json({ success: true });
    }
    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) { logger.error('POST /api/order-action error', err); return res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/notifications', generalLimiter, async (req, res) => {
  try { const payload = verifyClientToken(req, res); if (!payload) return; const notifs = await getNotifications(payload.client_id); return res.json({ notifications: notifs.map(n => ({ id: n.id, type: n.type, message: n.message, orderId: n.orderId || null, read: n.read, timestamp: n.timestamp?.toDate ? n.timestamp.toDate().toISOString() : null })) }); }
  catch (err) { logger.error('GET /api/notifications error', err); return res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/notifications/read-all', generalLimiter, async (req, res) => { try { const payload = verifyClientToken(req, res); if (!payload) return; await markAllNotificationsRead(payload.client_id); return res.json({ success: true }); } catch (err) { logger.error('POST /api/notifications/read-all error', err); return res.status(500).json({ error: 'Internal server error' }); } });

router.patch('/orders/:orderId/status', generalLimiter, async (req, res) => {
  try {
    const payload = verifyClientToken(req, res); if (!payload) return;
    const { orderId } = req.params; const { status, reason } = req.body;
    const validStatuses = ['confirmed', 'cancelled', 'expired'];
    if (!status || !validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status. Must be confirmed, cancelled, or expired.' });
    const order = await getOrderById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.client_id !== payload.client_id) return res.status(403).json({ error: 'Forbidden' });
    const previousStatus = order.status;
    const fb = require('firebase-admin').firestore.Timestamp;
    const extra = { manuallyUpdated: true, updatedBy: 'manual', updatedAt: fb.now(), updateReason: reason || null };
    if (status === 'confirmed') { extra.confirmedAt = fb.now(); extra.confirmation_method = 'manual'; }
    else if (status === 'cancelled') { extra.cancelled_at = fb.now(); extra.cancelReason = reason || 'Manually cancelled by seller'; }
    else if (status === 'expired') extra.cancelled_at = fb.now();
    await updateOrderStatus(orderId, status, extra);
    if (order.buyer_phone) { const inc = {}; if (status === 'confirmed') inc.confirmedOrders = 1; if (status === 'cancelled') inc.cancelledOrders = 1; if (status === 'expired') inc.ghostedOrders = 1; upsertBuyerProfile(order.buyer_phone, inc).catch(() => {}); }
    createAuditLog(payload.client_id, { orderId, previousStatus, newStatus: status, updatedBy: 'manual', reason: reason || '' }).catch(() => {});
    createNotification(payload.client_id, { type: status, message: { confirmed: `Order #${order.order_id} manually confirmed`, cancelled: `Order #${order.order_id} manually cancelled`, expired: `Order #${order.order_id} manually expired` }[status], orderId }).catch(() => {});
    if (status === 'confirmed') updateOnboardingStep(payload.client_id, 'firstConfirmation').catch(() => {});
    if (status === 'cancelled') updateOnboardingStep(payload.client_id, 'firstFakeCaught').catch(() => {});
    if (status === 'cancelled' || status === 'expired') _cancelShopifyOrder(payload.client_id, order.order_id).catch(err => logger.error(`Shopify cancel failed for order ${orderId}`, err));
    return res.json({ success: true, status, previousStatus });
  } catch (err) { logger.error('PATCH /api/orders/:orderId/status error', err); return res.status(500).json({ error: 'Internal server error' }); }
});

async function _cancelShopifyOrder(clientId, shopifyOrderId) {
  if (!shopifyOrderId) return;
  try {
    const client = await getClientById(clientId); if (!client?.myshopify_domain) return;
    const shopDomain = client.myshopify_domain; const storeSnap = await db.collection('shopify_stores').doc(shopDomain).get();
    if (!storeSnap.exists) return; const { access_token: accessToken } = storeSnap.data(); if (!accessToken) return;
    await new Promise((resolve, reject) => { const body = JSON.stringify({ reason: 'customer' }); const options = { hostname: shopDomain, path: `/admin/api/2024-01/orders/${shopifyOrderId}/cancel.json`, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken, 'Content-Length': Buffer.byteLength(body) } }; const r = https.request(options, (resp) => { resp.resume(); resp.on('end', resolve); }); r.on('error', reject); r.write(body); r.end(); });
  } catch (err) { logger.error('_cancelShopifyOrder failed', err); }
}

router.post('/blacklist/add', generalLimiter, async (req, res) => {
  try { const payload = verifyClientToken(req, res); if (!payload) return; const { orderId, reason } = req.body; if (!orderId) return res.status(400).json({ error: 'orderId required' }); const client = await getClientById(payload.client_id); if (!client) return res.status(404).json({ error: 'Client not found' }); if (client.plan === 'starter') return res.status(403).json({ error: 'Manual blacklisting requires Growth plan or above' }); const order = await getOrderById(orderId); if (!order) return res.status(404).json({ error: 'Order not found' }); if (order.client_id !== payload.client_id) return res.status(403).json({ error: 'Forbidden' }); const phone = order.buyer_phone; if (!phone) return res.status(400).json({ error: 'No phone on order' }); await addToBlacklist(phone, { reason: reason || 'Manually blacklisted by seller', addedBy: payload.client_id, orderCount: 0 }); createNotification(payload.client_id, { type: 'blacklisted', message: `Buyer ${phone.slice(-4)} added to blacklist`, orderId }).catch(() => {}); return res.json({ success: true, phone }); }
  catch (err) { logger.error('POST /api/blacklist/add error', err); return res.status(500).json({ error: 'Internal server error' }); }
});
router.post('/blacklist/remove', generalLimiter, async (req, res) => { try { const payload = verifyClientToken(req, res); if (!payload) return; const { phone } = req.body; if (!phone) return res.status(400).json({ error: 'phone required' }); await removeFromBlacklist(phone); return res.json({ success: true }); } catch (err) { logger.error('POST /api/blacklist/remove error', err); return res.status(500).json({ error: 'Internal server error' }); } });

router.get('/export-csv', generalLimiter, async (req, res) => {
  try {
    const payload = verifyClientToken(req, res); if (!payload) return; let orders; let fileLabel;
    if (req.query.from && req.query.to) { const from = new Date(req.query.from); const to = new Date(req.query.to); to.setHours(23,59,59,999); if (isNaN(from) || isNaN(to)) return res.status(400).json({ error: 'Invalid date range' }); orders = await getClientOrdersBetween(payload.client_id, from, to); fileLabel = req.query.from.slice(0,7); }
    else { const since = new Date(); since.setDate(1); since.setHours(0,0,0,0); orders = await getClientOrdersSince(payload.client_id, since, 10000); fileLabel = new Date().toISOString().slice(0,7); }
    const cols = ['Order ID','Store','Buyer Name','Phone','City','Amount','Status','WA Status','Email Status','Time (PKT)'];
    const rows = orders.map(o => { const ts = o.created_at?.toDate ? o.created_at.toDate() : new Date(o.created_at); const pkt = ts.toLocaleString('en-PK',{timeZone:'Asia/Karachi',hour12:true}); const phone = '="' + String(o.buyer_phone || '') + '"'; return [o.order_id||'',o.store_name||'',o.buyer_name||'',phone,o.buyer_city||'',o.order_amount||'',o.status||'',o.whatsapp_status||'',o.email_status||'',pkt].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','); });
    const csv = [cols.join(','), ...rows].join('\r\n'); res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition',`attachment; filename="pakkorder-${fileLabel}.csv"`); return res.send(csv);
  } catch (err) { logger.error('GET /api/export-csv error', err); return res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/referral-stats', generalLimiter, async (req, res) => {
  try { const payload = verifyClientToken(req, res); if (!payload) return; const client = await getClientById(payload.client_id); if (!client) return res.status(404).json({ error: 'Client not found' }); const referralCode = await ensureReferralCode(payload.client_id); const snap = await db.collection('referrals').where('referrerClientId','==',payload.client_id).get(); const referrals = snap.docs.map(d => { const r=d.data(); return { newClientName:r.newClientName,newClientEmail:r.newClientEmail,signupDate:r.signupDate?.toDate?.()?.toISOString()||null,claimedDate:r.claimedDate?.toDate?.()?.toISOString()||null,status:r.status,_ts:r.signupDate?.toMillis?.()||0 }; }).sort((a,b)=>b._ts-a._ts).map(({_ts,...r})=>r); return res.json({ referralCode: referralCode || client.referralCode || null, referralCreditsEarned: client.referralCreditsEarned || 0, nextMonthFree: client.nextMonthFree || false, referrals }); }
  catch (err) { logger.error('GET /api/referral-stats error', err); return res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/buyer-lookup', generalLimiter, async (req, res) => { try { const payload=verifyClientToken(req,res); if(!payload)return; const {phone}=req.query; if(!phone)return res.status(400).json({error:'phone query param required'}); const {normalizePakistaniPhone}=require('../utils/phone'); const normalized=normalizePakistaniPhone(phone); if(!normalized)return res.status(400).json({error:'Invalid phone number'}); return res.json(await getBuyerHistory(normalized)); } catch(err){ logger.error('GET /api/buyer-lookup error',err); return res.status(500).json({error:'Internal server error'});} });

router.post('/contact', generalLimiter, async (req, res) => {
  try { const { full_name,email,phone,website,monthly_orders,message,referral_code }=req.body; if(!full_name||!email||!phone||!website||!monthly_orders)return res.status(400).json({error:'Missing required fields'}); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return res.status(400).json({error:'Invalid email address'}); await db.collection('contact_submissions').add({full_name,email,phone,website,monthly_orders,message:message||'',referral_code:referral_code||null,submitted_at:new Date(),status:'new'}); sendContactNotification({fullName:full_name,email,phone,website,monthlyOrders:monthly_orders,message:message||'',referralCode:referral_code||null}); logger.info(`Contact form submission from ${email}`); return res.json({success:true}); }
  catch(err){ logger.error('POST /api/contact error',err); return res.status(500).json({error:'Internal server error'}); }
});

module.exports = router;
