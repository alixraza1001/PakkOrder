'use strict';

const { db } = require('../src/services/firebase');
const logger  = require('../src/utils/logger');

// Unambiguous uppercase alphanumeric (no 0/O, no 1/I/L)
const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateReferralCode() {
  const segment = () =>
    Array(4).fill(null).map(() => CHARS[Math.floor(Math.random() * CHARS.length)]).join('');
  return `PAKK-${segment()}-${segment()}`;
}

async function ensureReferralCode(clientId) {
  try {
    const doc = await db.collection('clients').doc(clientId).get();
    if (!doc.exists) return null;

    const existing = doc.data().referralCode;
    if (existing) return existing;

    // Generate unique code (collision is astronomically unlikely but check anyway)
    let code;
    for (let attempt = 0; attempt < 10; attempt++) {
      code = generateReferralCode();
      const snap = await db.collection('clients').where('referralCode', '==', code).limit(1).get();
      if (snap.empty) break;
    }

    await db.collection('clients').doc(clientId).update({
      referralCode:             code,
      referralCodeGeneratedAt:  new Date(),
      referralCreditsEarned:    0,
      nextMonthFree:            false,
    });

    logger.info(`Referral code generated for client ${clientId}: ${code}`);
    return code;
  } catch (err) {
    logger.error(`ensureReferralCode failed for ${clientId}:`, err.message);
    return null;
  }
}

module.exports = { generateReferralCode, ensureReferralCode };
