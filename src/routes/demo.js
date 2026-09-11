'use strict';

const express = require('express');
const router  = express.Router();
const { db }  = require('../services/firebase');
const { sendMessage } = require('../services/whatsapp');
const { normalizePakistaniPhone, maskPhone } = require('../utils/phone');
const { verifyTurnstile } = require('../../lib/turnstile');
const { demoLimiter } = require('../middleware/rateLimiter');
const logger = require('../utils/logger');
const DEMO_WINDOW_MS = 24 * 60 * 60 * 1000;
function genDemoId() { const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let id=''; for(let i=0;i<6;i++) id+=chars[Math.floor(Math.random()*chars.length)]; return id; }
router.get('/demo-config', (req,res) => res.json({ turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '' }));
router.post('/demo', demoLimiter, async (req,res) => {
  try {
    const { name, phone, address, turnstileToken } = req.body;
    if (!name || !phone || !address || !turnstileToken) return res.status(400).json({ error: 'All fields are required.' });
    const normalizedPhone = normalizePakistaniPhone(phone);
    if (!normalizedPhone) return res.status(400).json({ error: 'Invalid phone number. Use a valid Pakistani mobile number.' });
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (!(await verifyTurnstile(turnstileToken, ip))) return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
    const since = new Date(Date.now() - DEMO_WINDOW_MS);
    const existing = await db.collection('demoRequests').where('phone','==',normalizedPhone).where('createdAt','>',since).limit(1).get();
    if (!existing.empty) return res.status(429).json({ error: 'This number already received a demo recently. Try again after 24 hours.' });
    const demoId = 'DEMO-' + genDemoId();
    await sendMessage(normalizedPhone, null, { templateName:'demo_order', buyerName:name.trim(), orderIdDisplay:demoId, items:'PakkOrder Live Demo', totalAmount:'2499', deliveryAddress:address.trim() });
    await db.collection('demoRequests').add({ demoId, name:name.trim(), phone:normalizedPhone, address:address.trim(), status:'sent', isDemo:true, ip, createdAt:new Date() });
    logger.info(`Demo: success demoId=${demoId} for ***${maskPhone(normalizedPhone)}`);
    return res.json({ success:true, message:'Demo sent! Check your WhatsApp in a few seconds.' });
  } catch(err) { logger.error('POST /api/demo error',err); return res.status(500).json({ error:'Failed to send demo. Please try again shortly.' }); }
});
module.exports = router;
