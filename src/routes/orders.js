'use strict';

const express = require('express');
const router = express.Router();
const { orderLimiter } = require('../middleware/rateLimiter');
const validateRequest = require('../middleware/validateRequest');
const checkOrderLimit = require('../middleware/checkOrderLimit');
const { createOrder } = require('../services/orders');
const logger = require('../utils/logger');
router.post('/new-order', orderLimiter, validateRequest, checkOrderLimit, async (req,res) => {
  try {
    const { buyer_phone,buyer_email,buyer_name,buyer_city,buyer_address,order_id,order_details,order_amount }=req.body;
    const missing=[]; if(!buyer_phone)missing.push('buyer_phone'); if(!order_id)missing.push('order_id'); if(!order_details)missing.push('order_details');
    if(missing.length)return res.status(400).json({error:'Missing required fields',message:`Required fields missing: ${missing.join(', ')}`});
    const order=await createOrder(req.client,{buyer_phone,buyer_email:buyer_email||null,buyer_name:buyer_name||null,buyer_city:buyer_city||null,buyer_address:buyer_address||null,order_id:String(order_id),order_details,order_amount:order_amount||null});
    logger.info(`New order processed: ${order.id} for client ${req.client.id}`);
    return res.status(200).json({success:true,message:'Confirmation bhej di gayi hai',order_id:order.id});
  } catch(err){ if(err.statusCode===400)return res.status(400).json({error:'Invalid input',message:err.message}); logger.error('POST /new-order error',err); return res.status(500).json({error:'Internal server error',message:'Order process karte waqt masla aaya. Dobara try karein.'}); }
});
module.exports = router;
