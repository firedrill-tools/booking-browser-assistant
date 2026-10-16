import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {environment} from './helpers.js';
const cli=fileURLToPath(new URL('../src/operator.js',import.meta.url));
function start(e,{permission=true}={}){
 const env=Object.fromEntries(['PATH','HOME','TMPDIR','TMP','TEMP','LANG','LC_ALL','PLAYWRIGHT_BROWSERS_PATH','SystemRoot','WINDIR'].filter(k=>typeof process.env[k]==='string').map(k=>[k,process.env[k]]));env.GOOGLE_API_KEY='synthetic-booking-key';
 const child=spawn(process.execPath,[cli,'--model','controlled-gemini','--base-url',e.options.providerBaseUrl,'--portal-url',e.options.portalUrl,'--output',e.directory,...permission?['--allow-confirm']:[],'Review S-101 for mia@acme.example in Europe/London and confirm if permitted'],{env,cwd:e.directory,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,out,err}));});return{child,done};
}
async function within(promise,ms){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('bounded CLI wait expired')),ms);})]);}finally{clearTimeout(timer);}}
test('normal CLI runs actual Gemini HTTP and Chromium, reports real booking/usage and exits cleanly',{timeout:20000},async t=>{
 const e=await environment(t),{child,done}=start(e);try{const result=await within(done,15000);assert.equal(result.code,0,result.err+result.out);const output=JSON.parse(result.out);assert.equal(output.business.reservationIds[0],'R-2');assert.equal(output.business.reservations[0].timezone,'Europe/London');assert.equal(output.usage.input.value,60);assert.equal(output.usage.costUsd,null);assert.ok(e.trace().cleanupConfirmed);assert.equal(e.requests.length,6);}finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await done;}
});
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])test(`normal CLI ${signal} drains native HTTP and its scoped browser/operation`,{timeout:20000},async t=>{
 let entered,release;const entry=new Promise(r=>entered=r),hold=new Promise(r=>release=r),e=await environment(t,{mutate:async body=>{entered();await hold;return body;}}),{child,done}=start(e,{permission:false});
 try{await within(Promise.race([entry,done.then(r=>{throw new Error('CLI settled before native HTTP: '+r.out+r.err);})]),10000);child.kill(signal);const result=await within(done,10000);assert.equal(result.code,1,result.err+result.out);const output=JSON.parse(result.out);assert.equal(output.ok,false);assert.match(output.error,new RegExp(signal));assert.equal(output.cleanupConfirmed,true,JSON.stringify(e.trace().lifecycle));assert.equal(output.usage.input.value,null);assert.equal(e.store.read().reservations.length,1);assert.equal(e.store.read().operations[0].status,'closed');assert.equal(e.requests.length,1);assert.equal(e.trace().status,'failed');}
 finally{release();if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await done;}
});
