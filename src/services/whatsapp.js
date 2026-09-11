'use strict';

const axios=require('axios');
const logger=require('../utils/logger');
const META_API_BASE='https://graph.facebook.com/v18.0';
async function sendMessage(phone,message,templateData,credentials){
  const phoneNumberId=credentials?.phoneNumberId||process.env.META_PHONE_NUMBER_ID;
  const accessToken=credentials?.accessToken||process.env.META_ACCESS_TOKEN;
  if(!phoneNumberId||!accessToken)throw new Error('META_PHONE_NUMBER_ID and META_ACCESS_TOKEN are required');
  const headers={Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'};
  let body;
  if(templateData){const{buyerName,orderIdDisplay,items,totalAmount,deliveryAddress}=templateData;body={messaging_product:'whatsapp',to:phone,type:'template',template:{name:templateData.templateName||process.env.META_TEMPLATE_NAME||'order_confirmation',language:{code:'en'},components:[{type:'body',parameters:[buyerName,orderIdDisplay,items,totalAmount,deliveryAddress].map(text=>({type:'text',text:sanitizeTemplateParam(text)}))}]}};}
  else body={messaging_product:'whatsapp',to:phone,type:'text',text:{body:message||''}};
  try{const response=await axios.post(`${META_API_BASE}/${phoneNumberId}/messages`,body,{headers,timeout:10000});const wamid=response.data?.messages?.[0]?.id||null;logger.info(`Meta ${templateData?'template':'text'} sent to ***${String(phone).slice(-4)}`);return wamid;}catch(err){logger.error(`Meta send failed for ***${String(phone).slice(-4)} — ${err.response?.status||''}: ${err.response?.data?JSON.stringify(err.response.data):err.message}`);throw err;}
}
function sanitizeTemplateParam(str){return String(str||'').replace(/[\n\r\t]/g,' ').replace(/ {4,}/g,' ').trim();}
module.exports={sendMessage};
