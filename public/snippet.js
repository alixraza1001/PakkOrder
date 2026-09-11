/* PakkOrder storefront integration — archived portfolio snapshot */
(function () {
  var API = window.PAKKORDER_API_URL || 'https://your-pakkorder-backend.example/new-order';
  var DEBUG = window.PAKKORDER_DEBUG === true;
  function log(msg) { if (DEBUG) console.log('[PakkOrder]', msg); }
  function getLicenseKey() {
    var scripts = document.querySelectorAll('script[data-key]');
    for (var i = 0; i < scripts.length; i++) {
      var key = scripts[i].getAttribute('data-key');
      if (key) return key;
    }
    return null;
  }
  var PHONE_NAMES=['phone','buyer_phone','mobile','contact','whatsapp','tel','telephone','phonenumber','phone_number','billing_phone','checkout_phone'];
  var EMAIL_NAMES=['email','buyer_email','emailaddress','email_address','customer_email','billing_email'];
  var ORDER_NAMES=['order_id','order_number','orderid','ordernumber','ref','reference','invoice'];
  var DETAIL_NAMES=['product','item','order_details','orderdetails','product_name','description'];
  var PRICE_NAMES=['price','amount','total','cost','subtotal','cod'];
  var NAME_NAMES=['name','buyer_name','full_name','fullname','customer_name','billing_name','first_name'];
  var ADDRESS_NAMES=['address','buyer_address','shipping_address','billing_address','street','address1','delivery_address'];
  var CITY_NAMES=['city','buyer_city','shipping_city','billing_city','town'];
  function fieldVal(form,names,typeFallback){for(var i=0;i<names.length;i++){var n=names[i],el=form.querySelector('[name="'+n+'"],[id="'+n+'"]');if(el&&el.value&&el.value.trim())return el.value.trim();}if(typeFallback){var byType=form.querySelector('input[type="'+typeFallback+'"]');if(byType&&byType.value)return byType.value.trim();}return '';}
  function randomId(){return 'PK'+Math.random().toString(36).slice(2,10).toUpperCase();}
  function sendToPakkOrder(licenseKey,data){var body=JSON.stringify({buyer_phone:data.phone,buyer_email:data.email||undefined,order_id:data.orderId||randomId(),order_details:data.details||'Order',buyer_name:data.name||undefined,buyer_address:data.address||undefined,buyer_city:data.city||undefined,order_amount:data.amount||undefined});fetch(API,{method:'POST',headers:{'Content-Type':'application/json','X-License-Key':licenseKey},body:body}).then(function(r){log('sent — status '+r.status);}).catch(function(e){if(DEBUG)console.error('[PakkOrder]',e);});}
  function attachForm(form,key){if(form._pakk)return;form._pakk=true;form.addEventListener('submit',function(){var phone=fieldVal(form,PHONE_NAMES,'tel');if(!phone)return;sendToPakkOrder(key,{phone:phone,email:fieldVal(form,EMAIL_NAMES,'email'),orderId:fieldVal(form,ORDER_NAMES),details:fieldVal(form,DETAIL_NAMES)||'Order',name:fieldVal(form,NAME_NAMES),address:fieldVal(form,ADDRESS_NAMES),city:fieldVal(form,CITY_NAMES),amount:fieldVal(form,PRICE_NAMES)});},false);}
  function detectForms(key){var forms=document.querySelectorAll('form');for(var i=0;i<forms.length;i++){var f=forms[i];if(f.getAttribute('data-pakkorder')==='true'||f.querySelector('input[type="tel"]'))attachForm(f,key);}}
  function init(){var key=getLicenseKey();if(!key)return;detectForms(key);if(typeof MutationObserver!=='undefined')new MutationObserver(function(){detectForms(key);}).observe(document.body,{childList:true,subtree:true});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
