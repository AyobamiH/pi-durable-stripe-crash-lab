import {DurableObject} from "cloudflare:workers";
import {Lifecycle} from "agents/lifecycle";
import {PiHarness} from "agents/harness/pi";
import {createModels} from "@earendil-works/pi-ai/models";
import {fauxProvider,fauxAssistantMessage,fauxText,fauxToolCall,Type} from "@earendil-works/pi-ai";
import {createRegistry,Harness} from "@earendil-works/pi-durable";
export class Probe extends DurableObject {
 instance=crypto.randomUUID();
 faux=fauxProvider({tokensPerSecond:1000});
 reports=[];
 harness=new PiHarness({
  harness:({storage,context,onWake})=>{
   const registry=createRegistry();
   registry.install({name:"lab",tools:[{name:"inert_probe",description:"Local disposable marker; no external effect",parameters:Type.Object({}),replay:"safe",
    execute:async(_args,_api,run)=>{
     const calls=(await this.ctx.storage.get("calls")??0)+1;
     await this.ctx.storage.put("calls",calls);
     while(!(await this.ctx.storage.get("release"))){run.abortSignal?.throwIfAborted();await new Promise(r=>setTimeout(r,25));}
     await this.ctx.storage.put("completed",true);
     return {output:[{type:"text",text:"fixture completed"}]};
    }}]});
   const models=createModels();models.setProvider(this.faux.provider);
   return Harness.open(storage,{models,registry,onWake,onReport:r=>this.reports.push(r),settings:{restartLimit:2,retry:{enabled:false,maxRetries:0,baseDelayMs:0}}},context);
  },defaults:{model:this.faux.getModel()}
 });
 lifecycle=Lifecycle.install(this).use(this.harness);
 constructor(ctx,env){super(ctx,env);this.faux.setResponses(Array.from({length:30},()=>context=>{
  const last=context.messages.filter(m=>m.role!=="system").at(-1);
  return last?.role==="toolResult"?fauxAssistantMessage([fauxText(last.isError?"interrupted":"completed")]):fauxAssistantMessage([fauxToolCall("inert_probe",{})],{stopReason:"toolUse"});
 }));}
 submit(id){return this.harness.submit("Run inert probe",{operationId:id});}
 async status(){return {instance:this.instance,calls:await this.ctx.storage.get("calls")??0,
  completed:await this.ctx.storage.get("completed")??false,
  crashes:await this.ctx.storage.get("crashes")??0,
  lastCrash:await this.ctx.storage.get("lastCrash")??null,
  alarm:await this.ctx.storage.getAlarm(),
  pending:await this.harness.pending(),reports:this.reports};}
 async crash(){
  const calls=await this.ctx.storage.get("calls")??0;
  const completed=await this.ctx.storage.get("completed")??false;
  const crashes=await this.ctx.storage.get("crashes")??0;
  if(calls===0||completed||crashes>=2)throw new Error("Crash outside bounded in-flight operation");
  await this.ctx.storage.put("crashes",crashes+1);
  await this.ctx.storage.put("lastCrash",{instance:this.instance,at:new Date().toISOString()});
  this.ctx.abort("Purposeful hosted Pi 1.4 test-only crash");
 }
 async release(){await this.ctx.storage.put("release",true);return {released:true};}
 retry(){return this.harness.session("1").retry();}
 abort(id){return this.harness.session("1").abort(id);}
 async result(id){try{return {settled:true,value:await this.harness.session("1").wait(id,AbortSignal.timeout(300))};}catch(e){return {settled:false,error:e.name};}}
}
export default {async fetch(request,env){
 const u=new URL(request.url);
 const id=u.searchParams.get("id")??"";
 if(env.LAB_HOSTED==="true"){
  if(!env.LAB_CONTROL_TOKEN||request.headers.get("authorization")!=="Bearer "+env.LAB_CONTROL_TOKEN)
   return Response.json({error:"Unauthorised test-only endpoint"},{status:401});
  const allow=JSON.parse(env.LAB_ALLOWED_OPERATION_IDS??"[]");
  if(!Array.isArray(allow)||!allow.includes(id))
   return Response.json({error:"Outside fixed test scope"},{status:403});
 }else if(!["localhost","127.0.0.1"].includes(u.hostname)) return new Response("Local only",{status:403});
 if(!/^probe-[a-z0-9-]+$/.test(id))return new Response("Bad id",{status:400});
 const p=env.PROBE.getByName(id);
 if(u.pathname==="/status")return Response.json(await p.status());
 if(u.pathname==="/result")return Response.json(await p.result(id));
 if(request.method==="POST"){
  if(u.pathname==="/start")return Response.json(await p.submit(id));
  if(u.pathname==="/release")return Response.json(await p.release());
  if(u.pathname==="/retry")return Response.json({retried:await p.retry()});
  if(u.pathname==="/abort")return Response.json({aborted:await p.abort(id)});
  if(u.pathname==="/crash"&&env.LAB_HOSTED==="true"){
    await p.crash();
    return Response.json({error:"Durable Object was not terminated"},{status:500});
  }
 }
 return new Response("Not found",{status:404});
}};
