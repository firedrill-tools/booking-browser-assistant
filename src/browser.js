import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {hash} from './schema.js';
import {argumentsFor} from './native.js';
const allowedPath=(pathname,method)=>method==='GET'&&(/^\/$|^\/slots\/[A-Za-z0-9_-]+$|^\/review\/[a-fA-F0-9-]+$|^\/reservations\/[A-Za-z0-9_-]+$|^\/assets\/style\.css$/.test(pathname))||method==='POST'&&/^\/slots\/[A-Za-z0-9_-]+\/review$|^\/confirm\/[a-fA-F0-9-]+$/.test(pathname);
export class BrowserSession{
 constructor(origin,captureDir,owner){Object.assign(this,{origin,captureDir,owner});this.browser=null;this.context=null;this.page=null;this.step=0;this.trace=[];this.blocked=[];this.closeAttempted=false;this.closed=false;this.observedReview=null;}
 block(kind,url){const detail={kind,url};this.blocked.push(detail);this.owner.failure??=new Error('browser blocked an operation outside its portal boundary');this.owner.receipt.data.blockedRequests=this.blocked;try{this.owner.receipt.save();}catch{}}
 local(url,method='GET'){const u=new URL(url);return u.origin===this.origin&&!u.username&&!u.password&&allowedPath(u.pathname,method);}
 async open(){
  this.owner.basicGuard();
  try{
   this.browser=await chromium.launch({headless:true,timeout:10000,handleSIGINT:false,handleSIGTERM:false,handleSIGHUP:false,env:Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','USER','LOGNAME','LANG','LC_ALL','DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','SystemRoot','WINDIR'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]))});this.owner.receipt.data.lifecycle.browserAllocated=true;this.owner.basicGuard();
   this.context=await this.browser.newContext({viewport:{width:1280,height:900},javaScriptEnabled:false,serviceWorkers:'block',acceptDownloads:false});this.owner.receipt.data.lifecycle.contextAllocated=true;this.owner.basicGuard();
   this.context.setDefaultTimeout(4000);this.context.setDefaultNavigationTimeout(5000);
   this.abort=()=>{this.cancelPromise??=this.close();this.cancelPromise.catch(e=>{this.owner.failure??=e;});};this.owner.signal.addEventListener('abort',this.abort,{once:true});
   if(this.owner.signal.aborted)this.abort();this.owner.basicGuard();
   await this.context.route('**/*',async route=>{
    let response;
    try{
     const request=route.request();if(!this.local(request.url(),request.method())){this.block('http',request.url());await route.abort('blockedbyclient');return;}
     this.owner.basicGuard();
     response=await route.fetch({headers:{...request.headers(),'x-booking-operation':this.owner.portal.credential},maxRedirects:0,timeout:Math.max(1,Math.min(5000,Math.ceil(this.owner.deadline-performance.now())))});
     const headers=response.headers(),location=headers.location;
     if(location&&!this.local(new URL(location,request.url()).href,'GET')){this.block('redirect',new URL(location,request.url()).href);await route.abort('blockedbyclient');return;}
     if(headers['content-disposition']?.toLowerCase().includes('attachment')){this.block('download',request.url());await route.abort('blockedbyclient');return;}
     await route.fulfill({response});
    }catch(e){if(!this.owner.signal.aborted){this.owner.failure??=e;try{await route.abort('failed');}catch{}}}finally{await response?.dispose().catch(()=>{});}
   });
   await this.context.routeWebSocket('**/*',socket=>{this.block('websocket',socket.url());socket.close();});
   this.context.on('page',page=>{if(this.page&&page!==this.page){this.block('popup',page.url());void page.close().catch(()=>{});}});
   this.page=await this.context.newPage();this.page.on('download',download=>{this.block('download',download.url());void download.cancel().catch(()=>{});});this.page.on('dialog',dialog=>{void dialog.dismiss().catch(()=>{});});
   const initial=await this.page.goto(this.origin,{waitUntil:'domcontentloaded'});if(!initial||initial.status()>=400)throw new Error('portal startup did not return a successful page');await this.owner.guard();return this;
  }catch(e){if(!this.closeAttempted)try{await this.close();}catch(close){e.cleanupError=close.message;}else await this.cancelPromise?.catch(()=>{});throw e;}
 }
 assertLocal(){this.owner.basicGuard();if(this.closeAttempted||!(this.local(this.page.url(),'GET')||this.local(this.page.url(),'POST')))throw new Error('browser is closed or outside its configured portal');if(this.blocked.length)throw new Error('browser boundary was violated');}
 async observe(action='inspect'){
  this.assertLocal();await this.owner.guard();const screenshot=path.join(this.captureDir,`step-${String(this.step++).padStart(2,'0')}.png`),item={action,status:'prepared',screenshot};this.owner.receipt.data.observations.push(item);this.owner.receipt.save();
  await this.page.screenshot({path:screenshot,fullPage:false,timeout:4000});fs.chmodSync(screenshot,0o600);const raw=fs.readFileSync(screenshot);item.screenshotBytes=raw.length;item.screenshotSha256=hash(raw);if(raw.length>8*1024*1024)throw new Error('screenshot exceeds retained limit');
  const text=await this.page.locator('body').innerText(),controls=await this.page.locator('a,button,input:not([type=hidden]),select').evaluateAll(elements=>elements.filter(el=>{const style=getComputedStyle(el);return !el.hidden&&style.display!=='none'&&style.visibility!=='hidden';}).map(el=>({tag:el.tagName.toLowerCase(),text:(el.textContent??'').trim().slice(0,160),label:Array.from(el.labels??[]).map(l=>l.textContent.trim()).join(' '),value:'value'in el?String(el.value):'',disabled:'disabled'in el?el.disabled:false,...el.tagName==='SELECT'?{options:Array.from(el.options).map(o=>o.label)}:{}})));
  const view={url:this.page.url(),title:await this.page.title(),text:text.slice(0,12000),text_truncated:text.length>12000,controls:controls.slice(0,128),controls_truncated:controls.length>128,alerts:await this.page.getByRole('alert').allTextContents()};
  const matched=/^\/review\/([a-fA-F0-9-]+)$/.exec(new URL(view.url).pathname);
  if(matched){const current=await this.owner.guard(),intent=current.state.intents.find(i=>i.token===matched[1]);if(!intent||intent.scope.operation_id!==this.owner.portal.scope.id)throw new Error('review does not belong to this operation');this.observedReview={token:intent.token,hash:intent.content_sha256,id:intent.id};item.reviewedIntent={id:intent.id,contentSha256:intent.content_sha256};}
  Object.assign(item,view,{status:'captured'});this.trace.push({...view,screenshot});this.owner.receipt.save();return view;
 }
 async execute(name,args){
  this.assertLocal();argumentsFor[name]?.parse(args);await this.owner.guard();if(name==='browser_inspect')return this.observe();
  let locator,meta;
  if(name==='browser_click'){
   if(args.name==='Confirm booking'&&!this.owner.allowConfirm)throw new Error('confirmation_not_authorized');
   locator=this.page.getByRole(args.role,{name:args.name,exact:true});
  }else if(name==='browser_fill'||name==='browser_select')locator=this.page.getByLabel(args.label,{exact:true});else throw new Error('unknown browser tool');
  if(await locator.count()!==1||!await locator.isVisible()||!await locator.isEnabled())throw new Error('browser action requires one visible enabled control');
  meta=await locator.evaluate(el=>({tag:el.tagName,type:el.type,href:el.getAttribute('href'),formAction:el.form?.action,method:el.form?.method,valid:el.form?.checkValidity(),hash:el.form?.querySelector('input[name="intent_hash"]')?.value}));
  if(name==='browser_click'){
   if(args.role==='link'&&(!meta.href||!this.local(new URL(meta.href,this.page.url()).href)))throw new Error('unqualified browser link');
   if(meta.formAction){const method=meta.method.toUpperCase();if(!this.local(meta.formAction,method)||!meta.valid)throw new Error('form validation or destination failed');
    const confirm=/^\/confirm\/([a-fA-F0-9-]+)$/.exec(new URL(meta.formAction).pathname);
    if(confirm){if(!this.owner.allowConfirm||!this.owner.portal.scope.allow_confirm)throw new Error('confirmation_not_authorized');if(!this.observedReview||this.observedReview.token!==confirm[1]||this.observedReview.hash!==meta.hash||new URL(this.page.url()).pathname!==`/review/${confirm[1]}`)throw new Error('confirmation requires the actual current reviewed intent/hash');}
   }
   this.dispatchPrepared();await locator.click();
   if(meta.formAction){const target=new URL(this.page.url()).pathname,form=new URL(meta.formAction).pathname;if(form.startsWith('/confirm/')&&!target.startsWith('/reservations/')||form.endsWith('/review')&&!target.startsWith('/review/')){const failed=await this.observe('failed submission');throw Object.assign(new Error(failed.alerts.join('; ')||'form submission was not confirmed'),{observation:failed});}}
  }else if(name==='browser_fill'){
   if(meta.tag!=='INPUT'||!['email','date'].includes(meta.type))throw new Error('only visible business email/date fields are writable');this.dispatchPrepared();await locator.fill(args.value);
  }else{if(meta.tag!=='SELECT')throw new Error('only visible business selects are writable');this.dispatchPrepared();await locator.selectOption({label:args.option});}
  await this.page.waitForLoadState('domcontentloaded');const view=await this.observe(`${name} ${JSON.stringify(args)}`);if(view.alerts.length)throw Object.assign(new Error(view.alerts.join('; ')),{observation:view});return view;
 }
 dispatchPrepared(){const action=this.owner.activeAction;if(!action||action.status!=='prepared')throw new Error('browser dispatch lacks prepared application authority');action.dispatchPrepared=true;action.dispatchPreparedAt=new Date().toISOString();this.owner.receipt.save();this.owner.basicGuard();}
 async close(){
  if(this.closeAttempted)throw new Error('browser close already attempted');this.closeAttempted=true;const errors=[];this.owner.signal.removeEventListener('abort',this.abort);
  if(this.context)try{await this.context.close();this.owner.receipt.data.lifecycle.contextClosed=true;}catch(e){errors.push(e);}else this.owner.receipt.data.lifecycle.contextClosed=true;
  if(this.browser)try{await this.browser.close();this.owner.receipt.data.lifecycle.browserClosed=true;}catch(e){errors.push(e);}else this.owner.receipt.data.lifecycle.browserClosed=true;
  if(errors.length)throw errors[0];this.closed=true;
 }
}
