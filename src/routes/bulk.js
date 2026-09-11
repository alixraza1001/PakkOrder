'use strict';

const express = require('express');
const multer  = require('multer');
const jwt     = require('jsonwebtoken');
const { parseFile, detectColumnMapping, storeUpload, getUpload, deleteUpload } = require('../services/bulk');
const { getClientByLicenseKey, getClientById, getAnyOrderByPhoneClientAndOrderId } = require('../services/firebase');
const { createOrder } = require('../services/orders');
const { normalizePakistaniPhone } = require('../utils/phone');
const logger = require('../utils/logger');

async function resolveClient(req) {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
      return payload.client_id ? await getClientById(payload.client_id) : null;
    } catch { return null; }
  }
  const licenseKey = req.body.license_key || req.headers['x-license-key'];
  return licenseKey ? await getClientByLicenseKey(licenseKey) : null;
}

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    if (['csv', 'xlsx', 'xls'].includes(ext)) return cb(null, true);
    cb(new Error('Only CSV and Excel (.xlsx / .xls) files are supported'));
  },
});

router.post('/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const client = await resolveClient(req);
  if (!client) return res.status(401).json({ error: 'Invalid license key' });
  if (!client.is_active) return res.status(403).json({ error: 'Account is inactive' });
  const { columns, rows } = parseFile(req.file.buffer, req.file.originalname);
  if (rows.length === 0) return res.status(400).json({ error: 'File is empty or has no data rows' });
  const { detected, confidence } = detectColumnMapping(columns, rows);
  const used = client.orders_this_month || 0;
  const limit = client.order_limit || 200;
  const remaining = Math.max(0, limit - used);
  const uploadId = storeUpload(client.id, columns, rows);
  logger.info(`[bulk/preview] client=${client.id} file=${req.file.originalname} rows=${rows.length} remaining=${remaining}`);
  res.json({ upload_id: uploadId, columns, detected_mapping: detected, confidence, preview: rows.slice(0, 5), total_rows: rows.length, orders_used: used, order_limit: limit, orders_remaining: remaining, will_process: Math.min(rows.length, remaining), will_skip: Math.max(0, rows.length - remaining) });
});

router.post('/process', async (req, res) => {
  const { upload_id, column_mapping } = req.body;
  if (!upload_id || !column_mapping) return res.status(400).json({ error: 'upload_id and column_mapping are required' });
  if (!column_mapping.phone) return res.status(400).json({ error: 'column_mapping.phone is required' });
  const client = await resolveClient(req);
  if (!client) return res.status(401).json({ error: 'Invalid license key' });
  if (!client.is_active) return res.status(403).json({ error: 'Account is inactive' });
  const uploadData = getUpload(upload_id);
  if (!uploadData) return res.status(404).json({ error: 'Upload session expired. Please re-upload the file.' });
  if (uploadData.clientId !== client.id) return res.status(403).json({ error: 'Upload does not belong to this account' });

  const { rows } = uploadData;
  const used = client.orders_this_month || 0;
  const limit = client.order_limit || 200;
  const remaining = Math.max(0, limit - used);
  if (remaining === 0) {
    deleteUpload(upload_id);
    return res.status(429).json({ error: `Monthly limit of ${limit} orders reached. Upgrade your plan to continue.`, orders_used: used, order_limit: limit });
  }

  const toProcess = rows.slice(0, remaining);
  const skippedLimit = rows.length - toProcess.length;
  let queued = 0;
  const invalidRows = [];
  const duplicateRows = [];

  for (let i = 0; i < toProcess.length; i++) {
    const row = toProcess[i];
    const rowNum = i + 2;
    const rawPhone = String(row[column_mapping.phone] || '').trim();
    if (!rawPhone) { invalidRows.push({ row: rowNum, reason: 'Missing phone number' }); continue; }
    const normalizedPhone = normalizePakistaniPhone(rawPhone);
    if (!normalizedPhone) { invalidRows.push({ row: rowNum, reason: `Invalid phone: "${rawPhone}" — use 03XX or 923XX format` }); continue; }
    const orderDetails = column_mapping.order_details ? String(row[column_mapping.order_details] || '').trim() || 'Bulk Order' : 'Bulk Order';
    const hasExplicitOrderId = !!column_mapping.order_id;
    const orderId = hasExplicitOrderId ? String(row[column_mapping.order_id] || '').trim() || `BULK-${i + 1}` : `BULK-${Date.now()}-${i}`;
    if (hasExplicitOrderId) {
      try {
        const existing = await getAnyOrderByPhoneClientAndOrderId(normalizedPhone, client.id, orderId);
        if (existing) { duplicateRows.push({ row: rowNum, reason: `Already processed (${existing.status})` }); continue; }
      } catch (_) {}
    }
    try {
      const result = await createOrder(client, {
        buyer_phone: rawPhone,
        buyer_name: column_mapping.name ? String(row[column_mapping.name] || '').trim() : '',
        buyer_city: column_mapping.city ? String(row[column_mapping.city] || '').trim() : '',
        buyer_address: column_mapping.address ? String(row[column_mapping.address] || '').trim() : '',
        order_amount: column_mapping.amount ? String(row[column_mapping.amount] || '').trim() : '',
        order_details: orderDetails,
        order_id: orderId,
      });
      if (result?.skipped) duplicateRows.push({ row: rowNum, reason: 'Duplicate — already pending' });
      else queued++;
    } catch (err) {
      invalidRows.push({ row: rowNum, reason: err.message || 'Failed to create order' });
    }
  }

  deleteUpload(upload_id);
  logger.info(`[bulk/process] client=${client.id} queued=${queued} skipped_limit=${skippedLimit} invalid=${invalidRows.length} duplicates=${duplicateRows.length}`);
  const parts = [`${queued} order${queued !== 1 ? 's' : ''} queued for WhatsApp confirmation.`];
  if (skippedLimit > 0) parts.push(`${skippedLimit} skipped — monthly limit reached.`);
  if (invalidRows.length > 0) parts.push(`${invalidRows.length} skipped — invalid data.`);
  if (duplicateRows.length > 0) parts.push(`${duplicateRows.length} duplicate${duplicateRows.length !== 1 ? 's' : ''} skipped.`);
  res.json({ success: true, queued, skipped_limit: skippedLimit, skipped_invalid: invalidRows.length, duplicates: duplicateRows.length, invalid_rows: invalidRows.slice(0, 20), duplicate_rows: duplicateRows.slice(0, 20), message: parts.join(' ') });
});

router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Maximum allowed size is 5 MB.' });
  if (err.message) return res.status(400).json({ error: err.message });
  next(err);
});

module.exports = router;
