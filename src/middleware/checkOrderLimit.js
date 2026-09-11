'use strict';

const logger = require('../utils/logger');

async function checkOrderLimit(req, res, next) {
  try {
    const client = req.client;
    const used = client.orders_this_month || 0;
    const limit = client.order_limit || 400;
    const remaining = limit - used;

    if (used >= limit) {
      logger.warn(`Order limit reached for client ${client.id} (${used}/${limit})`);
      return res.status(429).json({
        error: 'Monthly limit reached',
        message: 'Aapka is mahine ka order limit complete ho gaya.',
        orders_used: used,
        order_limit: limit,
        upgrade_url: 'https://pakkorder.com/upgrade',
      });
    }

    if (used / limit >= 0.8) {
      res.setHeader('X-Limit-Warning', 'true');
      res.setHeader('X-Orders-Remaining', String(remaining));
    }

    next();
  } catch (err) {
    logger.error('checkOrderLimit middleware error', err);
    return res.status(500).json({ error: 'Internal server error', message: 'Limit check failed' });
  }
}

module.exports = checkOrderLimit;
