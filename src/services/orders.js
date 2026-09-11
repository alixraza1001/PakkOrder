'use strict';

const {createOrder:dbCreateOrder,updateOrderStatus,updateOrderEmailStatus,getPendingOrderByPhoneAndClient,incrementClientOrderCount,incrementClientFakeCaught,getExpiredPendingOrders,getPendingOrdersForRetry,markOrderRetrySent,getClientForUsageAlert,markUsageAlertSent,createNotification,updateOnboardingStep,getBlacklistEntry,getBuyerProfile,calculateRiskScore,upsertBuyerProfile}=require('./firebase');
const {addToQueue}=require('./queue');
const {sendConfirmationEmail}=require('./email');
const {normalizePakistaniPhone,maskPhone}=require('../utils/phone');
const {normalizeCity}=require('../../lib/normalizeCity');
const logger=require('../utils/logger');
const _inFlight=new Set();

async function createOrder(client,orderData){
  const buyerPhone=normalizePakistaniPhone(orderData.buyer_phone);if(!buyerPhone)throw Object.assign(new Error('Invalid phone number'),{statusCode:400});
  const lockKey=`${client.id}:${buyerPhone}:${orderData.order_id}`;if(_inFlight.has(lockKey))return{skipped:true};_inFlight.add(lockKey);
  try{
    const existing=await getPendingOrderByPhoneAndClient(buyerPhone,client.id,String(orderData.order_id));if(existing)return existing;
    let isBlacklisted=false;try{isBlacklisted=!!(await getBlacklistEntry(buyerPhone));}catch{}
    let buyerRiskScore='medium';try{buyerRiskScore=calculateRiskScore(await getBuyerProfile(buyerPhone));}catch{}
    if(isBlacklisted){const docId=await dbCreateOrder({client_id:client.id,store_name:client.name,buyer_phone:buyerPhone,buyer_email:orderData.buyer_email||null,buyer_name:orderData.buyer_name||null,buyer_city:normalizeCity(orderData.buyer_city),buyer_address:orderData.buyer_address||null,order_id:orderData.order_id,order_details:orderData.order_details,order_amount:orderData.order_amount||null,buyerRiskScore,status:'blacklisted',cancelReason:'Blacklisted buyer'});await incrementClientOrderCount(client.id);createNotification(client.id,{type:'blacklisted',message:`Blocked order #${orderData.order_id} — blacklisted buyer`,orderId:docId}).catch(()=>{});return{id:docId,buyer_phone:buyerPhone,order_id:orderData.order_id,blacklisted:true};}
    const waCredentials=client.wa_phone_number_id&&client.wa_access_token?{phoneNumberId:client.wa_phone_number_id,accessToken:client.wa_access_token}:null;
    const docId=await dbCreateOrder({client_id:client.id,store_name:client.name,buyer_phone:buyerPhone,buyer_email:orderData.buyer_email||null,buyer_name:orderData.buyer_name||null,buyer_city:normalizeCity(orderData.buyer_city),buyer_address:orderData.buyer_address||null,order_id:orderData.order_id,order_details:orderData.order_details,order_amount:orderData.order_amount||null,buyerRiskScore,wa_phone_number_id:client.wa_phone_number_id||null});
    await incrementClientOrderCount(client.id);checkUsageAlert(client.id).catch(()=>{});upsertBuyerProfile(buyerPhone,{totalOrders:1}).catch(()=>{});
    const deliveryAddress=[orderData.buyer_address,orderData.buyer_city].filter(Boolean).join(', ')||'Pakistan';
    const templateData={buyerName:orderData.buyer_name||'Valued Customer',orderIdDisplay:'#'+String(orderData.order_id),items:orderData.order_details||'',totalAmount:String(orderData.order_amount||''),deliveryAddress};
    addToQueue(buyerPhone,null,orderData.order_id,client.id,docId,templateData,waCredentials);
    sendConfirmationEmail({buyerEmail:orderData.buyer_email,storeName:client.name,orderDetails:orderData.order_details,orderId:docId,storeOrderId:orderData.order_id,clientId:client.id}).then(()=>updateOrderEmailStatus(docId,'sent').catch(()=>{})).catch(()=>updateOrderEmailStatus(docId,'failed').catch(()=>{}));
    updateOnboardingStep(client.id,'firstOrder').catch(()=>{});createNotification(client.id,{type:'new_order',message:`New order #${orderData.order_id} received`,orderId:docId}).catch(()=>{});
    return{id:docId,buyer_phone:buyerPhone,order_id:orderData.order_id};
  }finally{setTimeout(()=>_inFlight.delete(lockKey),5000);}
}
async function expireStaleOrders(){try{const stale=await getExpiredPendingOrders();await Promise.all(stale.map(async o=>{await updateOrderStatus(o.id,'expired');if(o.buyer_phone)upsertBuyerProfile(o.buyer_phone,{ghostedOrders:1}).catch(()=>{});if(o.client_id)incrementClientFakeCaught(o.client_id).catch(()=>{});}));}catch(e){logger.error('expireStaleOrders failed',e);}}
async function sendRetryReminders(){try{for(const o of await getPendingOrdersForRetry()){addToQueue(o.buyer_phone,`Reminder: Your order #${o.order_id} from ${o.store_name} is still waiting for confirmation.`);await markOrderRetrySent(o.id);}}catch(e){logger.error('sendRetryReminders failed',e);}}
async function checkUsageAlert(clientId){try{const c=await getClientForUsageAlert(clientId);if(!c?.phone||c.usage_alert_80_sent)return;const limit=c.order_limit||0,used=c.orders_this_month||0;if(!limit||used/limit<0.8)return;addToQueue(c.phone,`Heads up! You've used ${used}/${limit} orders this month.`);await markUsageAlertSent(clientId);}catch(e){logger.error(`checkUsageAlert failed for ${clientId}`,e);}}
module.exports={createOrder,expireStaleOrders,sendRetryReminders,checkUsageAlert};
