'use strict';

const { getClientByLicenseKey } = require('../services/firebase');
const logger = require('../utils/logger');

function extractDomain(headerValue) {
  if (!headerValue) return null;
  try {
    const withProto = headerValue.startsWith('http') ? headerValue : `https://${headerValue}`;
    const url = new URL(withProto);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return headerValue
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
      .toLowerCase();
  }
}

async function validateRequest(req, res, next) {
  try {
    const licenseKey = req.headers['x-license-key'];
    if (!licenseKey) {
      return res.status(401).json({ error: 'License key required', message: 'X-License-Key header missing' });
    }

    const client = await getClientByLicenseKey(licenseKey);
    if (!client) {
      return res.status(401).json({ error: 'Invalid license key', message: 'No account found for this license key' });
    }

    if (client.is_active === false) {
      return res.status(403).json({ error: 'Account suspended', message: 'Your account has been suspended. Please contact support.' });
    }

    if (client.trial_active && client.trial_ends_at) {
      const trialEnd = client.trial_ends_at.toDate ? client.trial_ends_at.toDate() : new Date(client.trial_ends_at);
      if (trialEnd < new Date()) {
        return res.status(403).json({ error: 'Trial expired', message: 'Trial expired. Please subscribe to continue.' });
      }
    }

    const originHeader = req.headers['origin'] || req.headers['referer'] || '';
    const requestDomain = extractDomain(originHeader);
    if (requestDomain && process.env.NODE_ENV !== 'development') {
      if (requestDomain !== client.domain.toLowerCase()) {
        logger.warn(`Domain mismatch: license=${licenseKey.slice(-4)} expected=${client.domain} got=${requestDomain}`);
        return res.status(403).json({ error: 'Domain not authorized', message: 'This license key is registered for a different domain' });
      }
    }

    req.client = client;
    next();
  } catch (err) {
    logger.error('validateRequest middleware error', err);
    return res.status(500).json({ error: 'Internal server error', message: 'Validation failed' });
  }
}

module.exports = validateRequest;
