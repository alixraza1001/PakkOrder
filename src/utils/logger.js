'use strict';

function getTimestamp(){const pkt=new Date(Date.now()+5*60*60*1000);const yyyy=pkt.getUTCFullYear(),MM=String(pkt.getUTCMonth()+1).padStart(2,'0'),dd=String(pkt.getUTCDate()).padStart(2,'0'),HH=String(pkt.getUTCHours()).padStart(2,'0'),mm=String(pkt.getUTCMinutes()).padStart(2,'0'),ss=String(pkt.getUTCSeconds()).padStart(2,'0');return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;}
const logger={info:m=>console.log(`[${getTimestamp()}] INFO: ${m}`),warn:m=>console.warn(`[${getTimestamp()}] WARN: ${m}`),error:(m,e)=>e?console.error(`[${getTimestamp()}] ERROR: ${m}`,e):console.error(`[${getTimestamp()}] ERROR: ${m}`),debug:m=>{if(process.env.NODE_ENV!=='production')console.log(`[${getTimestamp()}] DEBUG: ${m}`);}};
module.exports=logger;
