'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getClientByDomain, getClientByMyshopifyDomain } = require('../services/firebase');
const { createOrder } = require('../services/orders');
const logger = require('../utils/logger');

function verifyShopifyHmac(rawBody, receivedHmac) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret || !receivedHmac) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const expected = Buffer.from(digest, 'utf8');
  const received = Buffer.from(String(receivedHmac), 'utf8');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

router.post('/', async (req,res) => {
  try {
    const hmacHeader=req.headers['x-shopify-hmac-sha256'];
    const shopDomain=req.headers['x-shopify-shop-domain'];
    const topic=req.headers['x-shopify-topic'];
    const rawBody=req.body;
    if(!rawBody || rawBody.length===0) return res.sendStatus(200);
    if(topic && topic!=='orders/create') return res.sendStatus(200);
    if(!hmacHeader || !shopDomain) return res.sendStatus(401);
    if(!verifyShopifyHmac(rawBody,hmacHeader)) { logger.warn(`Shopify webhook: HMAC mismatch for ${shopDomain}`); return res.sendStatus(401); }
    const cleanDomain=shopDomain.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/.*$/,'').toLowerCase().trim();
    let client=await getClientByMyshopifyDomain(cleanDomain); if(!client) client=await getClientByDomain(cleanDomain);
    if(!client || client.is_active===false) return res.sendStatus(200);
    let order; try { order=JSON.parse(rawBody.toString('utf8')); } catch { return res.sendStatus(400); }
    const gateway=String(order.gateway||'').toLowerCase();
    const isCOD=!order.gateway || gateway.includes('cod') || gateway.includes('cash') || order.financial_status==='pending';
    if(!isCOD) return res.status(200).json({skipped:true});
    const phone=order.phone || order.shipping_address?.phone || order.billing_address?.phone || '';
    if(!phone) return res.sendStatus(200);
    const lineItems=Array.isArray(order.line_items)?order.line_items:[];
    const ship=order.shipping_address||{}, bill=order.billing_address||{}, cust=order.customer||{};
    await createOrder(client,{
      buyer_phone:phone,
      buyer_email:order.email||null,
      buyer_name:ship.name || (cust.first_name ? cust.first_name + (cust.last_name ? ' '+cust.last_name : '') : null),
      buyer_city:ship.city || ship.province || bill.city || cust.default_address?.city || null,
      buyer_address:ship.address1||null,
      order_id:String(order.order_number||order.id),
      order_details:lineItems.map(item=>`${item.title} x${item.quantity} - Rs.${item.price}`).join(', ') || 'Shopify Order',
      order_amount:order.total_price ? Number(order.total_price) : null,
    });
  } catch(err){ logger.error('Shopify webhook error',err); }
  return res.sendStatus(200);
});
module.exports = router;
