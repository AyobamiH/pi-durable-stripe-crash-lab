import {DurableObject} from "cloudflare:workers";
import {Lifecycle} from "agents/lifecycle";
import {PiHarness} from "agents/harness/pi";
import {createModels} from "@earendil-works/pi-ai/models";
import {fauxProvider,fauxAssistantMessage,fauxText,fauxToolCall,Type} from "@earendil-works/pi-ai";
import {createRegistry,Harness} from "@earendil-works/pi-durable";
interface Env { PROBE:DurableObjectNamespace<ReplayProbe>; PROBE_REPLAY:"safe"|"unsafe"; }
export class ReplayProbe extends DurableObject<Env>{
 readonly faux=fauxProvider({tokensPerSecond:400});
 readonly harness=new PiHarness({
  harness:({storage,context})=>{
   const registry=createRegistry();
   registry.install({name:"probe",tools:[{name:"read_probe",description:"Pure local probe with no external consequence",parameters:Type.Object({}),replay:this.env.PROBE_REPLAY,
    execute:async(_args,_api,run)=>{
      const count=((await this.ctx.storage.get<number>("calls"))??0)+1;
      await this.ctx.storage.put("calls",count);
      if(count===1){await this.ctx.storage.put("blocked",true);while(true){run.abortSignal?.throwIfAborted();await new Promise(r=>setTimeout(r,50));}}
      return {output:[{type:"text",text:"read-only probe resumed"}]};
    }}]});
   const models=createModels();models.setProvider(this.faux.provider);
   return Harness.open(storage,{models,registry,settings:{retry:{enabled:false,maxRetries:0,baseDelayMs:0}}},context);
  },defaults:{model:this.faux.getModel()}
 });
 readonly lifecycle=Lifecycle.install(this).use(this.harness);
 constructor(ctx:DurableObjectState,env:Env){
  super(ctx,env);
  this.faux.setResponses(Array.from({length:20},()=>context=>{
   const last=context.messages.filter(m=>m.role!=="system").at(-1);
   if(last?.role==="toolResult")return fauxAssistantMessage([fauxText(last.isError?"interrupted":"completed")]);
   return fauxAssistantMessage([fauxToolCall("read_probe",{})],{stopReason:"toolUse"});
  }));
 }
 submit(id:string){return this.harness.submit("Run read-only probe",{operationId:id});}
 result(id:string){return this.harness.wait(id);}
 async status(){return {calls:(await this.ctx.storage.get("calls"))??0,blocked:(await this.ctx.storage.get("blocked"))??false};}
}
export default {async fetch(request:Request,env:Env){
 const u=new URL(request.url);
 if(!["localhost","127.0.0.1"].includes(u.hostname))return new Response("Local only",{status:403});
 const id=u.searchParams.get("id")??"";
 if(!/^probe-[a-z0-9-]+$/.test(id))return new Response("Bad id",{status:400});
 const stub=env.PROBE.getByName(id);
 if(u.pathname==="/start"&&request.method==="POST")return Response.json(await stub.submit(id));
 if(u.pathname==="/status")return Response.json(await stub.status());
 if(u.pathname==="/result")return Response.json(await stub.result(id));
 return new Response("Not found",{status:404});
}};
