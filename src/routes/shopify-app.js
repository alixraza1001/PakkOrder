'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const https = require('https');
const admin = require('firebase-admin');
const { getClientByLicenseKey } = require('../services/firebase');
const logger = require('../utils/logger');
const db = admin.firestore();
const SHOPIFY_SCOPES = 'read_orders,write_orders,read_customers,write_customers';

function buildShopifyOAuthUrl(shop,state){ const redirectUri=`${process.env.APP_URL}/shopify/callback`; return `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_CLIENT_ID}&scopes=${SHOPIFY_SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`; }
function shopifyRequest(method,shop,path,accessToken,body){ return new Promise((resolve,reject)=>{ const payload=body?JSON.stringify(body):null; const headers={}; if(accessToken) headers['X-Shopify-Access-Token']=accessToken; if(payload){headers['Content-Type']='application/json';headers['Content-Length']=Buffer.byteLength(payload);} const req=https.request({hostname:shop,path,method,headers},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{let parsed=data;try{parsed=data?JSON.parse(data):null;}catch{} resolve({status:res.statusCode,body:parsed});});});req.on('error',reject);if(payload)req.write(payload);req.end();}); }
function exchangeToken(shop,code){ return shopifyRequest('POST',shop,'/admin/oauth/access_token',null,{client_id:process.env.SHOPIFY_CLIENT_ID,client_secret:process.env.SHOPIFY_CLIENT_SECRET,code}).then(r=>r.body); }

router.get('/install', async (req,res)=>{
  const shop=(req.query.shop||'').trim().toLowerCase();
  if(!shop || !shop.endsWith('.myshopify.com')) return res.status(400).send('Missing or invalid shop parameter.');
  const state=crypto.randomBytes(16).toString('hex');
  try { await db.collection('shopify_oauth_states').doc(state).set({shop,created_at:admin.firestore.Timestamp.now()}); }
  catch(err){ logger.error('Shopify install: failed to persist OAuth state',err); return res.status(500).send('Failed to initiate OAuth.'); }
  return res.redirect(buildShopifyOAuthUrl(shop,state));
});

router.get('/callback', async (req,res)=>{
  try {
    const {shop,code,state,hmac}=req.query;
    if(!shop||!code||!state||!hmac) return res.status(400).send('Missing required OAuth parameters.');
    const stateRef=db.collection('shopify_oauth_states').doc(state); const stateSnap=await stateRef.get();
    if(!stateSnap.exists || stateSnap.data().shop!==shop) return res.status(403).send('Invalid state parameter.');
    await stateRef.delete();
    const params=Object.entries(req.query).filter(([k])=>k!=='hmac').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('&');
    const expected=crypto.createHmac('sha256',process.env.SHOPIFY_CLIENT_SECRET).update(params).digest('hex');
    const a=Buffer.from(expected),b=Buffer.from(String(hmac));
    if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return res.status(403).send('HMAC verification failed.');
    const tokenData=await exchangeToken(shop,code); const accessToken=tokenData?.access_token;
    if(!accessToken) return res.status(500).send('Failed to obtain access token from Shopify.');
    await db.collection('shopify_stores').doc(shop).set({shop_domain:shop,access_token:accessToken,is_active:false,plan:null,client_id:null,installed_at:admin.firestore.Timestamp.now(),updated_at:admin.firestore.Timestamp.now()},{merge:true});
    return res.redirect(`/shopify/activate?shop=${encodeURIComponent(shop)}`);
  } catch(err){ logger.error('Shopify callback error',err); return res.status(500).send('An error occurred during Shopify OAuth.'); }
});

router.get('/activate', async (req,res)=>{
  const shop=(req.query.shop||'').trim().toLowerCase();
  if(!shop) return res.status(400).send('Missing shop parameter.');
  res.setHeader('Content-Type','text/html');
  res.setHeader('Content-Security-Policy',"frame-ancestors https://*.myshopify.com https://admin.shopify.com");
  res.removeHeader('X-Frame-Options');
  return res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activate PakkOrder</title><style>body{font-family:system-ui;background:#f4f6f8;display:grid;place-items:center;min-height:100vh}.card{background:#fff;padding:32px;border-radius:14px;max-width:440px;box-shadow:0 4px 24px #0001}input,button{width:100%;padding:12px;margin-top:12px;box-sizing:border-box}button{background:#1D9E75;color:#fff;border:0;border-radius:8px;font-weight:700}</style></head><body><div class="card"><h2>PakkOrder Shopify Activation</h2><p>${shop}</p><input id="key" placeholder="License key"><button id="go">Activate</button><p id="msg"></p></div><script>document.getElementById('go').onclick=async()=>{const r=await fetch('/shopify/activate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({shop_domain:${JSON.stringify(shop)},license_key:document.getElementById('key').value.trim()})});const d=await r.json();document.getElementById('msg').textContent=d.message||d.error||'';};</script></body></html>`);
});

router.post('/activate', express.json(), async (req,res)=>{
  try {
    const {shop_domain,license_key}=req.body||{};
    if(!shop_domain||!license_key) return res.status(400).json({error:'Missing fields',message:'shop_domain and license_key are required.'});
    const shop=shop_domain.trim().toLowerCase();
    const client=await getClientByLicenseKey(license_key.trim());
    if(!client) return res.status(404).json({error:'Invalid license key',message:'License key not found.'});
    if(client.is_active===false) return res.status(403).json({error:'Inactive account',message:'Your PakkOrder account is inactive.'});
    const storeRef=db.collection('shopify_stores').doc(shop); const storeSnap=await storeRef.get();
    if(!storeSnap.exists) return res.status(404).json({error:'Store not found',message:'Store OAuth not completed.'});
    const store=storeSnap.data(); const webhookUrl=`${process.env.APP_URL}/shopify-webhook`;
    const list=await shopifyRequest('GET',shop,'/admin/api/2024-01/webhooks.json?topic=orders%2Fcreate',store.access_token);
    for(const wh of (list.body?.webhooks||[])) await shopifyRequest('DELETE',shop,`/admin/api/2024-01/webhooks/${wh.id}.json`,store.access_token);
    const webhook=await shopifyRequest('POST',shop,'/admin/api/2024-01/webhooks.json',store.access_token,{webhook:{topic:'orders/create',address:webhookUrl,format:'json'}});
    if(webhook.status!==201) logger.warn(`Shopify activate: webhook registration returned ${webhook.status} for ${shop}`);
    await storeRef.update({is_active:true,client_id:client.id,plan:client.plan||null,activated_at:admin.firestore.Timestamp.now(),updated_at:admin.firestore.Timestamp.now()});
    await db.collection('clients').doc(client.id).update({myshopify_domain:shop,updated_at:admin.firestore.Timestamp.now()});
    return res.status(200).json({success:true,message:'PakkOrder activated successfully!',shop,client_id:client.id});
  } catch(err){ logger.error('POST /shopify/activate error',err); return res.status(500).json({error:'Internal server error',message:'Activation failed.'}); }
});

module.exports = router;
