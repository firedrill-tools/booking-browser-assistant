import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {runAssistant} from '../src/operator.js';
import {BrowserSession} from '../src/browser.js';
import {Native} from '../src/native.js';
import {environment,bookingActions,bodyFor} from './helpers.js';
const task='Review S-101 for mia@acme.example in Europe/London and confirm only when app permission allows';
test('review-only is enforced despite a completed native Confirm request and untrusted task wording',async t=>{
 const e=await environment(t);await assert.rejects(runAssistant('Review only. Do not confirm a booking.',{...e.options,allowConfirm:false}),/confirmation_not_authorized/);
 const state=e.store.read(),trace=e.trace();assert.equal(state.reservations.length,1);assert.equal(state.intents.length,1);assert.equal(state.intents[0].scope.allow_confirm,false);assert.equal(state.intents[0].status,'reviewed');assert.equal(state.operations[0].status,'closed');assert.ok(trace.cleanupConfirmed);assert.equal(trace.actions.at(-1).dispatchPrepared,undefined);assert.equal(trace.status,'failed');
});
test('normal review-only completion retains a real review and no reservation',async t=>{
 const e=await environment(t,{actions:bookingActions.slice(0,4)}),{result}=await runAssistant('Review S-101 only',{...e.options,allowConfirm:false});assert.deepEqual(result.business.reservationIds,[]);assert.equal(result.business.reviewedIntentIds.length,1);assert.equal(e.store.read().reservations.length,1);assert.equal(e.trace().status,'completed');
});
test('original MAX_TOKENS confirmation is rejected before the real browser action',async t=>{
 const e=await environment(t,{mutate:(b,n)=>{if(n===5)b.candidates[0].finishReason='MAX_TOKENS';return b;}});await assert.rejects(runAssistant(task,e.options),/unfinished/);
 const trace=e.trace();assert.equal(e.store.read().reservations.length,1);assert.equal(e.store.read().intents[0].status,'reviewed');assert.equal(trace.actions.length,4);assert.equal(trace.calls.length,5);assert.equal(trace.calls[4].response.body.candidates[0].finishReason,'MAX_TOKENS');assert.ok(trace.cleanupConfirmed);
});
for(const kind of ['absent-stop','refusal','blocked','parallel','mixed','unknown-tool','extra-args','forged-result','blank','multiple-candidates','wrong-role','replay'])test(`original ${kind} cannot dispatch an unsafe browser action`,async t=>{
 const e=await environment(t,{mutate:(b,n)=>{if(kind==='replay'&&n===2)b.candidates[0].content.parts[0].functionCall.id='call-1';if(n!==1)return b;const c=b.candidates[0],p=c.content.parts;
  if(kind==='absent-stop')delete c.finishReason;if(kind==='refusal')c.finishReason='SAFETY';if(kind==='blocked')b.promptFeedback={blockReason:'SAFETY'};if(kind==='parallel')p.push({...p[0],functionCall:{...p[0].functionCall,id:'other'}});if(kind==='mixed')p.push({text:'I confirmed it'});if(kind==='unknown-tool')p[0].functionCall.name='confirm_booking';if(kind==='extra-args')p[0].functionCall.args.extra=true;if(kind==='forged-result')c.content.parts=[{functionResponse:{name:'browser_inspect',response:{ok:true}}}];if(kind==='blank')c.content.parts=[{text:' '}];if(kind==='multiple-candidates')b.candidates.push(c);if(kind==='wrong-role')c.content.role='user';return b;
 }});await assert.rejects(runAssistant(task,e.options));assert.equal(e.store.read().reservations.length,1);assert.equal(e.store.read().intents.length,0);const trace=e.trace();assert.equal(trace.status,'failed');assert.equal(trace.actions.length,kind==='replay'?1:0);assert.ok(trace.cleanupConfirmed);
});
test('provider error after a real confirmation preserves the actual reservation and fails overall',async t=>{
 const e=await environment(t,{mutate:(b,n)=>{if(n===6)b.candidates[0].finishReason='MAX_TOKENS';return b;}});await assert.rejects(runAssistant(task,e.options));assert.equal(e.store.read().reservations.length,2);assert.equal(e.store.read().intents[0].status,'confirmed');const trace=e.trace();assert.equal(trace.status,'failed');assert.equal(trace.result,null);assert.equal(trace.finalSource.state.reservations.length,2);assert.ok(trace.cleanupConfirmed);
});
test('unknown optional native ID/empty arguments and usage remain unknown instead of SDK defaults',async t=>{
 const e=await environment(t,{actions:[['browser_inspect',{}]],mutate:b=>{delete b.usageMetadata;const fn=b.candidates[0].content.parts[0].functionCall;if(fn){delete fn.id;delete fn.args;}return b;}});await runAssistant('Inspect current availability only',{...e.options,allowConfirm:false});const trace=e.trace();assert.equal(trace.actions[0].originalFunctionId,null);assert.equal(trace.reportedUsage.input.value,null);assert.equal(trace.reportedUsage.input.unknown,2);assert.equal(trace.reportedUsage.costUsd,null);assert.equal(trace.sdk.length,2);
});
test('original zero/cache/contradictory usage stays separate from SDK normalization',async t=>{
 const e=await environment(t,{actions:[],mutate:b=>{b.usageMetadata={promptTokenCount:0,candidatesTokenCount:0,totalTokenCount:99,cachedContentTokenCount:0};return b;}});await runAssistant('Inspect current availability',{...e.options,allowConfirm:false});const trace=e.trace();assert.equal(trace.reportedUsage.input.value,0);assert.equal(trace.reportedUsage.cachedInput.value,0);assert.equal(trace.reportedUsage.total.value,99);assert.equal(trace.reportedUsage.thoughts.value,null);assert.equal(trace.calls[0].response.body.unknown_original.retained,true);
});
test('HTTP failure retains original usage/body and never retries',async t=>{
 const e=await environment(t,{mutate:(b,n,{res})=>{res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'controlled quota'},usageMetadata:{promptTokenCount:3,candidatesTokenCount:0,totalTokenCount:99}}));return b;}});await assert.rejects(runAssistant(task,e.options),/HTTP 429/);const trace=e.trace();assert.equal(e.requests.length,1);assert.equal(trace.calls[0].reportedUsage.input.value,3);assert.equal(trace.calls[0].reportedUsage.output.value,0);assert.equal(trace.calls[0].response.status,429);assert.ok(trace.cleanupConfirmed);
});
test('malformed and oversized original decoded responses retain honest complete/partial evidence',async t=>{
 for(const kind of ['json','oversize']){
  const e=await environment(t,{mutate:(b,n,{res})=>{if(kind==='json'){res.writeHead(200,{'content-type':'application/json'});res.end('{"candidates":');}else b.candidates[0].content.parts=[{text:'x'.repeat(1048577)}];return b;}});await assert.rejects(runAssistant(task,e.options));const trace=e.trace(),response=trace.calls[0].response;assert.equal(response.complete,kind==='json');assert.ok(response.bodyBase64.length>0);if(kind==='oversize'){assert.equal(response.bodySha256,null);assert.equal(response.retainedBytes,1048576);}assert.equal(trace.reportedUsage.input.value,null);assert.ok(trace.cleanupConfirmed);
 }
});
test('last prepared native request cannot dispatch another browser tool',async t=>{
 const e=await environment(t,{actions:Array.from({length:18},()=>['browser_inspect',{}])});await assert.rejects(runAssistant('Inspect availability only',{...e.options,allowConfirm:false}),/budget-exhausted/);assert.equal(e.requests.length,18);assert.equal(e.trace().actions.length,17);assert.equal(e.store.read().reservations.length,1);assert.ok(e.trace().cleanupConfirmed);
});
test('same-revision source movement between real review and confirmation stops the actual form',async t=>{
 const e=await environment(t,{mutate:(b,n,{file})=>{if(n===5){const state=JSON.parse(fs.readFileSync(file));state.slots[0].starts_at_utc='2026-11-04T15:00:00Z';fs.writeFileSync(file,JSON.stringify(state));}return b;}});await assert.rejects(runAssistant(task,e.options),/availability_changed/);assert.equal(e.store.read().reservations.length,1);assert.equal(e.trace().actions.at(-1).status,'failed');assert.ok(e.trace().cleanupConfirmed);
});
test('foreign redirects are blocked before a scoped browser credential can reach another origin',async t=>{
 let received=0;const foreign=createServer((_req,res)=>{received++;res.end('outside');});foreign.listen(0,'127.0.0.1');await once(foreign,'listening');t.after(()=>new Promise(r=>foreign.close(r)));
 const e=await environment(t,{wrap:app=>(req,res)=>{if(req.url==='/slots/S-101'){res.writeHead(302,{location:`http://127.0.0.1:${foreign.address().port}/outside`});res.end();}else app(req,res);}});await assert.rejects(runAssistant(task,e.options),/blocked|outside|failed|ERR_/i);assert.equal(received,0);assert.equal(e.store.read().reservations.length,1);assert.ok(e.trace().blockedRequests.some(r=>r.kind==='redirect'));assert.ok(e.trace().cleanupConfirmed);
});
test('browser startup failure closes the actual allocated context/browser before a model request',async t=>{
 const e=await environment(t,{wrap:app=>(req,res)=>{if(req.url==='/'){res.writeHead(503);res.end('portal unavailable');}else app(req,res);}});await assert.rejects(runAssistant(task,e.options),/startup/);assert.equal(e.requests.length,0);const trace=e.trace();assert.equal(trace.lifecycle.browserAllocated,true);assert.equal(trace.lifecycle.browserClosed,true);assert.equal(trace.lifecycle.contextClosed,true);assert.ok(trace.cleanupConfirmed);
});
async function enteredOrSettled(entry,promise){let timer;try{await Promise.race([entry,promise.then(()=>{throw new Error('operation settled before native HTTP entry');},e=>{throw e;}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('bounded native HTTP entry wait expired')),10000);})]);}finally{clearTimeout(timer);}}
test('parent cancellation drains an actual pending native request and closes its operation',async t=>{
 let entered,release;const entry=new Promise(r=>entered=r),hold=new Promise(r=>release=r);const e=await environment(t,{mutate:async b=>{entered();await hold;return b;}}),controller=new AbortController(),promise=runAssistant(task,{...e.options,signal:controller.signal});promise.catch(()=>{});
 try{await enteredOrSettled(entry,promise);controller.abort(new Error('controlled parent cancellation'));await assert.rejects(promise,/parent cancellation/);}finally{release();}
 assert.equal(e.store.read().reservations.length,1);assert.equal(e.store.read().operations[0].status,'closed');assert.ok(e.trace().cleanupConfirmed);
});
test('operation deadline cancels real pending HTTP after a bounded startup/settlement race',{timeout:15000},async t=>{
 let entered,release;const entry=new Promise(r=>entered=r),hold=new Promise(r=>release=r);const e=await environment(t,{mutate:async b=>{entered();await hold;return b;}}),promise=runAssistant(task,{...e.options,timeoutMs:6000});promise.catch(()=>{});
 try{await enteredOrSettled(entry,promise);await assert.rejects(promise,/deadline|timeout/i);}finally{release();}assert.equal(e.store.read().reservations.length,1);assert.ok(e.trace().cleanupConfirmed);
});
test('recording failure after a real booking retains the effect and cannot claim durable success',async t=>{
 const e=await environment(t);let failure;try{await runAssistant(task,{...e.options,writer:r=>{if(r.data.actions.some(a=>a.args.name==='Confirm booking'&&a.status==='finished'))throw new Error('controlled recording failure');}});}catch(e){failure=e;}
 assert.equal(e.store.read().reservations.length,2);assert.equal(failure.result.status,'failed');assert.equal(failure.result.result,null);assert.equal(failure.result.durableStatus,'unknown');assert.equal(failure.result.finalSource.state.reservations.length,2);assert.ok(failure.result.cleanupConfirmed);
});
test('native close failure remains unconfirmed without a second empty close',async t=>{
 let attempts=0;t.mock.method(Native.prototype,'close',async function(){attempts++;this.closeAttempted=true;await this.pool.destroy();throw new Error('controlled native close failure');});const e=await environment(t,{actions:[]});await assert.rejects(runAssistant('Inspect only',{...e.options,allowConfirm:false}),/close failure/);assert.equal(attempts,1);assert.equal(e.trace().status,'failed');assert.equal(e.trace().lifecycle.nativeHTTPClosed,false);assert.equal(e.trace().cleanupConfirmed,false);
});
test('browser close failure preserves unconfirmed cleanup and an awaited independent test cleanup',async t=>{
 let browser,attempts=0;t.mock.method(BrowserSession.prototype,'close',async function(){attempts++;this.closeAttempted=true;this.owner.signal.removeEventListener('abort',this.abort);await this.context.close();this.owner.receipt.data.lifecycle.contextClosed=true;browser=this.browser;throw new Error('controlled browser close failure');});t.after(async()=>{await browser?.close();});const e=await environment(t,{actions:[]});await assert.rejects(runAssistant('Inspect only',{...e.options,allowConfirm:false}),/browser close failure/);assert.equal(attempts,1);assert.equal(e.trace().lifecycle.browserClosed,false);assert.equal(e.trace().cleanupConfirmed,false);assert.equal(e.store.read().operations[0].status,'closed');
});
test('two simultaneous runs own separate browsers/native transports and closing one leaves the other usable',{timeout:20000},async t=>{
 let entered,release;const entry=new Promise(r=>entered=r),hold=new Promise(r=>release=r);const e=await environment(t,{mutate:async(b,n,{request})=>{if(JSON.stringify(request.contents[0]).includes('cancel-this-run')){entered();await hold;}return b;}}),controller=new AbortController(),first=runAssistant('cancel-this-run: inspect only',{...e.options,allowConfirm:false,signal:controller.signal});first.catch(()=>{});await enteredOrSettled(entry,first);
 const second=runAssistant(task,e.options);try{controller.abort(new Error('cancel one run'));await assert.rejects(first,/cancel one/);release();const done=await second;assert.equal(done.result.business.reservationIds.length,1);}finally{release();}
 assert.equal(e.store.read().reservations.length,2);assert.equal(e.store.read().operations.filter(o=>o.status==='closed').length,2);
});

test('missing keys and unsupported injected clients fail before browser, portal registration or provider traffic',async t=>{
 for(const options of [{apiKey:''},{client:{models:{generateContent(){throw new Error('unowned client must remain unused');}}}}]){
  const e=await environment(t);const before=fs.readFileSync(e.file);await assert.rejects(runAssistant('Inspect availability',{...e.options,...options}));assert.equal(e.requests.length,0);assert.deepEqual(fs.readFileSync(e.file),before);const trace=e.trace();assert.equal(trace.lifecycle.browserAllocated,false);assert.equal(trace.calls.length,0);assert.equal(trace.reportedUsage.input.value,null);assert.ok(trace.cleanupConfirmed);
 }
});
test('corrupt source after original final text preserves the actual booking and refuses success without repair',async t=>{
 const e=await environment(t,{mutate:(b,n,{file})=>{if(n===6){const state=JSON.parse(fs.readFileSync(file));state.synthetic=false;fs.writeFileSync(file,JSON.stringify(state));}return b;}});await assert.rejects(runAssistant(task,e.options));const trace=e.trace();assert.equal(trace.status,'failed');assert.equal(trace.result,null);assert.equal(trace.finalSource,null);assert.ok(trace.finalSourceError);assert.equal(trace.lifecycle.browserClosed,true);assert.equal(trace.lifecycle.nativeHTTPClosed,true);assert.equal(trace.lifecycle.operationClosed,false);const raw=JSON.parse(fs.readFileSync(e.file));assert.equal(raw.synthetic,false);assert.equal(raw.reservations.length,2);
});
test('cancelling a real pending confirmation closes the operation and fences a late reservation commit',{timeout:15000},async t=>{
 const {default:express}=await import('express');let entered,release,resumed;const entry=new Promise(r=>entered=r),hold=new Promise(r=>release=r),finished=new Promise(r=>resumed=r);let captured;
 const e=await environment(t,{wrap:app=>{const outer=express();outer.use(express.raw({type:()=>true,limit:'1mb'}));outer.use(async(req,res,next)=>{
  if(req.url.startsWith('/confirm/')){captured={token:req.url.split('/').at(-1),hash:new URLSearchParams(req.body.toString()).get('intent_hash'),credential:req.headers['x-booking-operation']};entered();await hold;app(req,res,next);resumed();}else app(req,res,next);
 });return outer;}}),controller=new AbortController(),promise=runAssistant(task,{...e.options,signal:controller.signal});promise.catch(()=>{});
 try{
  await enteredOrSettled(entry,promise);controller.abort(new Error('cancel pending confirmation'));await assert.rejects(promise,/pending confirmation/);
  assert.equal(e.store.read().reservations.length,1);assert.equal(e.store.read().operations[0].status,'closed');assert.throws(()=>e.store.confirm(captured.token,captured.hash,captured.credential),/operation_closed/);
  release();await finished;assert.equal(e.store.read().reservations.length,1);assert.equal(e.trace().actions.at(-1).dispatchPrepared,true);assert.ok(e.trace().cleanupConfirmed);
 }finally{release();}
});
