/*
 * Hosted Pi 1.4 lifecycle research. Zero Stripe/payment/model-provider calls.
 * Two fixed IDs, separate Witness Durable Object (independent of Pi alarms).
 */
import { DurableObject } from "cloudflare:workers";
import { Lifecycle } from "agents/lifecycle";
import { PiHarness } from "agents/harness/pi";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall, Type } from "@earendil-works/pi-ai";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const validId = x => typeof x === "string" && /^probe-lifecycle-[a-f0-9]{8}-(auto|abort)$/.test(x);

export class Witness extends DurableObject {
  async fetch(request) {
    const u = new URL(request.url);
    if (u.pathname === "/reserve" && request.method === "POST") {
      if (await this.ctx.storage.get("reserved")) return Response.json({reserved:false},{status:409});
      await this.ctx.storage.put("reserved",true);
      return Response.json({reserved:true});
    }
    if (u.pathname === "/record" && request.method === "POST") {
      const input = await request.json();
      if (!["tool_entry","auto_crash_planned","tool_completed","tool_abort_signal","abort_requested","abort_returned"].includes(input.kind))
        return Response.json({error:"Unknown event"},{status:400});
      const list = (await this.ctx.storage.get("events")) ?? [];
      if (list.length >= 32) return Response.json({error:"Witness event cap"},{status:429});
      const entryNumber = input.kind === "tool_entry" ? list.filter(e => e.kind === "tool_entry").length + 1 : null;
      const event = {sequence:list.length+1,kind:input.kind,instance:String(input.instance??"").slice(0,64),
        at:new Date().toISOString(),entryNumber,alarmTime:input.alarmTime??null,
        detail:String(input.detail??"").slice(0,100)};
      await this.ctx.storage.put("events",[...list,event]);
      return Response.json({accepted:true,event,entryNumber});
    }
    if (u.pathname === "/state" && request.method === "GET")
      return Response.json({reserved:(await this.ctx.storage.get("reserved"))??false,
        events:(await this.ctx.storage.get("events"))??[]});
    return Response.json({error:"Unknown witness route"},{status:404});
  }
}
function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(x => typeof x?.text === "string").map(x => x.text).join("");
}
function fauxAnswer(context) {
  const last = context.messages.filter(x => x.role !== "system").at(-1);
  if (last?.role === "toolResult") return fauxAssistantMessage([fauxText(last.isError ? "tool interrupted" : "completed")]);
  const raw = last?.role === "user" ? textContent(last.content) : "";
  const match = /^run:(probe-lifecycle-[a-f0-9]{8}-(?:auto|abort))$/.exec(raw);
  return match ? fauxAssistantMessage([fauxToolCall("inert_lifecycle",{operationId:match[1]})],{stopReason:"toolUse"})
    : fauxAssistantMessage([fauxText("unsupported request")]);
}
const Args = Type.Object({operationId:Type.String()});

export class Probe extends DurableObject {
  instance = crypto.randomUUID();
  registry = createRegistry();
  faux = fauxProvider({tokensPerSecond:1000});
  reports = [];
  harness = new PiHarness({
    harness:({storage,context,onWake}) => {
      this.registry.install({name:"lifecycle-probe",tools:[{
        name:"inert_lifecycle",description:"Inert hosted Pi 1.4 alarm/abort test",parameters:Args,replay:"safe",
        execute:async ({operationId},_api,run) => {
          if (!validId(operationId) || !JSON.parse(this.env.LAB_ALLOWED_IDS).includes(operationId))
            throw new Error("Operation outside frozen inert scope");
          const stub=this.env.WITNESS.getByName(operationId);
          const record=async(kind,detail="") => {
            const alarmTime=await this.ctx.storage.getAlarm();
            const r=await stub.fetch(new Request("https://witness.internal/record",{
              method:"POST",headers:{"content-type":"application/json"},
              body:JSON.stringify({kind,instance:this.instance,detail,alarmTime})
            }));
            if(!r.ok)throw new Error("Witness rejected event");
            return r.json();
          };
          const entry=await record("tool_entry");
          if (operationId.endsWith("-auto")) {
            if (entry.entryNumber===1) {
              await record("auto_crash_planned","Persisted to separate witness before intentional DO termination");
              this.ctx.abort("intentional one-shot hosted Pi alarm recovery test");
              throw new Error("DO abort did not terminate execution");
            }
            await record("tool_completed","Replay-safe inert tool finished after restart");
            await this.ctx.storage.put("completed",true);
            return {output:[{type:"text",text:"inert auto recovery completed"}]};
          }
          const deadline=Date.now()+90000;
          try {
            while(Date.now()<deadline) {
              run.abortSignal?.throwIfAborted();
              await sleep(80);
            }
            throw new Error("Inert abort tool reached 90-second safety deadline");
          }catch(error){
            if(run.abortSignal?.aborted) {
              try{await record("tool_abort_signal",String(error?.name??"aborted"));}catch(_){}
            }
            throw error;
          }
        }
      }]});
      const models=createModels();
      models.setProvider(this.faux.provider);
      return Harness.open(storage,{models,registry:this.registry,onWake,
        onReport:error=>this.reports.push(String(error?.kind??"report")),
        settings:{restartLimit:2,retry:{enabled:false,maxRetries:0,baseDelayMs:0}}
      },context);
    },defaults:{model:this.faux.getModel()}
  });
  lifecycle=Lifecycle.install(this).use(this.harness);
  constructor(ctx,env) {
    super(ctx,env);
    this.faux.setResponses(Array.from({length:30},()=>fauxAnswer));
  }
  submit(id){return this.harness.submit("run:"+id,{operationId:id});}
  async abort(id){
    const stub=this.env.WITNESS.getByName(id);
    const record=async(kind,detail="") => {
      const r=await stub.fetch(new Request("https://witness.internal/record",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({kind,instance:this.instance,detail})
      }));
      if(!r.ok)throw Error("Witness abort marker rejected");
    };
    await record("abort_requested");
    const aborted=await this.harness.session("1").abort(id);
    await record("abort_returned",String(aborted));
    return {aborted};
  }
  async status(){
    return {instance:this.instance,completed:(await this.ctx.storage.get("completed"))??false,
      pending:await this.harness.pending(),alarmTime:await this.ctx.storage.getAlarm(),reports:this.reports};
  }
  async result(id){
    try{const value=await this.harness.session("1").wait(id,AbortSignal.timeout(350));return {settled:true,value};}
    catch(error){return {settled:false,error:String(error?.name??error).slice(0,100)};}
  }
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url),id=url.searchParams.get("id");
    if(env.LAB_HOSTED!=="true" || !env.LAB_CONTROL_TOKEN ||
       request.headers.get("authorization")!=="Bearer "+env.LAB_CONTROL_TOKEN)
      return Response.json({error:"Unauthorised"},{status:401});
    if(!validId(id) || !JSON.parse(env.LAB_ALLOWED_IDS).includes(id))
      return Response.json({error:"Outside two-operation scope"},{status:403});
    const witness=env.WITNESS.getByName(id);
    if(url.pathname==="/witness" && request.method==="GET")
      return witness.fetch("https://witness.internal/state");
    if(url.pathname==="/start" && request.method==="POST"){
      const reserved=await witness.fetch("https://witness.internal/reserve",{method:"POST"});
      if(!reserved.ok)return Response.json({error:"Operation already reserved"},{status:409});
      return Response.json(await env.PROBE.getByName(id).submit(id));
    }
    // Prevent any external Probe GET before automatic completion, so only
    // the lifecycle alarm can wake the object in the observation interval.
    if(id.endsWith("-auto") && ["/status","/result"].includes(url.pathname)){
      const state=await (await witness.fetch("https://witness.internal/state")).json();
      if(!state.events.some(e=>e.kind==="tool_completed"))
        return Response.json({error:"Automatic wake not yet independently witnessed"},{status:425});
    }
    const probe=env.PROBE.getByName(id);
    if(url.pathname==="/status" && request.method==="GET")
      return Response.json(await probe.status());
    if(url.pathname==="/result" && request.method==="GET")
      return Response.json(await probe.result(id));
    if(url.pathname==="/abort" && request.method==="POST" && id.endsWith("-abort"))
      return Response.json(await probe.abort(id));
    return Response.json({error:"Unknown or disallowed route"},{status:404});
  }
};
