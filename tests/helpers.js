import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {Store} from '../src/state.js';
import {createApp} from '../src/server.js';
export const bookingActions=[
 ['browser_click',{role:'link',name:'Review S-101 →'}],
 ['browser_fill',{label:'Customer email',value:'mia@acme.example'}],
 ['browser_select',{label:'Display timezone',option:'Europe/London'}],
 ['browser_click',{role:'button',name:'Review reservation'}],
 ['browser_click',{role:'button',name:'Confirm booking'}]
];
export function bodyFor(n,actions=bookingActions){const action=actions[n-1];return{candidates:[{index:0,content:{role:'model',parts:action?[{functionCall:{name:action[0],args:structuredClone(action[1]),id:`call-${n}`}}]:[{text:actions.length===5?'Reservation R-2 recorded in the local ledger.':'Review retained without final confirmation.'}]},finishReason:'STOP'}],responseId:`resp-${n}`,modelVersion:'controlled-gemini',usageMetadata:{promptTokenCount:10,candidatesTokenCount:2,totalTokenCount:12},unknown_original:{retained:true}};}
export async function environment(t,{actions=bookingActions,mutate=(body)=>body,wrap}={}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'booking-native-')),file=path.join(directory,'state.json');fs.copyFileSync(new URL('../fixtures/starter.json',import.meta.url),file);const store=new Store(file),application=createApp(file),portal=createServer(wrap?wrap(application):application),requests=[];portal.listen(0,'127.0.0.1');await once(portal,'listening');
 const provider=createServer(async(req,res)=>{
  try{let raw='';for await(const b of req)raw+=b;const request=JSON.parse(raw);requests.push(request);assert.equal(req.url,'/v1beta/models/controlled-gemini:generateContent');assert.equal(req.headers['x-goog-api-key'],'synthetic-booking-key');assert.equal(request.generationConfig.maxOutputTokens,4096);assert.equal(request.generationConfig.candidateCount,1);
   const n=requests.length,round=(request.contents??[]).flatMap(c=>c.parts??[]).filter(p=>p.functionResponse).length+1,body=await mutate(bodyFor(round,actions),n,{file,store,request,res,round});if(res.destroyed||res.writableEnded)return;res.writeHead(200,{'content-type':'application/json','x-request-id':`request-${n}`});res.end(JSON.stringify(body));
  }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:e.message}}));}
 });provider.listen(0,'127.0.0.1');await once(provider,'listening');
 t.after(async()=>{portal.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(r=>portal.close(r)),new Promise(r=>provider.close(r))]);fs.rmSync(directory,{recursive:true,force:true});});
 return{directory,file,store,requests,portal,provider,options:{portalUrl:`http://127.0.0.1:${portal.address().port}`,providerBaseUrl:`http://127.0.0.1:${provider.address().port}`,model:'controlled-gemini',apiKey:'synthetic-booking-key',outputRoot:directory,allowConfirm:true},trace:()=>{const dirs=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory());assert.equal(dirs.length,1);return JSON.parse(fs.readFileSync(path.join(directory,dirs[0].name,'trace.json'),'utf8'));}};
}
