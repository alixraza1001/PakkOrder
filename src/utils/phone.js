'use strict';

function normalizePakistaniPhone(phone){if(!phone)return null;let digits=String(phone).replace(/\D/g,'');if(digits.startsWith('0092'))digits=digits.slice(2);else if(digits.startsWith('00'))digits=digits.slice(2);if(digits.startsWith('92')){}else if(digits.startsWith('0'))digits='92'+digits.slice(1);else if(digits.startsWith('3'))digits='92'+digits;if(digits.length!==12||!digits.startsWith('92')||digits[2]!=='3')return null;const prefix=parseInt(digits.slice(2,4),10);return prefix>=30&&prefix<=38?digits:null;}
function maskPhone(phone){if(!phone)return'***';return'***'+String(phone).slice(-4);}
module.exports={normalizePakistaniPhone,maskPhone};
