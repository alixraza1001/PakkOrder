'use strict';

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

function adminAuth(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Authorization header missing or malformed' });
    }

    const token = authHeader.slice(7); // strip "Bearer "
    jwt.verify(token, process.env.ADMIN_SECRET, (err, decoded) => {
      if (err) {
        logger.warn(`Admin auth failed: ${err.message}`);
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired admin token' });
      }
      req.admin = decoded;
      next();
    });
  } catch (err) {
    logger.error('adminAuth middleware error', err);
    return res.status(500).json({ error: 'Internal server error', message: 'Auth check failed' });
  }
}

module.exports = adminAuth;
