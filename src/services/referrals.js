'use strict';

const {db}=require('./firebase');
const {addToQueue}=require('./queue');
const logger=require('../utils/logger');
const THIRTY_DAYS_MS=30*24*60*60*1000,FREE_MONTH_THRESHOLD=3;
async function processPendingReferrals(){logger.info('Referrals cron: scanning pending referrals');try{const snap=await db.collection('referrals').where('status','==','pending').get();for(const doc of snap.docs){try{await processReferralClaim(doc);}catch(err){logger.error(`Referrals cron: failed to process ${doc.id}:`,err.message);}}}catch(err){logger.error('processPendingReferrals error:',err.message);}}
async function processReferralClaim(docOrId){const refDoc=typeof docOrId==='string'?await db.collection('referrals').doc(docOrId).get():docOrId;const referral=refDoc.data();if(!referral||referral.status!=='pending')return;const signupDate=referral.signupDate?.toDate?.()||new Date(referral.signupDate);if(Date.now()-signupDate.getTime()<=THIRTY_DAYS_MS)return;await refDoc.ref.update({status:'claimed',claimedDate:new Date(),creditedToReferrer:true});const referrerRef=db.collection('clients').doc(referral.referrerClientId);const referrerDoc=await referrerRef.get();if(!referrerDoc.exists)return;const newCredits=(referrerDoc.data().referralCreditsEarned||0)+1;const earnedFreeMonth=newCredits>=FREE_MONTH_THRESHOLD;await referrerRef.update({referralCreditsEarned:newCredits,...(earnedFreeMonth?{nextMonthFree:true}:{})});const phone=referrerDoc.data().phone;if(phone){const left=FREE_MONTH_THRESHOLD-newCredits;addToQueue(phone,left>0?`Great news! ${referral.newClientName} joined using your referral code. You now have ${newCredits}/${FREE_MONTH_THRESHOLD} referrals.`:`You've earned a free month on PakkOrder!`);}}
module.exports={processPendingReferrals,processReferralClaim};
