'use strict';

const crypto=require('crypto');
const {licenseKeyExists}=require('../services/firebase');
const logger=require('./logger');
const CHARS='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
function generateSegment(length){let segment='';const bytes=crypto.randomBytes(length);for(let i=0;i<length;i++)segment+=CHARS[bytes[i]%CHARS.length];return segment;}
function buildKey(){return `PAKK-${generateSegment(4)}-${generateSegment(4)}-${generateSegment(4)}`;}
async function generateLicenseKey(){for(let attempt=1;attempt<=5;attempt++){const key=buildKey();if(!(await licenseKeyExists(key))){logger.info(`License key generated on attempt ${attempt}`);return key;}}throw new Error('Failed to generate unique license key after 5 attempts');}
module.exports={generateLicenseKey};
