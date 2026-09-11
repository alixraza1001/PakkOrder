'use strict';

const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { adminLimiter } = require('../middleware/rateLimiter');
const adminAuth = require('../middleware/adminAuth');
const { createClient, getClientById, getAllClients, updateClientFields, PLAN_LIMITS } = require('../services/firebase');
const { generateLicenseKey } = require('../utils/license');
const { normalizePakistaniPhone } = require('../utils/phone');
const { db } = require('../services/firebase');
const logger = require('../utils/logger');

router.post('/create-client', adminLimiter, adminAuth, async (req, res) => {
  try {
    const { name, email, phone, domain, plan, wa_phone_number_id, wa_access_token } = req.body;
    const missing = [];
    if (!name)  missing.push('name');
    if (!email) missing.push('email');
    if (!phone) missing.push('phone');
    if (missing.length) {
      return res.status(400).json({ error: 'Missing required fields', message: `Required fields missing: ${missing.join(', ')}` });
    }
    const normalizedPhone = normalizePakistaniPhone(phone);
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'Invalid Pakistani mobile number', message: 'Please provide a valid Pakistani mobile number' });
    }
    const resolvedPlan = plan && PLAN_LIMITS[plan] !== undefined ? plan : 'starter';
    const orderLimit   = PLAN_LIMITS[resolvedPlan];
    const cleanDomain = domain
      ? domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase().trim()
      : 'manual';
    const licenseKey = await generateLicenseKey();
    const clientId = await createClient({
      name: name.trim(), email: email.trim().toLowerCase(), phone: normalizedPhone,
      domain: cleanDomain, license_key: licenseKey, plan: resolvedPlan,
      order_limit: orderLimit, wa_phone_number_id: wa_phone_number_id || null,
      wa_access_token: wa_access_token || null,
    });
    logger.info(`New client created: ${clientId} — ${name} (${cleanDomain})`);
    return res.status(200).json({ success: true, client_id: clientId, license_key: licenseKey, plan: resolvedPlan, order_limit: orderLimit });
  } catch (err) {
    logger.error('POST /admin/create-client error', err);
    return res.status(500).json({ error: 'Internal server error', message: 'Client create karte waqt masla aaya.' });
  }
});

router.post('/create-client-full', adminLimiter, adminAuth, async (req, res) => {
  const { name, email, password, phone, domain, plan, referralCode, wa_phone_number_id, wa_access_token } = req.body;
  const missing = [];
  if (!name) missing.push('name');
  if (!email) missing.push('email');
  if (!password) missing.push('password');
  if (!phone) missing.push('phone');
  if (!plan) missing.push('plan');
  if (missing.length) return res.status(400).json({ error: 'Missing required fields', message: `Required fields missing: ${missing.join(', ')}` });
  if (PLAN_LIMITS[plan] === undefined) return res.status(400).json({ error: 'Invalid plan', message: `Valid plans: ${Object.keys(PLAN_LIMITS).join(', ')}` });

  const resolvedWhatsappNumber = 'shared';
  const normalizedPhone = normalizePakistaniPhone(phone);
  if (!normalizedPhone) return res.status(400).json({ error: 'Invalid Pakistani mobile number', message: 'Please provide a valid Pakistani mobile number' });
  const cleanDomain = domain ? domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase().trim() : 'manual';
  const orderLimit = PLAN_LIMITS[plan];
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();

  let licenseKey;
  try { licenseKey = await generateLicenseKey(); }
  catch (err) {
    logger.error('create-client-full: license key generation failed', err);
    return res.status(500).json({ error: 'Internal server error', message: 'License key generate nahi ho saka.' });
  }

  let authUser;
  try {
    authUser = await admin.auth().createUser({ email: cleanEmail, password, displayName: cleanName });
    logger.info(`Auth user created: ${authUser.uid} — ${cleanEmail}`);
  } catch (err) {
    logger.error(`create-client-full: Firebase Auth creation failed for ${cleanEmail}`, err);
    const code = err.code || '';
    if (code === 'auth/email-already-exists') return res.status(409).json({ error: 'Email already exists', message: 'Is email se pehle se ek account hai.' });
    if (code === 'auth/invalid-password') return res.status(400).json({ error: 'Weak password', message: 'Password kam az kam 6 characters ka hona chahiye.' });
    return res.status(500).json({ error: 'Auth creation failed', message: 'Firebase Auth user banana fail ho gaya.' });
  }

  let clientId;
  try {
    clientId = await createClient({
      name: cleanName, email: cleanEmail, phone: normalizedPhone, domain: cleanDomain,
      license_key: licenseKey, plan, order_limit: orderLimit, auth_uid: authUser.uid,
      whatsapp_number: resolvedWhatsappNumber, wa_phone_number_id: wa_phone_number_id || null,
      wa_access_token: wa_access_token || null,
    });
    logger.info(`Client created: ${clientId} — ${cleanName} (${cleanDomain}) [${plan}]`);

    if (referralCode) {
      const cleanCode = referralCode.trim().toUpperCase();
      try {
        const referrerSnap = await db.collection('clients').where('referralCode', '==', cleanCode).limit(1).get();
        if (!referrerSnap.empty) {
          const referrerDoc = referrerSnap.docs[0];
          await db.collection('referrals').add({
            referralCode: cleanCode,
            referrerClientId: referrerDoc.id,
            referrerClientName: referrerDoc.data().name,
            referrerClientEmail: referrerDoc.data().email,
            newClientId: clientId,
            newClientName: cleanName,
            newClientEmail: cleanEmail,
            signupDate: new Date(),
            status: 'pending',
            claimedDate: null,
            creditedToReferrer: false,
            notes: '',
          });
          logger.info(`Referral recorded: ${cleanCode} → new client ${clientId}`);
        } else {
          logger.warn(`create-client-full: referral code "${cleanCode}" not found — ignored`);
        }
      } catch (refErr) {
        logger.error('create-client-full: referral recording failed (non-fatal):', refErr.message);
      }
    }
  } catch (err) {
    logger.error(`create-client-full: Firestore creation failed — rolling back Auth user ${authUser.uid}`, err);
    try { await admin.auth().deleteUser(authUser.uid); logger.info(`Rolled back Auth user ${authUser.uid}`); }
    catch (rollbackErr) { logger.error(`Rollback failed for Auth user ${authUser.uid}`, rollbackErr); }
    return res.status(500).json({ error: 'Internal server error', message: 'Client document banana fail ho gaya.' });
  }

  return res.status(200).json({
    success: true, client_id: clientId, license_key: licenseKey, auth_uid: authUser.uid,
    plan, order_limit: orderLimit, whatsapp_number: resolvedWhatsappNumber,
    dashboard_url: `${process.env.APP_URL}/dashboard/login.html`,
    dashboard_email: cleanEmail,
    snippet: `<script src='${process.env.APP_URL}/snippet.js' data-key='${licenseKey}'></script>`,
  });
});

router.get('/get-shopify-setup/:clientId', adminLimiter, adminAuth, async (req, res) => {
  try {
    const client = await getClientById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const webhookUrl = `${process.env.APP_URL}/shopify-webhook`;
    const webhookSecret = client.shopify_webhook_secret || client.license_key;
    return res.status(200).json({
      webhook_url: webhookUrl,
      webhook_secret: webhookSecret,
      instructions: [
        'Go to Shopify Admin → Settings → Notifications → Webhooks',
        'Click "Add webhook"', 'Event: Order creation', `URL: ${webhookUrl}`,
        'Format: JSON', 'Click Save — Shopify will show you the signing secret',
        `Enter that secret in the PakkOrder admin as shopify_webhook_secret for client ${client.id}`,
        '(Or leave blank — license key is used as default secret)',
      ].join(' → '),
      snippet_alternative: `<script src="${process.env.APP_URL}/snippet.js" data-key="${client.license_key}"></script>`,
      client_id: client.id, client_name: client.name, client_domain: client.domain,
    });
  } catch (err) {
    logger.error('GET /admin/get-shopify-setup error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/clients', adminLimiter, adminAuth, async (req, res) => {
  try {
    const clients = await getAllClients();
    const rows = clients.map(c => ({
      id: c.id, name: c.name, domain: c.domain, plan: c.plan,
      wa_group: c.whatsappGroup || 'shared', wa_number: c.whatsappNumber || 'shared',
      orders_this_month: c.orders_this_month || 0, order_limit: c.order_limit, is_active: c.is_active,
    }));
    const groupCount = {};
    rows.forEach(r => { const g = r.wa_group || 'shared'; groupCount[g] = (groupCount[g] || 0) + 1; });
    return res.status(200).json({ clients: rows, group_counts: groupCount });
  } catch (err) {
    logger.error('GET /admin/clients error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/update-client-wa', adminLimiter, adminAuth, async (req, res) => {
  try {
    const { clientId, whatsappToken, whatsappNumber, whatsappGroup } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    const fields = {};
    if (whatsappToken !== undefined) fields.whatsappToken = whatsappToken;
    if (whatsappNumber !== undefined) fields.whatsappNumber = whatsappNumber;
    if (whatsappGroup !== undefined) fields.whatsappGroup = whatsappGroup;
    if (!Object.keys(fields).length) return res.status(400).json({ error: 'No fields to update' });
    await updateClientFields(clientId, fields);
    logger.info(`Admin updated WA fields for client ${clientId}: ${Object.keys(fields).join(', ')}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    logger.error('POST /admin/update-client-wa error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
