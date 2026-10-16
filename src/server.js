import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {Store,displayTime,zones} from './state.js';
import {same,digest,zoneSchema} from './schema.js';
import {parseJSON} from './json.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const layout=(title,body)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | Atlas Booking</title><link rel="stylesheet" href="/assets/style.css"></head><body><header><div class="brand">ATLAS <span>/ BOOKINGS</span></div><span class="header-right">LOCAL SERVICE DESK</span></header><main>${body}</main></body></html>`;
const errorPage=(reason,back='/')=>layout('Booking blocked',`<a class="back" href="${escape(back)}">← Back</a><div role="alert" class="alert"><div class="eyebrow">RESERVATION BLOCKED</div><h1>We could not reserve this time.</h1><p>${escape(reason)}</p></div>`);
const businessZone=state=>state.service.timezone??'America/Toronto';
function localDate(instant,zone){const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant)),v=Object.fromEntries(parts.map(p=>[p.type,p.value]));return`${v.year}-${v.month}-${v.day}`;}
const reviewBody=z.strictObject({email:z.string().max(254),timezone:zoneSchema,revision:z.string().regex(/^[1-9]\d{0,15}$/).refine(v=>Number.isSafeInteger(Number(v)))});
const confirmBody=z.strictObject({intent_hash:digest});
const registration=z.strictObject({task_sha256:digest,allow_confirm:z.boolean()});
function credential(req){const header=req.headers['x-booking-operation'];if(header===undefined)return null;if(typeof header!=='string')throw new Error('unknown_operation');return header;}
export function createApp(file){
 const store=new Store(file),app=express();app.locals.store=store;
 app.use((req,res,next)=>{
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'self'; base-uri 'none'");res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  try{const host=req.headers.host,url=new URL('http://'+host);if(url.username||url.password||!['127.0.0.1','localhost'].includes(url.hostname)||Number(url.port||80)!==req.socket.localPort||url.pathname!=='/'||url.search||url.hash)throw new Error('invalid_host');if(req.method==='POST'&&req.headers.origin&&req.headers.origin!==url.origin)throw new Error('foreign_origin');next();}catch{res.status(403).send(errorPage('local_origin_required'));}
 });
 app.use(express.raw({type:()=>true,limit:'1mb'}));
 app.use((req,res,next)=>{
  if(!Buffer.isBuffer(req.body))return next();
  try{
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(req.body),type=(req.get('content-type')??'').split(';')[0];
   if(type==='application/json')req.body=parseJSON(raw);
   else if(type==='application/x-www-form-urlencoded'){
    if(/%(?![a-f0-9]{2})/i.test(raw))throw new Error('invalid form encoding');const body=Object.create(null);for(const [k,v]of new URLSearchParams(raw)){if(Object.hasOwn(body,k))throw new Error('duplicate form field');body[k]=v;}req.body=body;
   }else throw new Error('unsupported content type');next();
  }catch{res.status(400).send(errorPage('ambiguous_or_invalid_request'));}
 });
 app.use('/assets',express.static(path.join(root,'public')));
 app.post('/api/operator-sessions',(req,res)=>{const b=registration.parse(req.body);res.status(201).json(store.registerOperation(b.task_sha256,b.allow_confirm));});
 app.post('/api/operator-sessions/close',(req,res)=>{z.strictObject({}).parse(req.body);res.json(store.closeOperation(credential(req)));});
 app.get('/api/source',(req,res)=>{const s=store.snapshot();store.operation(s.state,credential(req),true);res.json({synthetic:true,version:1,instance_id:s.state.instance_id??null,sha256:s.digest,body_base64:s.bytes.toString('base64')});});
 app.get('/api/state',(req,res)=>{const state=store.read();store.operation(state,credential(req));res.json(state);});
 app.get('/',(req,res)=>{
  const state=store.read();store.operation(state,credential(req));const query=new URL(req.originalUrl,'http://local').searchParams;
  if([...query.keys()].some(k=>k!=='date')||query.getAll('date').length>1)throw new Error('invalid_search');const date=query.get('date')??'';
  if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('invalid_search');
  const zone=businessZone(state),slots=state.slots.filter(slot=>!date||localDate(slot.starts_at_utc,zone)===date);
  const cards=slots.map(slot=>`<article class="slot"><div><span class="slot-id">${escape(slot.id)}</span><h3>${escape(displayTime(slot.starts_at_utc,zone))}</h3><p>${escape(state.service.duration_minutes)} minutes · ${escape(state.service.location)}</p></div><div class="slot-action"><span class="${slot.booked>=slot.capacity?'sold':'open'}">${slot.booked>=slot.capacity?'SOLD OUT':'AVAILABLE'}</span><a href="/slots/${encodeURIComponent(slot.id)}">Review ${escape(slot.id)} →</a></div></article>`).join('');
  res.send(layout('Search appointments',`<div class="eyebrow">SERVICE / ${escape(state.service.id.toUpperCase())}</div><h1>Book a time that works.</h1><p class="intro">Browse current synthetic availability for ${escape(state.service.name)}. Review the exact local time before confirming.</p><form class="search" method="get"><label for="date">Date (${escape(zone)})</label><div><input id="date" type="date" name="date" value="${escape(date)}"><button>Search times</button></div></form><div class="section-head"><h2>Available appointments</h2><span>${slots.length} shown</span></div><section class="slots">${cards||'<p class="empty">No appointments on this date.</p>'}</section>`));
 });
 app.get('/slots/:id',(req,res)=>{
  const state=store.read();store.operation(state,credential(req));const slot=state.slots.find(s=>s.id===req.params.id);if(!slot)return res.status(404).send(errorPage('slot_not_found'));
  const sold=slot.booked>=slot.capacity,zone=businessZone(state),options=zones.map(z=>`<option value="${escape(z)}">${escape(z)}</option>`).join('');
  const form=sold?'<div role="alert" class="warning">This time is sold out. Choose another appointment.</div>':`<form method="post" action="/slots/${encodeURIComponent(slot.id)}/review"><input type="hidden" name="revision" value="${slot.revision}"><label for="email">Customer email</label><input id="email" name="email" type="email" required placeholder="name@acme.example"><label for="timezone">Display timezone</label><select id="timezone" name="timezone">${options}</select><button>Review reservation</button></form>`;
  res.send(layout(slot.id,`<a class="back" href="/">← All appointments</a><div class="eyebrow">APPOINTMENT / ${escape(slot.id)}</div><h1>Review this time.</h1><div class="columns"><section class="panel"><div class="panel-head"><h2>${escape(state.service.name)}</h2><span>${state.service.duration_minutes} MIN</span></div><dl><div><dt>${escape(zone)}</dt><dd>${escape(displayTime(slot.starts_at_utc,zone))}</dd></div><div><dt>UTC</dt><dd>${escape(slot.starts_at_utc)}</dd></div><div><dt>Location</dt><dd>${escape(state.service.location)}</dd></div><div><dt>Availability</dt><dd>${sold?'Sold out':`${slot.capacity-slot.booked} space(s) available`}</dd></div></dl></section><section class="panel"><div class="panel-head"><h2>Your details</h2><span>STEP 1 / 2</span></div>${form}</section></div>`));
 });
 app.post('/slots/:id/review',(req,res)=>{const body=reviewBody.parse(req.body),result=store.review(req.params.id,body.email,body.timezone,Number(body.revision),credential(req));if(result.error)return res.status(409).send(errorPage(result.error,`/slots/${encodeURIComponent(req.params.id)}`));res.redirect(303,`/review/${result.intent.token}`);});
 app.get('/review/:token',(req,res)=>{
  const state=store.read(),op=store.operation(state,credential(req)),intent=state.intents.find(i=>i.token===req.params.token);if(!intent)return res.status(404).send(errorPage('intent_not_found'));
  if(op&&intent.scope.operation_id!==op.id)return res.status(403).send(errorPage('review_not_owned'));
  const slot=intent.source.slot,service=intent.source.service,current=state.slots.find(s=>s.id===slot.id),stale=!same(intent.source,{service:state.service,slot:current});
  const decision=intent.status==='confirmed'?'<div role="status" class="notice">This reservation is already confirmed.</div>':stale?'<div role="alert" class="warning">Availability or service details changed. Return to the appointment and review again.</div>':op&&!op.allow_confirm?'<div role="status" class="notice">Review only. This visit does not allow final confirmation.</div>':`<form method="post" action="/confirm/${intent.token}"><input type="hidden" name="intent_hash" value="${intent.content_sha256}"><button>Confirm booking</button></form>`;
  res.send(layout('Confirm reservation',`<a class="back" href="/slots/${encodeURIComponent(slot.id)}">← Appointment</a><div class="eyebrow">REVIEW / ${escape(intent.id)}</div><h1>Review your reservation.</h1><p class="intro">Nothing is reserved until you confirm. Availability and these exact details are checked again at the final step.</p><section class="panel confirm"><div class="panel-head"><h2>${escape(service.name)}</h2><span>STEP 2 / 2</span></div><dl><div><dt>Slot</dt><dd>${escape(slot.id)}</dd></div><div><dt>Local time</dt><dd>${escape(displayTime(slot.starts_at_utc,intent.timezone))}</dd></div><div><dt>Timezone</dt><dd>${escape(intent.timezone)}</dd></div><div><dt>UTC</dt><dd>${escape(slot.starts_at_utc)}</dd></div><div><dt>Customer</dt><dd>${escape(intent.email)}</dd></div></dl>${decision}</section>`));
 });
 app.post('/confirm/:token',(req,res)=>{const body=confirmBody.parse(req.body),result=store.confirm(req.params.token,body.intent_hash,credential(req));if(result.error)return res.status(409).send(errorPage(result.error,`/review/${encodeURIComponent(req.params.token)}`));res.redirect(303,`/reservations/${result.reservation.id}`);});
 app.get('/reservations/:id',(req,res)=>{
  const state=store.read();store.operation(state,credential(req));const r=state.reservations.find(r=>r.id===req.params.id);if(!r)return res.status(404).send(errorPage('reservation_not_found'));
  const service=state.intents.find(i=>i.id===r.intent_id)?.source.service??state.service;
  res.send(layout('Reservation confirmed',`<div class="eyebrow">CONFIRMED / ${escape(r.id)}</div><h1>Your time is reserved.</h1><p class="intro">Reservation ${escape(r.id)} is saved in the local booking ledger.</p><section class="panel confirm"><div class="panel-head"><h2>Booking details</h2><span>CONFIRMED</span></div><dl><div><dt>Service</dt><dd>${escape(service.name)}</dd></div><div><dt>Local time</dt><dd>${escape(displayTime(r.starts_at_utc,r.timezone))}</dd></div><div><dt>Timezone</dt><dd>${escape(r.timezone)}</dd></div><div><dt>Customer</dt><dd>${escape(r.email)}</dd></div></dl></section><a class="back bottom" href="/">← All appointments</a>`));
 });
 app.use((error,_req,res,_next)=>res.status(error.status===413?413:422).send(errorPage(error?.message==='operation_closed'?'operation_closed':'invalid_source_or_request')));
 return app;
}
export function startServer(file,port=8787){return new Promise((resolve,reject)=>{const server=createApp(file).listen(port,'127.0.0.1',()=>resolve(server));server.once('error',reject);});}
if(process.argv[1]&&fs.existsSync(process.argv[1])&&fs.realpathSync(process.argv[1])===fileURLToPath(import.meta.url))startServer(path.resolve(process.env.BOOKING_WORKSPACE_FILE||'workspace.json'),Number(process.env.PORT||8787)).then(server=>console.log(`Booking portal on http://127.0.0.1:${server.address().port}`)).catch(error=>{console.error(error.message);process.exitCode=1;});
