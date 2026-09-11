'use strict';

const express = require('express');
const router = express.Router();
const { getPendingOrderByPhone, getOrderByWamid, updateOrderStatus, upsertBuyerProfile, getClientById, incrementClientFakeCaught, db } = require('../services/firebase');
const { addToQueue } = require('../services/queue');
const { normalizePakistaniPhone, maskPhone } = require('../utils/phone');
const logger = require('../utils/logger');
const DEMO_RESPONSE_WINDOW_MS = 60 * 60 * 1000;

router.get('/meta-webhook', (req,res) => {
  const mode=req.query['hub.mode'], token=req.query['hub.verify_token'], challenge=req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) return res.send(challenge);
  return res.sendStatus(403);
});
router.post('/meta-webhook', async (req,res) => {
  res.sendStatus(200);
  try {
    const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return;
    const phone = normalizePakistaniPhone(message.from); if (!phone) return;
    let action=null, confirmationMethod=null;
    if (message.type === 'interactive') {
      const id=(message.interactive?.button_reply?.id||'').toLowerCase();
      if (id.startsWith('confirm_')) { action='confirm'; confirmationMethod='whatsapp_button'; }
      else if (id.startsWith('cancel_')) { action='cancel'; confirmationMethod='whatsapp_button'; } else return;
    } else if (message.type === 'button') {
      const payload=(message.button?.payload||'').toLowerCase(), text=(message.button?.text||'').toLowerCase();
      if (payload.startsWith('confirm_') || text.includes('confirm')) { action='confirm'; confirmationMethod='whatsapp_button'; }
      else if (payload.startsWith('cancel_') || text.includes('cancel')) { action='cancel'; confirmationMethod='whatsapp_button'; } else return;
    } else if (message.type === 'text') {
      action=parseReply((message.text?.body||'').trim().toLowerCase()).action; if(!action)return; confirmationMethod='whatsapp_text';
    } else return;

    const demoDoc = await findRecentDemoRequest(phone); if (demoDoc) return handleDemoResponse(demoDoc, phone, action);
    let order=null; const contextWamid=message.context?.id;
    if (contextWamid) order=await getOrderByWamid(contextWamid);
    if (!order) order=await getPendingOrderByPhone(phone);
    if (!order || order.status !== 'pending') return;
    let waCredentials=null;
    if (order.wa_phone_number_id && order.client_id) { try { const client=await getClientById(order.client_id); if(client?.wa_access_token) waCredentials={phoneNumberId:order.wa_phone_number_id,accessToken:client.wa_access_token}; } catch(_){} }
    if (action === 'confirm') {
      await updateOrderStatus(order.id,'confirmed',{confirmation_method:confirmationMethod});
      addToQueue(phone,`✅ Your order has been confirmed! ${order.store_name || 'Store'} will deliver it to you soon. Thank you! 😊`,null,order.client_id,null,null,waCredentials);
      upsertBuyerProfile(phone,{confirmedOrders:1}).catch(()=>{});
    } else {
      await updateOrderStatus(order.id,'cancelled',{cancellation_reason:'buyer_cancelled',confirmation_method:confirmationMethod});
      addToQueue(phone,`❌ Your order has been cancelled. If you'd like to place a new order, visit ${order.store_name || 'Store'}. Thank you!`,null,order.client_id,null,null,waCredentials);
      upsertBuyerProfile(phone,{cancelledOrders:1}).catch(()=>{}); if(order.client_id) incrementClientFakeCaught(order.client_id).catch(()=>{});
    }
  } catch(err) { logger.error('POST /meta-webhook error',err); }
});
function parseReply(text){ if(/^yes\b/i.test(text)) return {action:'confirm'}; if(/^no\b/i.test(text)) return {action:'cancel'}; return {action:null}; }
async function findRecentDemoRequest(phone){ try { const since=new Date(Date.now()-DEMO_RESPONSE_WINDOW_MS); const snap=await db.collection('demoRequests').where('phone','==',phone).where('createdAt','>',since).orderBy('createdAt','desc').limit(5).get(); return snap.docs.find(d=>d.data().status==='sent')||null; } catch(err){ logger.error('Demo request lookup error:',err.message); return null; } }
async function handleDemoResponse(demoDoc,phone,action){ try { const status=action==='confirm'?'confirmed':'cancelled'; await demoDoc.ref.update({status,respondedAt:new Date()}); addToQueue(phone, action==='confirm' ? 'Demo complete! This is exactly what your buyers experience.' : 'Demo cancelled.'); } catch(err){ logger.error('Demo response handler error:',err.message); } }
module.exports = router;
