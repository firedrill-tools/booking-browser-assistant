import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {Store} from '../src/state.js';
import {hash} from '../src/schema.js';
import {startServer} from '../src/server.js';
function setup(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'booking-integrity-')),file=path.join(directory,'state.json');fs.copyFileSync(new URL('../fixtures/starter.json',import.meta.url),file);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return{file,store:new Store(file)};}
function edit(file,fn){const s=JSON.parse(fs.readFileSync(file,'utf8'));fn(s);fs.writeFileSync(file,JSON.stringify(s));}
function review(store,credential=null){return store.review('S-101','mia@acme.example','Europe/London',1,credential).intent;}
for(const field of ['email','timezone','slot','source'])test(`saved reviewed ${field} tampering cannot commit another reservation`,t=>{
 const{file,store}=setup(t),intent=review(store);edit(file,s=>{if(field==='email')s.intents[0].email='different@acme.example';if(field==='timezone')s.intents[0].timezone='America/Los_Angeles';if(field==='slot')s.intents[0].slot_id='S-103';if(field==='source')s.intents[0].source.slot.starts_at_utc='2026-11-04T15:00:00Z';});const before=fs.readFileSync(file);assert.throws(()=>store.confirm(intent.token,intent.content_sha256),/reviewed source\/hash/);assert.deepEqual(fs.readFileSync(file),before);
});
for(const field of ['time','service','capacity'])test(`same-revision ${field} change blocks confirmation of different reviewed facts`,t=>{
 const{store,file}=setup(t),intent=review(store);edit(file,s=>{if(field==='time')s.slots[0].starts_at_utc='2026-11-04T15:00:00Z';if(field==='service')s.service.location='Different service desk';if(field==='capacity')s.slots[0].capacity=2;});assert.equal(store.confirm(intent.token,intent.content_sha256).error,'availability_changed');assert.equal(store.read().reservations.length,1);assert.equal(store.read().intents[0].status,'reviewed');
});
test('strict source refuses invalid header/UTC/contacts/counts/duplicate IDs and ambiguous JSON without repair',t=>{
 const{file}=setup(t),original=fs.readFileSync(file,'utf8');for(const fn of [s=>s.version=true,s=>s.service.extra=true,s=>s.slots[0].revision=Number.MAX_SAFE_INTEGER+1,s=>s.slots[0].booked=1,s=>s.slots[0].starts_at_utc='2026-02-30T15:00:00Z',s=>s.reservations[0].email='real@outside.com',s=>s.slots.push(s.slots[0])]){const s=JSON.parse(original);fn(s);fs.writeFileSync(file,JSON.stringify(s));const before=fs.readFileSync(file);assert.throws(()=>new Store(file));assert.deepEqual(fs.readFileSync(file),before);}
 fs.writeFileSync(file,original.replace('"version": 1','"version": 1, "version": 1'));assert.throws(()=>new Store(file),/duplicate JSON key/);
});
test('review revisions are exact nonboolean safe integers and a final review hash is required',t=>{
 const{store}=setup(t);for(const revision of [true,false,'1',1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(store.review('S-101','mia@acme.example','Europe/London',revision).error,'invalid_review_arguments');const intent=review(store);assert.equal(store.confirm(intent.token).error,'review_hash_required');assert.equal(store.confirm(intent.token,'0'.repeat(64)).error,'review_hash_changed');assert.equal(store.read().reservations.length,1);
});
test('review-only operation, wrong operation, and closed credentials cannot authorize final booking',t=>{
 const{store}=setup(t),first=store.registerOperation(hash('review only'),false),other=store.registerOperation(hash('other customer'),true),intent=review(store,first.credential);
 assert.equal(store.confirm(intent.token,intent.content_sha256,first.credential).error,'confirmation_not_authorized');assert.equal(store.confirm(intent.token,intent.content_sha256,other.credential).error,'review_not_owned');store.closeOperation(first.credential);assert.throws(()=>store.confirm(intent.token,intent.content_sha256,first.credential),/operation_closed/);assert.equal(store.read().reservations.length,1);
});
test('separate synthetic human confirmation can explicitly decide a review-only proposal',t=>{
 const{store}=setup(t),op=store.registerOperation(hash('review only'),false),intent=review(store,op.credential);store.closeOperation(op.credential);const result=store.confirm(intent.token,intent.content_sha256);assert.equal(result.reservation.email,'mia@acme.example');const saved=store.read().intents[0];assert.equal(saved.scope.allow_confirm,false);assert.equal(saved.confirmation.actor_kind,'synthetic_human');assert.equal(saved.confirmation.operation_id,null);assert.equal(store.read().reservations.length,2);
});
test('authorized operator confirmation is bound to its exact scope/review and preserves imported history',t=>{
 const{store}=setup(t),before=store.read().reservations[0],op=store.registerOperation(hash('confirm exact appointment'),true),intent=review(store,op.credential);const r=store.confirm(intent.token,intent.content_sha256,op.credential);assert.equal(r.reservation.intent_sha256,intent.content_sha256);assert.equal(store.read().intents[0].confirmation.operation_id,op.operation.id);assert.deepEqual(store.read().reservations[0],before);assert.equal(store.confirm(intent.token,intent.content_sha256,op.credential).error,'already_confirmed');store.closeOperation(op.credential);
});
test('reservation content and captured confirmation cannot drift from the original reviewed payload',t=>{
 const{file,store}=setup(t),intent=review(store);store.confirm(intent.token,intent.content_sha256);const original=fs.readFileSync(file,'utf8');for(const change of [s=>s.reservations[1].timezone='America/Toronto',s=>s.intents[0].confirmation.intent_sha256='0'.repeat(64),s=>s.intents[0].confirmation.source.service.name='Changed',s=>s.slots[0].booked=0]){fs.writeFileSync(file,original);edit(file,change);assert.throws(()=>store.read());}
});
test('exhausted revisions and new instance replacement cannot commit or reopen through an old store',t=>{
 const{file}=setup(t);edit(file,s=>{s.instance_id='00000000-0000-4000-8000-000000000001';s.slots[0].revision=Number.MAX_SAFE_INTEGER;});const store=new Store(file),intent=store.review('S-101','mia@acme.example','Europe/London',Number.MAX_SAFE_INTEGER).intent,before=fs.readFileSync(file);assert.throws(()=>store.confirm(intent.token,intent.content_sha256),/revision_exhausted/);assert.deepEqual(fs.readFileSync(file),before);edit(file,s=>s.instance_id='00000000-0000-4000-8000-000000000002');assert.throws(()=>store.read(),/instance changed/);
});
test('actual independent processes serialize one final reservation',async t=>{
 const{file,store}=setup(t),intent=review(store),module=new URL('../src/state.js',import.meta.url).href;
 const script=`import {Store} from ${JSON.stringify(module)};try{process.stdout.write(JSON.stringify(new Store(process.argv[1]).confirm(process.argv[2],process.argv[3])))}catch(e){process.stdout.write(JSON.stringify({error:e.message}))}`;
 const replies=await Promise.all(Array.from({length:6},()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',script,file,intent.token,intent.content_sha256],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',code=>code===0?resolve(JSON.parse(out)):reject(new Error(err)));})));
 assert.equal(replies.filter(r=>r.reservation).length,1);assert.equal(store.read().reservations.length,2);assert.equal(store.read().slots[0].booked,1);
});
test('real HTTP form/body/source and operation boundaries reject ambiguity and show original stale review',async t=>{
 const{file,store}=setup(t),server=await startServer(file,0);t.after(()=>new Promise(r=>server.close(r)));const base=`http://127.0.0.1:${server.address().port}`,before=fs.readFileSync(file);
 for(const body of ['email=mia%40acme.example&timezone=Europe%2FLondon&revision=true','email=mia%40acme.example&timezone=Europe%2FLondon&revision=1&revision=1','email=mia%40acme.example&timezone=Europe%2FLondon&revision=1&extra=yes']){const r=await fetch(base+'/slots/S-101/review',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});assert.ok([400,422].includes(r.status));assert.deepEqual(fs.readFileSync(file),before);}
 const foreign=await fetch(base+'/slots/S-101/review',{method:'POST',headers:{origin:'https://outside.example','content-type':'application/x-www-form-urlencoded'},body:'email=mia%40acme.example&timezone=Europe%2FLondon&revision=1'});assert.equal(foreign.status,403);
 const op=store.registerOperation(hash('only review'),false),intent=review(store,op.credential),headers={'x-booking-operation':op.credential};const page=await(await fetch(base+'/review/'+intent.token,{headers})).text();assert.match(page,/Review only/);assert.ok(!page.includes('<button>Confirm booking</button>'));
 const direct=await fetch(base+'/confirm/'+intent.token,{method:'POST',headers:{...headers,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({intent_hash:intent.content_sha256})});assert.equal(direct.status,409);assert.equal(store.read().reservations.length,1);
 edit(file,s=>s.slots[0].starts_at_utc='2026-11-04T15:00:00Z');const stale=await(await fetch(base+'/review/'+intent.token)).text();assert.match(stale,/2026-11-03T15:00:00Z/);assert.match(stale,/details changed/);assert.ok(!stale.includes('<button>Confirm booking</button>'));
 const ambiguous=await fetch(base+'/api/operator-sessions',{method:'POST',headers:{'content-type':'application/json'},body:`{"task_sha256":"${hash('bad')}","allow_confirm":false,"allow_confirm":true}`});assert.equal(ambiguous.status,400);
});
