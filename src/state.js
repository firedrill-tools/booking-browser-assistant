import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readSource,saveSource} from './source.js';
import {zones,zoneSchema,emailSchema,revision,count,digest,identifier,source,same,intentHash,hash} from './schema.js';
export {zones};
export function displayTime(instant,zone){return new Intl.DateTimeFormat('en-CA',{timeZone:zone,weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(instant));}
const next=(prefix,rows)=>{let n=rows.length+1;while(rows.some(r=>r.id===`${prefix}-${n}`))n++;return`${prefix}-${n}`;};
const increment=n=>{if(n===Number.MAX_SAFE_INTEGER)throw new Error('revision_exhausted');return n+1;};
const error=message=>({error:message});
export class Store{
 constructor(file){const s=readSource(file);this.file=fs.realpathSync(file);this.instance=s.state.instance_id??null;this.lock=path.join(path.dirname(this.file),`.${path.basename(this.file)}.booking-lock.sqlite`);}
 snapshot(){const s=readSource(this.file);if((s.state.instance_id??null)!==this.instance)throw new Error('workspace instance changed');return s;}
 read(){return this.snapshot().state;}
 transaction(fn){
  if(fs.existsSync(this.lock)&&(!fs.lstatSync(this.lock).isFile()||fs.lstatSync(this.lock).isSymbolicLink()))throw new Error('invalid workspace mutex');
  try{fs.closeSync(fs.openSync(this.lock,'wx',0o600));}catch(e){if(e.code!=='EEXIST')throw e;}
  const db=new DatabaseSync(this.lock);try{db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');const prior=this.snapshot(),{result,dirty}=fn(prior.state);if(dirty)saveSource(this.file,prior.state,prior);db.exec('COMMIT');return structuredClone(result);}catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}finally{db.close();}
 }
 operation(state,credential){
  if(credential===null)return null;
  if(typeof credential!=='string'||!/^[a-f0-9]{64}$/.test(credential))throw new Error('unknown_operation');
  const op=(state.operations??[]).find(o=>o.credential_sha256===hash(credential));if(!op)throw new Error('unknown_operation');if(op.status!=='active')throw new Error('operation_closed');return op;
 }
 registerOperation(taskHash,allowConfirm){
  digest.parse(taskHash);if(typeof allowConfirm!=='boolean')throw new Error('allowConfirm must be a boolean');
  return this.transaction(state=>{const credential=randomBytes(32).toString('hex'),operation={id:randomUUID(),credential_sha256:hash(credential),task_sha256:taskHash,allow_confirm:allowConfirm,status:'active'};(state.operations??=[]).push(operation);state.audit.push({action:'operation',target:operation.id,outcome:allowConfirm?'confirmation_allowed':'review_only'});return{result:{operation,credential},dirty:true};});
 }
 closeOperation(credential){return this.transaction(state=>{const op=this.operation(state,credential);if(!op)throw new Error('operator credential required');op.status='closed';state.audit.push({action:'operation',target:op.id,outcome:'closed'});return{result:{operation:op},dirty:true};});}
 review(slotId,email,zone,expectedRevision,credential=null){
  if(!identifier.safeParse(slotId).success||!revision.safeParse(expectedRevision).success)return error('invalid_review_arguments');
  if(!zoneSchema.safeParse(zone).success)return error('invalid_timezone');
  if(typeof email!=='string'||!emailSchema.safeParse(email.trim().toLowerCase()).success)return error('synthetic_email_required');email=email.trim().toLowerCase();
  return this.transaction(state=>{
   const op=this.operation(state,credential),slot=state.slots.find(s=>s.id===slotId);let reason=!slot?'slot_not_found':slot.revision!==expectedRevision?'stale_slot':slot.booked>=slot.capacity?'sold_out':state.reservations.some(r=>r.slot_id===slotId&&r.email===email)?'already_reserved':null;
   if(reason)return{result:error(reason),dirty:false};
   if(state.intents.some(i=>i.slot_id===slotId&&i.email===email&&i.status==='reviewed'&&i.scope.operation_id===(op?.id??null)))return{result:error('already_reviewed'),dirty:false};
   const intent={id:next('I',state.intents),token:randomUUID(),slot_id:slotId,slot_revision:slot.revision,email,timezone:zone,status:'reviewed',source:source(state,slot),scope:{kind:op?'operator':'synthetic_human',operation_id:op?.id??null,task_sha256:op?.task_sha256??null,allow_confirm:op?.allow_confirm??true},content_sha256:'',confirmation:null};intent.content_sha256=intentHash(intent);state.intents.push(intent);state.audit.push({action:'review',target:intent.id,outcome:'ready'});return{result:{intent},dirty:true};
  });
 }
 confirm(token,expectedHash,credential=null){
  if(typeof token!=='string'||!digest.safeParse(expectedHash).success)return error('review_hash_required');
  return this.transaction(state=>{
   const op=this.operation(state,credential),intent=state.intents.find(i=>i.token===token);if(!intent)return{result:error('intent_not_found'),dirty:false};
   if(intent.status!=='reviewed')return{result:error('already_confirmed'),dirty:false};
   const slot=state.slots.find(s=>s.id===intent.slot_id);
   let reason=intent.content_sha256!==expectedHash?'review_hash_changed':op&&intent.scope.operation_id!==op.id?'review_not_owned':op&&(!op.allow_confirm||!intent.scope.allow_confirm)?'confirmation_not_authorized':!same(intent.source,source(state,slot))?'availability_changed':slot.booked>=slot.capacity?'sold_out':state.reservations.some(r=>r.slot_id===slot.id&&r.email===intent.email)?'already_reserved':null;
   if(reason){state.audit.push({action:'confirm',target:intent.id,outcome:reason});return{result:error(reason),dirty:true};}
   const nextRevision=increment(slot.revision);slot.booked++;slot.revision=nextRevision;intent.status='confirmed';intent.confirmation={actor_kind:op?'operator':'synthetic_human',operation_id:op?.id??null,task_sha256:op?.task_sha256??null,intent_sha256:expectedHash,source:structuredClone(intent.source)};
   const reservation={id:next('R',state.reservations),intent_id:intent.id,slot_id:slot.id,starts_at_utc:intent.source.slot.starts_at_utc,email:intent.email,timezone:intent.timezone,intent_sha256:expectedHash};state.reservations.push(reservation);state.audit.push({action:'confirm',target:intent.id,outcome:'reserved'});return{result:{reservation},dirty:true};
  });
 }
 setAvailability(slotId,capacity){if(!count.safeParse(capacity).success)return error('invalid_capacity');return this.transaction(state=>{const slot=state.slots.find(s=>s.id===slotId);if(!slot)return{result:error('slot_not_found'),dirty:false};if(capacity<slot.booked)return{result:error('invalid_capacity'),dirty:false};slot.revision=increment(slot.revision);slot.capacity=capacity;state.audit.push({action:'availability',target:slotId,outcome:String(capacity)});return{result:{slot},dirty:true};});}
}
