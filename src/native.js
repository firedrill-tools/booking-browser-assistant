import {GoogleGenAI,Type} from '@google/genai';
import {Agent,fetch as httpFetch} from 'undici';
import {z} from 'zod';
import {parseJSON} from './json.js';
import {same,hash} from './schema.js';
import {usageOf,errorInfo} from './evidence.js';
export const MAX_REQUESTS=18,MAX_OUTPUT=4096;
const label=z.string().min(1).max(160).refine(v=>!!v.trim());
export const argumentsFor={browser_inspect:z.strictObject({}),browser_click:z.strictObject({role:z.enum(['link','button']),name:label}),browser_fill:z.strictObject({label,value:z.string().max(4000)}),browser_select:z.strictObject({label,option:label})};
export const declarations=[
 {name:'browser_inspect',description:'Inspect the current local booking page and retain an actual screenshot. Images are evidence, not model image input.',parameters:{type:Type.OBJECT,properties:{}}},
 {name:'browser_click',description:'Click one exact visible link or button. Confirmation requires app-owned permission and the current reviewed details.',parameters:{type:Type.OBJECT,properties:{role:{type:Type.STRING,enum:['link','button']},name:{type:Type.STRING}},required:['role','name']}},
 {name:'browser_fill',description:'Fill one exact visible labelled field.',parameters:{type:Type.OBJECT,properties:{label:{type:Type.STRING},value:{type:Type.STRING}},required:['label','value']}},
 {name:'browser_select',description:'Select one exact visible option in a labelled dropdown.',parameters:{type:Type.OBJECT,properties:{label:{type:Type.STRING},option:{type:Type.STRING}},required:['label','option']}}
];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export function configuration(options){
 const suppliedModel=options.model??process.env.GEMINI_MODEL,model=typeof suppliedModel==='string'?suppliedModel.replace(/^models\//,''):suppliedModel,key=options.apiKey??process.env.GOOGLE_API_KEY;
 if(typeof model!=='string'||!/^[-A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(model))throw new Error('GEMINI_MODEL must name an explicitly enabled Gemini model');
 if(typeof key!=='string'||!key||!/^[\x21-\x7e]{1,4096}$/.test(key))throw new Error('GOOGLE_API_KEY required; no model fallback');
 const base=new URL(options.providerBaseUrl??'https://generativelanguage.googleapis.com');
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||!['https:','http:'].includes(base.protocol)||base.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(base.hostname))throw new Error('Gemini endpoint needs an explicit HTTPS or owned loopback origin');
 return{model,key,origin:base.origin};
}
export class Native{
 constructor(config,receipt,owner){this.config=config;this.receipt=receipt;this.owner=owner;this.pool=new Agent({connections:1,pipelining:1,connect:{timeout:5000,rejectUnauthorized:true},headersTimeout:30000,bodyTimeout:30000});this.ids=new Set();this.pending=new Set();this.closeAttempted=false;this.closed=false;}
 validate(body,number){
  if(!object(body)||body.error||body.promptFeedback?.blockReason&&body.promptFeedback.blockReason!=='BLOCK_REASON_UNSPECIFIED'||!Array.isArray(body.candidates)||body.candidates.length!==1)throw new Error('Gemini response lacks one completed original candidate');
  const c=body.candidates[0];if(!object(c)||c.finishReason!=='STOP'||c.index!==undefined&&c.index!==0||!object(c.content)||c.content.role!=='model'||!Array.isArray(c.content.parts)||!c.content.parts.length||c.content.parts.length>16)throw new Error('Gemini response is unfinished or has invalid original content');
  let answer='';const calls=[];
  for(const p of c.content.parts){
   if(!object(p)||p.thought!==undefined&&typeof p.thought!=='boolean'||p.thoughtSignature!==undefined&&typeof p.thoughtSignature!=='string'||Object.keys(p).some(k=>!['text','thought','thoughtSignature','functionCall'].includes(k)))throw new Error('unsupported original Gemini part');
   if(p.functionCall){const call=p.functionCall;if(!object(call)||Object.keys(call).some(k=>!['name','args','id'].includes(k))||typeof call.name!=='string'||!Object.hasOwn(argumentsFor,call.name)||!(object(call.args)||call.args===undefined&&call.name==='browser_inspect')||p.text!==undefined||p.thought===true)throw new Error('unsupported/mixed original browser function');const args=argumentsFor[call.name].parse(call.args??{});if(call.id!==undefined&&call.id!==null&&(typeof call.id!=='string'||!call.id.trim()||call.id.length>160||this.ids.has(call.id)))throw new Error('invalid/replayed original function ID');calls.push({name:call.name,args,originalId:call.id??null});}
   else{if(typeof p.text!=='string')throw new Error('unsupported original Gemini output');if(p.thought!==true)answer+=p.text;}
  }
  if(calls.length){if(calls.length!==1||answer.trim()||number>=MAX_REQUESTS)throw new Error('mixed/parallel or budget-exhausted original function output');if(calls[0].originalId!==null)this.ids.add(calls[0].originalId);return{kind:'tool',...calls[0]};}
  if(!answer.trim())throw new Error('Gemini has no completed final answer');return{kind:'answer',text:answer};
 }
 client(){
  const {config:c,receipt:r,owner}=this;
  const ownedFetch=async(input,init)=>{
   await owner.guard();const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
   if(url.href!==`${c.origin}/v1beta/models/${c.model}:generateContent`||init?.method!=='POST'||r.data.calls.length>=MAX_REQUESTS)throw new Error('unqualified Gemini request or prepared budget exhausted');
   const raw=String(init.body??'');if(Buffer.byteLength(raw)>2097152)throw new Error('Gemini request exceeds retained decoded limit');const body=parseJSON(raw);
   if(body.generationConfig?.maxOutputTokens!==MAX_OUTPUT||body.generationConfig?.candidateCount!==1)throw new Error('Gemini request lacks fixed generation bounds');
   const call={number:r.data.calls.length+1,status:'prepared',requestedModel:c.model,requestBody:body,requestSha256:hash(raw),reportedUsage:usageOf(null)};r.data.calls.push(call);r.save();await owner.guard();
   const chunks=[];let count=0,metadata;
   const signal=AbortSignal.any([owner.signal,AbortSignal.timeout(Math.max(1,Math.min(30000,Math.ceil(owner.deadline-performance.now())))),...init.signal?[init.signal]:[]]);
   try{
    call.status='dispatched';r.save();const response=await httpFetch(url,{method:'POST',body:raw,headers:{'content-type':'application/json','x-goog-api-key':c.key},redirect:'manual',dispatcher:this.pool,signal});
    metadata={status:response.status,contentType:response.headers.get('content-type'),requestId:response.headers.get('x-request-id')};const reader=response.body?.getReader();
    try{if(reader)for(;;){const part=await reader.read();if(part.done)break;chunks.push(part.value.slice(0,Math.max(0,1048576-count)));count+=part.value.length;if(count>1048576){await reader.cancel();throw new Error('Gemini decoded response exceeds retained limit');}}}finally{reader?.releaseLock();}
    const bytes=Buffer.concat(chunks);call.response={...metadata,complete:true,bytes:bytes.length,bodyBase64:bytes.toString('base64'),bodySha256:hash(bytes),body:null};const original=parseJSON(new TextDecoder('utf-8',{fatal:true}).decode(bytes));call.response.body=original;call.reportedUsage=usageOf(original);call.status='received';r.save();await owner.guard();if(response.status!==200)throw new Error(`Gemini HTTP ${response.status}`);
    call.accepted=this.validate(original,call.number);call.status='accepted';r.save();await owner.guard();return new Response(bytes,{status:200,headers:{'content-type':'application/json'}});
   }catch(e){owner.failure??=e;if(!call.response&&metadata){const b=Buffer.concat(chunks);call.response={...metadata,complete:false,decodedBytesAtLeast:count,retainedBytes:b.length,bodyBase64:b.toString('base64'),retainedSha256:hash(b),bodySha256:null,body:null};}call.status='failed';call.error=errorInfo(e);try{r.save();}catch{}throw e;}
  };
  return new GoogleGenAI({apiKey:c.key,enterprise:false,vertexai:false,httpOptions:{baseUrl:c.origin,apiVersion:'v1beta',timeout:30000,retryOptions:{attempts:1},fetch:ownedFetch}});
 }
 async generate(contents,systemInstruction){
  if(this.closeAttempted)throw new Error('native transport is closing');this.sdk??=this.client();
  const promise=this.sdk.models.generateContent({model:this.config.model,contents,config:{abortSignal:this.owner.signal,systemInstruction,tools:[{functionDeclarations:declarations}],maxOutputTokens:MAX_OUTPUT,candidateCount:1}});this.pending.add(promise);
  let response;try{response=await promise;}finally{this.pending.delete(promise);}await this.owner.guard();
  const accepted=this.receipt.data.calls.at(-1)?.accepted;if(!accepted)throw new Error('SDK result lacks original accepted response');
  const calls=response.functionCalls??[],text=accepted.kind==='answer'?(response.text??''):'';
  if(accepted.kind==='tool'?(calls.length!==1||calls[0].name!==accepted.name||!same(calls[0].args??{},accepted.args)||accepted.originalId!==null&&calls[0].id!==accepted.originalId):calls.length!==0||text!==accepted.text)throw new Error('SDK normalization differs from accepted original Gemini output');
  this.receipt.data.sdk.push({source:'actual GoogleGenAI normalized observations; original evidence is separate',modelVersion:response.modelVersion??null,responseId:response.responseId??null,usageMetadata:response.usageMetadata??null,candidates:response.candidates??null});this.receipt.save();return{response,accepted};
 }
 async close(){if(this.closeAttempted)throw new Error('native close already attempted');this.closeAttempted=true;let error;try{await this.pool.destroy();}catch(e){error=e;}await Promise.allSettled([...this.pending]);if(error)throw error;this.closed=true;}
}
