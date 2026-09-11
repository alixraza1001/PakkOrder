'use strict';

/**
 * One-time script to register the WhatsApp Business phone number
 * with Meta Cloud API. Run this once to move it out of "Pending".
 *
 * Usage:
 *   node register-whatsapp.js
 *
 * Requires in .env (or set inline below):
 *   META_PHONE_NUMBER_ID=
 *   META_ACCESS_TOKEN=
 */

require('dotenv').config();
const https = require('https');

const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const ACCESS_TOKEN    = process.env.META_ACCESS_TOKEN;

if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
  console.error('\n❌  Missing env vars.');
  console.error('    Set META_PHONE_NUMBER_ID and META_ACCESS_TOKEN in .env first.\n');
  console.error('    Where to find them:');
  console.error('    Phone Number ID → developers.facebook.com → your app → WhatsApp → API Setup');
  console.error('    Access Token    → Meta Business Manager → Settings → System Users → Generate Token\n');
  process.exit(1);
}

const body = JSON.stringify({
  messaging_product: 'whatsapp',
  pin: '000000',       // 6-digit PIN — choose something you remember
});

const options = {
  hostname: 'graph.facebook.com',
  path:     `/v18.0/${PHONE_NUMBER_ID}/register`,
  method:   'POST',
  headers: {
    'Authorization': `Bearer ${ACCESS_TOKEN}`,
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
  },
};

console.log(`\n📱 Registering phone number ID: ${PHONE_NUMBER_ID}`);
console.log('   Sending registration request to Meta...\n');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(data); } catch { parsed = data; }

    console.log(`HTTP ${res.statusCode}`);
    console.log('Response:', JSON.stringify(parsed, null, 2));

    if (res.statusCode === 200 && parsed?.success) {
      console.log('\n✅  Registration successful!');
      console.log('    Your number is now registered with Meta Cloud API.');
      console.log('\n    Next steps:');
      console.log('    1. Add to Railway env vars:');
      console.log(`       META_PHONE_NUMBER_ID=${PHONE_NUMBER_ID}`);
      console.log('       META_ACCESS_TOKEN=<your permanent token>');
      console.log('       WHATSAPP_PROVIDER=meta');
      console.log('    2. Create and get the "order_confirmation" template approved');
      console.log('       in Meta Business Manager → WhatsApp → Message Templates\n');
    } else {
      console.log('\n❌  Registration failed — see response above.');
      console.log('    Common causes:');
      console.log('    - Token expired (use a permanent system user token)');
      console.log('    - Phone number ID is wrong');
      console.log('    - Number is already registered (try sending a test message instead)\n');
    }
  });
});

req.on('error', (err) => {
  console.error('\n❌  Network error:', err.message, '\n');
});

req.write(body);
req.end();
