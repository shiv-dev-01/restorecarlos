/** Amplifai browser collector. Injected once in <head> so window.track exists before checkout effects run. */
export const AMPLIFAI_TRACK_SNIPPET = `(function () {
  var COLLECTOR = "https://reports.amplifai.it.com/collect";
  var SITE_ID = "restore-wm";
  var UTM_KEYS=["utm_source","utm_medium","utm_campaign","utm_campaign_id","utm_adset_name","utm_adset_id","utm_ad_name","utm_ad_id","utm_content","utm_term","fbclid","gclid"];
  function qs(){try{return new URLSearchParams(window.location.search)}catch(e){return new URLSearchParams()}}
  function getZlcid(){try{var z=localStorage.getItem("zl_zlcid");if(!z){z="zlc_"+Date.now().toString(36)+Math.random().toString(36).slice(2,12);localStorage.setItem("zl_zlcid",z)}return z}catch(e){return "zlc_"+Date.now().toString(36)+Math.random().toString(36).slice(2,12)}}
  function uid(){return "ev_"+Date.now()+"_"+Math.random().toString(36).slice(2,10)}
  function readUtm(q){var out={};UTM_KEYS.forEach(function(k){var v=q.get(k);if(v)out[k]=v});return out}
  var Q=qs();
  var UTM=readUtm(Q);
  var IDENT_EMAIL=Q.get("email")||"";
  var DEFAULT_SKU=Q.get("sku")||"WM-003";
  var DEFAULT_PROGRAM=Q.get("program_code")||DEFAULT_SKU;
  window.track=function(event,opts){
    opts=opts||{};
    var email=opts.email||IDENT_EMAIL;
    if(email)IDENT_EMAIL=email;
    var sku=opts.sku||DEFAULT_SKU;
    var program_code=opts.program_code||DEFAULT_PROGRAM||sku;
    var payload={site_id:SITE_ID,event:event,event_id:uid(),occurred_at:new Date().toISOString(),consent:true,ids:{zlcid:getZlcid()}};
    if(email){
      payload.ids.email=email;
      payload.user={email:email};
      if(opts.phone)payload.user.phone=opts.phone;
      if(opts.state)payload.user.state=opts.state;
    }else if(opts.phone||opts.state){
      payload.user={};
      if(opts.phone)payload.user.phone=opts.phone;
      if(opts.state)payload.user.state=opts.state;
    }
    if(opts.step)payload.step=opts.step;
    var ans=Object.assign({},UTM);
    if(sku)ans.sku=sku;
    if(program_code)ans.program_code=program_code;
    if(opts.fbc_id)ans.fbc_id=opts.fbc_id;
    if(opts.h_ad_id)ans.h_ad_id=opts.h_ad_id;
    if(opts.utm)Object.assign(ans,opts.utm);
    if(Object.keys(ans).length)payload.answers=ans;
    if(opts.order_id)payload.order_id=opts.order_id;
    if(opts.amount!==undefined)payload.amount=opts.amount;
    if(opts.currency)payload.currency=opts.currency;
    var body=JSON.stringify(payload);
    try{if(navigator.sendBeacon)navigator.sendBeacon(COLLECTOR,new Blob([body],{type:"text/plain;charset=UTF-8"}))}catch(e){}
    fetch(COLLECTOR,{method:"POST",headers:{"Content-Type":"application/json"},body:body,keepalive:true,credentials:"omit"}).then(function(r){return r.json().then(function(j){return{status:r.status,json:j}})}).then(function(res){console.log("[track]",event,res.status,res.json)}).catch(function(e){console.error("[track]",e)});
  };
})();`;
