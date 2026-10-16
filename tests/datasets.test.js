import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {populations,initialize,inspect,reset,validatePopulation} from '../src/datasets.js';
import {Store,displayTime} from '../src/state.js';
import {hash,canonical} from '../src/schema.js';
import {runAssistant} from '../src/operator.js';
import {environment,bookingActions} from './helpers.js';
const cli=new URL('../src/workspace.js',import.meta.url);
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'booking-data-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function call(...args){const r=spawnSync(process.execPath,[fileURLToPath(cli),...args],{encoding:'utf8',env:Object.fromEntries(Object.entries(process.env).filter(([k])=>!['GOOGLE_API_KEY','GEMINI_MODEL','GOOGLE_GENAI_USE_VERTEXAI'].includes(k)))});assert.equal(r.status,0,r.stderr+r.stdout);return JSON.parse(r.stdout);}
test('twelve hash-bound populations retain coherent imported history, busy capacity and explicit unknown provenance',()=>{
 const rows=populations();assert.equal(rows.length,12);assert.equal(new Set(rows.map(p=>p.profile)).size,4);const busy=rows.find(p=>p.profile==='busy');assert.equal(busy.state.slots.length,51);assert.equal(busy.state.reservations.length,65);assert.equal(busy.state.intents.filter(i=>i.status==='reviewed').length,16);assert.equal(busy.history.length,144);
 for(const p of rows){assert.deepEqual(validatePopulation(p),p);assert.equal(p.provenance.prior_model_evidence,null);assert.equal(p.provenance.prior_human_authentication,null);assert.equal(p.provenance.prior_external_booking_delivery,null);assert.equal(p.state.instance_id,undefined);assert.equal(p.state.dataset,undefined);}
 const broken=structuredClone(busy);broken.history[0].source_audit_sha256='0'.repeat(64);assert.throws(()=>validatePopulation(broken),/original audit/);const bad=structuredClone(busy);bad.state.slots[3].booked--;assert.throws(()=>validatePopulation(bad),/booked count|confirmed slot history/);
 const fold=rows.find(p=>p.id==='dst-fold').state;assert.match(displayTime(fold.slots[0].starts_at_utc,'America/Toronto'),/1:30.*EDT/);assert.match(displayTime(fold.slots[2].starts_at_utc,'America/Toronto'),/1:30.*EST/);
});
test('model-free CLI initializes, reads and resets all twelve cases at private exclusive fresh destinations',t=>{
 const dir=directory(t),rows=call('list').cases;assert.equal(rows.length,12);
 for(const p of rows){const file=path.join(dir,p.id,'state.json'),first=call('init',file,'--case',p.id),before=fs.readFileSync(file),metadata=fs.readFileSync(file+'.source.json');assert.equal(first.original_seed_match,true);assert.equal(first.case_id,p.id);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(file+'.source.json').mode&0o777,0o600);assert.equal(call('inspect',file).instance_id,first.instance_id);
  const store=new Store(file);store.transaction(()=>({result:null,dirty:false}));const mutex=fs.readFileSync(store.lock),evidence=path.join(path.dirname(file),'private-evidence.txt');fs.writeFileSync(evidence,'keep original evidence');const newer=call('reset',file,path.join(dir,'reset-'+p.id,'state.json'));assert.notEqual(newer.instance_id,first.instance_id);assert.equal(newer.original_seed_match,true);assert.deepEqual(fs.readFileSync(file),before);assert.deepEqual(fs.readFileSync(file+'.source.json'),metadata);assert.deepEqual(fs.readFileSync(store.lock),mutex);assert.equal(fs.readFileSync(evidence,'utf8'),'keep original evidence');
  assert.throws(()=>initialize(file,p.id),/already exists/);assert.throws(()=>reset(file,file),/distinct fresh/);
 }
});
test('source authority refuses absent, corrupt, foreign or stripped metadata and never repairs bytes',t=>{
 const dir=directory(t),file=path.join(dir,'state.json');initialize(file,'busy-calendar');const raw=fs.readFileSync(file),meta=fs.readFileSync(file+'.source.json'),store=new Store(file);
 for(const change of [()=>fs.unlinkSync(file+'.source.json'),()=>fs.writeFileSync(file+'.source.json','{'),()=>{const m=JSON.parse(meta);m.instance_id='00000000-0000-4000-8000-000000000001';fs.writeFileSync(file+'.source.json',JSON.stringify(m));},()=>{const s=JSON.parse(raw);delete s.dataset;fs.writeFileSync(file,JSON.stringify(s));},()=>{const s=JSON.parse(raw);s.dataset.case_id='sold-out';fs.writeFileSync(file,JSON.stringify(s));}]){fs.writeFileSync(file,raw);fs.writeFileSync(file+'.source.json',meta);change();const before=fs.readFileSync(file);assert.throws(()=>store.read());assert.throws(()=>reset(file,path.join(dir,'not-created.json')));assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.existsSync(path.join(dir,'not-created.json')),false);}
 fs.writeFileSync(file,raw);fs.writeFileSync(file+'.source.json',meta);const changed=JSON.parse(raw);changed.service.location='Corrected synthetic desk';fs.writeFileSync(file,JSON.stringify(changed));assert.equal(inspect(file,store.read()).original_seed_match,false);assert.equal(inspect(file,store.read()).provenance.prior_model_evidence,null);
});
test('imported pending tokens are stale after initialization and fresh reviews cannot replay across resets or new stores',t=>{
 const dir=directory(t),file=path.join(dir,'old.json');initialize(file,'busy-calendar');const store=new Store(file),pending=store.read().intents.find(i=>i.status==='reviewed');assert.equal(pending.source.instance_id,null);assert.equal(store.confirm(pending.token,pending.content_sha256).error,'availability_changed');
 const first=store.review('S-101','mia@acme.example','Europe/London',1).intent;assert.equal(first.source.instance_id,store.instance);const next=path.join(dir,'new.json');reset(file,next);const newer=new Store(next);assert.equal(newer.confirm(first.token,first.content_sha256).error,'intent_not_found');const raw=fs.readFileSync(file),meta=fs.readFileSync(file+'.source.json');fs.writeFileSync(file,fs.readFileSync(next));fs.writeFileSync(file+'.source.json',fs.readFileSync(next+'.source.json'));assert.throws(()=>store.read(),/instance changed/);fs.writeFileSync(file,raw);fs.writeFileSync(file+'.source.json',meta);
 const retained=store.read().intents.find(i=>i.id===first.id);assert.equal(store.confirm(retained.token,retained.content_sha256).reservation.intent_sha256,first.content_sha256);
});
for(const p of populations())test(`actual native SDK/browser case ${p.id} preserves exact local effects and genuine captures`,{timeout:20000},async t=>{
 let actions=structuredClone(bookingActions),allowConfirm=!['available-review','hostile-service','sold-out','duplicate-customer'].includes(p.id),slot=p.id==='dst-fold'?'S-103':'S-101',zone=p.id==='dst-fold'?'America/Toronto':['alternate-service','cross-date'].includes(p.id)?'America/Los_Angeles':'Europe/London';
 actions[0][1].name=`Review ${p.id==='sold-out'?'S-102':slot} →`;actions[2][1].option=zone;
 if(p.id==='busy-calendar')actions.unshift(['browser_fill',{label:'Date (America/Toronto)',value:'2026-11-03'}],['browser_click',{role:'button',name:'Search times'}]);
 if(!allowConfirm)actions=actions.slice(0,p.id==='sold-out'?1:p.id==='duplicate-customer'?4:4);
 const e=await environment(t,{caseId:p.id,actions,mutate:(body,_n,{round,store})=>{if(p.id==='changed-availability'&&round===5)store.setAvailability(slot,3);return body;}}),initial=e.store.read(),expectedFailure=['sold-out','duplicate-customer','changed-availability','maximum-revision'].includes(p.id);let result;
 if(expectedFailure)await assert.rejects(runAssistant(p.task,{...e.options,allowConfirm}),/sold out|already_reserved|Availability|changed|invalid_source_or_request|submission|revision/);
 else ({result}=await runAssistant(p.task,{...e.options,allowConfirm}));
 const final=e.store.read(),receipt=e.trace();assert.ok(receipt.cleanupConfirmed);assert.equal(receipt.status,expectedFailure?'failed':'completed');assert.ok(receipt.observations.length>=2);for(const o of receipt.observations){assert.equal(hash(fs.readFileSync(o.screenshot)),o.screenshotSha256);assert.equal(fs.statSync(o.screenshot).mode&0o777,0o600);}
 assert.deepEqual(final.reservations.slice(0,initial.reservations.length),initial.reservations);assert.deepEqual(final.intents.slice(0,initial.intents.length),initial.intents);assert.deepEqual(final.audit.slice(0,initial.audit.length),initial.audit);
 const committed=allowConfirm&&!expectedFailure;assert.equal(final.reservations.length,initial.reservations.length+Number(committed));if(committed){const r=final.reservations.at(-1);assert.equal(r.slot_id,slot);assert.equal(r.starts_at_utc,initial.slots.find(s=>s.id===slot).starts_at_utc);assert.equal(r.email,'mia@acme.example');assert.equal(r.timezone,zone);assert.equal(result.business.reservationIds[0],r.id);assert.equal(final.intents.at(-1).confirmation.actor_kind,'operator');}
 const context=JSON.stringify(e.requests);for(const key of ['booking-populations','case_id','source_sha256','original_imported','prior_model_evidence','step-00.png','synthetic-booking-key'])assert.ok(!context.includes(key),key);if(p.id==='hostile-service'){assert.equal(receipt.blockedRequests,undefined);assert.equal(final.reservations.length,initial.reservations.length);}
});
