'use strict';

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const { updateOrderStatus, getOrderById } = require('../services/firebase');
const logger  = require('../utils/logger');

router.get('/confirm', async (req, res) => {
  try {
    const { token, action } = req.query;
    if (!token || !action) return res.send(errorPage('Invalid link — missing token or action.'));
    let decoded;
    try { decoded = jwt.verify(token, process.env.JWT_SECRET); }
    catch (err) {
      logger.error('Confirm: invalid token: ' + err.message);
      if (err.name === 'TokenExpiredError') return res.send(errorPage('This confirmation link has expired (24 hours). Please check your WhatsApp message to confirm your order.'));
      return res.send(errorPage('Link expired or invalid. Please check WhatsApp for confirmation.'));
    }
    const { orderId } = decoded;
    logger.info('Confirm: orderId=' + orderId + ' action=' + action);
    const order = await getOrderById(orderId);
    if (!order) return res.send(errorPage('Order not found. It may have already been confirmed or cancelled.'));
    if (order.status === 'confirmed' && action === 'confirm') return res.send(successPage(order.store_name, 'Your order was already confirmed! It will be delivered soon.'));
    if (order.status === 'cancelled') return res.send(errorPage('This order has already been cancelled.'));
    if (order.status === 'expired') return res.send(errorPage('This order has expired. Please place a new order.'));
    if (action === 'confirm') { await updateOrderStatus(orderId, 'confirmed'); logger.info('Confirm: order confirmed: ' + orderId); return res.send(successPage(order.store_name, null)); }
    if (action === 'cancel') { await updateOrderStatus(orderId, 'cancelled'); logger.info('Confirm: order cancelled: ' + orderId); return res.send(cancelPage(order.store_name)); }
    return res.send(errorPage('Invalid action. Please use the buttons in your email.'));
  } catch (err) {
    logger.error('Confirm route error: ' + err.message);
    return res.send(errorPage('Something went wrong. Please try again.'));
  }
});

const baseStyle = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
  .card { background: #fff; border-radius: 16px; padding: 40px 32px; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.10); }
  .icon { font-size: 64px; margin-bottom: 20px; }
  h1 { font-size: 22px; margin-bottom: 12px; }
  p  { font-size: 15px; color: #6b7280; line-height: 1.6; margin-bottom: 8px; }
  .store { font-weight: 700; color: #1a1a1a; }
  .brand { margin-top: 32px; font-size: 12px; color: #d1d5db; }
  .brand a { color: #1D9E75; text-decoration: none; }
`;
function successPage(storeName, message) { return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Order Confirmed</title><style>${baseStyle} body { background: #f0fdf4; } h1 { color: #1D9E75; }</style></head><body><div class="card"><div class="icon">✅</div><h1>Order Confirmed!</h1><p>${message ? esc(message) : '<span class="store">' + esc(storeName || 'The store') + '</span> will deliver your order soon.'}</p><p style="margin-top:16px;">Thank you for shopping! 🙏</p><div class="brand">Verified by PakkOrder</div></div></body></html>`; }
function cancelPage(storeName) { return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Order Cancelled</title><style>${baseStyle} body { background: #fef2f2; } h1 { color: #ef4444; }</style></head><body><div class="card"><div class="icon">❌</div><h1>Order Cancelled</h1><p>Your order has been cancelled.</p><p>If this was a mistake, please visit <strong>${esc(storeName || 'the store')}</strong> to place a new order.</p><div class="brand">Verified by PakkOrder</div></div></body></html>`; }
function errorPage(message) { return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Error</title><style>${baseStyle} body { background: #fff7ed; } h1 { color: #f59e0b; }</style></head><body><div class="card"><div class="icon">⚠️</div><h1>Oops!</h1><p>${esc(message)}</p><div class="brand">Verified by PakkOrder</div></div></body></html>`; }
function esc(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
module.exports = router;
