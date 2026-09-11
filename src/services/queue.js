'use strict';

const {sendMessage}=require('./whatsapp');
const {getDailyMessageCount,getHourlyMessageCount,incrementDailyMessageCount,incrementHourlyMessageCount,resetHourlyMessageCount,updateOrderWhatsappStatus,updateOrderWamid,createNotification,updateOnboardingStep}=require('./firebase');
const logger=require('../utils/logger');
const DAILY_LIMIT=parseInt(process.env.WA_DAILY_LIMIT||'1000',10),HOURLY_LIMIT=parseInt(process.env.WA_HOURLY_LIMIT||'250',10),SYNC_INTERVAL_MS=5*60*1000;
let _dailyCount=0,_hourlyCount=0,_cacheReady=false,_lastSync=0,paused=false,currentHour=new Date().getUTCHours();
const queue=[];
async function _syncFromFirestore(){try{[_dailyCount,_hourlyCount]=await Promise.all([getDailyMessageCount(),getHourlyMessageCount()]);_lastSync=Date.now();_cacheReady=true;}catch(err){logger.error('Queue: Firestore count sync failed',err);}}
function resetMemoryCounters(resetDaily=true){if(resetDaily)_dailyCount=0;_hourlyCount=0;_cacheReady=false;}
function addToQueue(phone,message,orderId,clientId,docId,templateData,credentials){queue.push({phone,message:message||null,templateData:templateData||null,orderId:orderId||null,clientId:clientId||null,docId:docId||null,credentials:credentials||null,addedAt:Date.now()});}
function startQueue(){scheduleNext();setInterval(()=>logger.info(`Queue status: ${queue.length} pending, paused=${paused}`),10*60*1000).unref();}
function scheduleNext(){setTimeout(processNext,4000+Math.floor(Math.random()*4000));}
async function processNext(){try{const nowHour=new Date().getUTCHours();if(nowHour!==currentHour){currentHour=nowHour;_hourlyCount=0;await resetHourlyMessageCount();paused=false;}if(paused||!queue.length){scheduleNext();return;}if(!_cacheReady||Date.now()-_lastSync>SYNC_INTERVAL_MS)await _syncFromFirestore();if(_dailyCount>=DAILY_LIMIT||_hourlyCount>=HOURLY_LIMIT){paused=true;scheduleNext();return;}const item=queue.shift();try{const wamid=await sendMessage(item.phone,item.message,item.templateData,item.credentials);_dailyCount++;_hourlyCount++;await Promise.all([incrementDailyMessageCount(),incrementHourlyMessageCount()]);if(item.docId){updateOrderWhatsappStatus(item.docId,'sent').catch(()=>{});if(wamid)updateOrderWamid(item.docId,wamid).catch(()=>{});if(item.clientId)updateOnboardingStep(item.clientId,'firstConfirmation').catch(()=>{});}}catch(err){logger.error(`Queue: send failed for ***${item.phone.slice(-4)}`,err);if(item.docId){updateOrderWhatsappStatus(item.docId,'failed').catch(()=>{});if(item.clientId)createNotification(item.clientId,{type:'wa_failed',message:'WhatsApp delivery failed for order',orderId:item.docId}).catch(()=>{});}}}catch(err){logger.error('Queue processor error',err);}scheduleNext();}
module.exports={addToQueue,startQueue,resetMemoryCounters};
