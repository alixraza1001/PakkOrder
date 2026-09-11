'use strict';

const axios  = require('axios');
const logger = require('../src/utils/logger');

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) {
    logger.warn('TURNSTILE_SECRET not set — skipping Turnstile check (dev mode)');
    return true;
  }

  try {
    const params = new URLSearchParams();
    params.append('secret',   secret);
    params.append('response', token);
    if (ip) params.append('remoteip', ip);

    const res = await axios.post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 5000,
      }
    );
    return res.data?.success === true;
  } catch (err) {
    logger.error('Turnstile verification error:', err.message);
    return false;
  }
}

module.exports = { verifyTurnstile };
