import {z} from 'zod';
import {createHash} from 'node:crypto';
import {DATASET_SHA256} from './_dataset-manifest.js';
export const zones=['America/Toronto','Europe/London','America/Los_Angeles'];
export const zoneSchema=z.enum(zones);
export const identifier=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/);
export const revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const line=max=>z.string().min(1).max(max).refine(v=>!!v.trim()&&!/[\x00-\x1f\x7f]/.test(v));
export const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const utc=z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/).refine(v=>{const d=new Date(v);return Number.isFinite(d.valueOf())&&d.toISOString().replace('.000Z','Z')===v.replace('.000Z','Z');},'valid exact UTC instant required');
export const emailSchema=z.string().min(3).max(254).regex(/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.example$/).refine(v=>{const local=v.split('@')[0];return local.length<=64&&!local.startsWith('.')&&!local.endsWith('.')&&!local.includes('..');});
export const serviceSchema=z.strictObject({id:identifier,name:line(240),duration_minutes:z.number().int().min(1).max(1440),location:line(240),timezone:zoneSchema.optional()});
export const slotSchema=z.strictObject({id:identifier,starts_at_utc:utc,capacity:count,booked:count,revision}).refine(s=>s.booked<=s.capacity,'booked count exceeds capacity');
const sourceSchema=z.strictObject({instance_id:z.string().uuid().nullable(),service:serviceSchema,slot:slotSchema});
const scopeSchema=z.strictObject({kind:z.enum(['operator','synthetic_human']),operation_id:z.string().uuid().nullable(),task_sha256:digest.nullable(),allow_confirm:z.boolean()});
const confirmationSchema=z.strictObject({actor_kind:z.enum(['operator','synthetic_human']),operation_id:z.string().uuid().nullable(),task_sha256:digest.nullable(),intent_sha256:digest,source:sourceSchema});
const intentSchema=z.strictObject({id:identifier,token:z.string().uuid(),slot_id:identifier,slot_revision:revision,email:emailSchema,timezone:zoneSchema,status:z.enum(['reviewed','confirmed']),source:sourceSchema,scope:scopeSchema,content_sha256:digest,confirmation:confirmationSchema.nullable()});
const operationSchema=z.strictObject({id:z.string().uuid(),credential_sha256:digest,task_sha256:digest,allow_confirm:z.boolean(),status:z.enum(['active','closed'])});
const reservationSchema=z.strictObject({id:identifier,intent_id:identifier,slot_id:identifier,starts_at_utc:utc,email:emailSchema,timezone:zoneSchema,intent_sha256:digest.optional()});
export const stateSchema=z.strictObject({synthetic:z.literal(true),version:z.literal(1),instance_id:z.string().uuid().optional(),dataset:z.strictObject({id:z.literal('booking-populations'),version:z.literal('1.0.0'),case_id:identifier,source_sha256:z.literal(DATASET_SHA256)}).optional(),service:serviceSchema,slots:z.array(slotSchema).min(1).max(1000),operations:z.array(operationSchema).max(512).optional(),intents:z.array(intentSchema).max(2000),reservations:z.array(reservationSchema).max(2000),audit:z.array(z.strictObject({action:z.enum(['review','confirm','availability','operation']),target:identifier,outcome:line(80)})).max(16000)});
export const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`:JSON.stringify(v);
export const hash=v=>createHash('sha256').update(v).digest('hex');
export const same=(a,b)=>canonical(a)===canonical(b);
export const source=(state,slot)=>structuredClone({instance_id:state.instance_id??null,service:state.service,slot});
export const intentHash=i=>hash(canonical({id:i.id,token:i.token,slot_id:i.slot_id,slot_revision:i.slot_revision,email:i.email,timezone:i.timezone,source:i.source,scope:i.scope}));
const unique=(values,name)=>{if(new Set(values).size!==values.length)throw new Error(`duplicate ${name}`);};
export function validateState(value){
 const state=stateSchema.parse(value);if(state.dataset&&!state.instance_id)throw Error('managed source requires a private instance');const ops=new Map((state.operations??[]).map(o=>[o.id,o])),slots=new Map(state.slots.map(s=>[s.id,s])),intents=new Map(state.intents.map(i=>[i.id,i]));
 for(const [name,rows]of [['slot',state.slots],['intent',state.intents],['reservation',state.reservations],['operation',state.operations??[]]])unique(rows.map(r=>r.id),name);
 unique(state.intents.map(i=>i.token),'intent token');unique((state.operations??[]).map(o=>o.credential_sha256),'operation credential');unique(state.reservations.map(r=>r.intent_id),'reserved intent');unique(state.reservations.map(r=>canonical([r.slot_id,r.email])),'customer/slot reservation');
 for(const i of state.intents){
  if(i.source.instance_id!==null&&i.source.instance_id!==(state.instance_id??null)||i.scope.kind==='operator'&&i.source.instance_id!==(state.instance_id??null))throw new Error('workspace instance changed in reviewed source');
  if(!slots.has(i.slot_id)||i.source.slot.id!==i.slot_id||i.source.service.id!==state.service.id||i.slot_revision!==i.source.slot.revision||i.source.slot.booked>=i.source.slot.capacity||i.content_sha256!==intentHash(i))throw new Error('intent differs from reviewed source/hash');
  const scope=i.scope,op=ops.get(scope.operation_id);
  if(scope.kind==='operator'?!op||scope.task_sha256!==op.task_sha256||scope.allow_confirm!==op.allow_confirm:scope.operation_id!==null||scope.task_sha256!==null||scope.allow_confirm!==true)throw new Error('invalid reviewed confirmation scope');
  const reserved=state.reservations.filter(r=>r.intent_id===i.id);
  if(i.status==='reviewed'){if(i.confirmation!==null||reserved.length)throw new Error('review cannot claim a reservation');}
  else{
   const c=i.confirmation,actor=ops.get(c?.operation_id);
   if(!c||reserved.length!==1||c.intent_sha256!==i.content_sha256||!same(c.source,i.source))throw new Error('invalid exact confirmation decision');
   if(c.actor_kind==='operator'?!actor||c.operation_id!==scope.operation_id||c.task_sha256!==scope.task_sha256||!actor.allow_confirm||!scope.allow_confirm:c.operation_id!==null||c.task_sha256!==null)throw new Error('confirmation lacked captured authority');
   if(slots.get(i.slot_id).revision<=i.source.slot.revision||slots.get(i.slot_id).booked<=i.source.slot.booked)throw new Error('confirmed slot history is inconsistent');
  }
 }
 for(const r of state.reservations){
  if(!slots.has(r.slot_id))throw new Error('orphan reservation slot');
  const i=intents.get(r.intent_id);
  if(!i){if(r.intent_id!=='seeded'||r.intent_sha256!==undefined)throw new Error('unbound reservation is not known original imported history');}
  else if(i.status!=='confirmed'||r.intent_sha256!==i.content_sha256||r.slot_id!==i.slot_id||r.starts_at_utc!==i.source.slot.starts_at_utc||r.email!==i.email||r.timezone!==i.timezone)throw new Error('reservation differs from confirmed review');
 }
 for(const slot of state.slots)if(slot.booked!==state.reservations.filter(r=>r.slot_id===slot.id).length)throw new Error('booked count differs from reservation population');
 for(const a of state.audit){
  if(a.action==='review'&&(!intents.has(a.target)||a.outcome!=='ready'))throw new Error('invalid review audit');
  if(a.action==='confirm'&&(!intents.has(a.target)||!['reserved','availability_changed','sold_out','already_reserved','confirmation_not_authorized','review_not_owned','review_hash_changed','operation_closed'].includes(a.outcome)||a.outcome==='reserved'&&intents.get(a.target).status!=='confirmed'))throw new Error('invalid confirmation audit');
  if(a.action==='availability'&&(!slots.has(a.target)||!/^(?:0|[1-9]\d*)$/.test(a.outcome)||!Number.isSafeInteger(Number(a.outcome))))throw new Error('invalid availability audit');
  if(a.action==='operation'&&(!ops.has(a.target)||!['review_only','confirmation_allowed','closed'].includes(a.outcome)||a.outcome==='closed'&&ops.get(a.target).status!=='closed'))throw new Error('invalid operation audit');
 }
 return state;
}
