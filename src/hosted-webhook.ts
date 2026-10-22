import { DurableObject } from "cloudflare:workers";
interface Env { WEBHOOK_LEDGER:DurableObjectNamespace<WebhookLedger>; STRIPE_WEBHOOK_SECRET:string; LAB_CONTROL_TOKEN:string; LAB_OPERATION_ID:string; }
export async function validSignature(raw:string,signature:string,secret:string,now=Date.now()) {
  if(!secret?.startsWith("whsec_"))return false;
  const parts=signature.split(",");
  const timestamp=parts.find(p=>p.startsWith("t="))?.slice(2) ?? "";
  if(!/^\d+$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)return false;
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
  for(const sig of parts.filter(p=>p.startsWith("v1=")).map(p=>p.slice(3))){
    if(!/^[a-f0-9]{64}$/.test(sig))continue;
    const bytes=new Uint8Array(sig.match(/../g)!.map(x=>parseInt(x,16)));
    if(await crypto.subtle.verify("HMAC",key,bytes,new TextEncoder().encode(timestamp+"."+raw)))return true;
  }
  return false;
}
export class WebhookLedger extends DurableObject<Env> {
  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url);
    if(["/state","/payload"].includes(url.pathname)){
      if(request.headers.get("authorization")!=="Bearer "+this.env.LAB_CONTROL_TOKEN)return new Response("Unauthorised",{status:401});
      if(url.pathname==="/payload")return new Response((await this.ctx.storage.get<string>("payload"))??"",{headers:{"content-type":"application/json"}});
      return Response.json((await this.ctx.storage.get("state"))??{deliveries:0,businessConsequences:0,eventIds:[]});
    }
    if(request.method!=="POST"||url.pathname!=="/stripe/webhook")return new Response("Not found",{status:404});
    const raw=await request.text();
    if(raw.length>131072)return new Response("Too large",{status:413});
    if(!await validSignature(raw,request.headers.get("stripe-signature")??"",this.env.STRIPE_WEBHOOK_SECRET))return new Response("Invalid signature",{status:400});
    let event;
    try{event=JSON.parse(raw);}catch{return new Response("Bad JSON",{status:400});}
    const pi=event.data?.object;
    if(event.type!=="payment_intent.succeeded"||event.livemode!==false||pi?.metadata?.lab_operation!==this.env.LAB_OPERATION_ID)return Response.json({ignored:true});
    if(pi.livemode!==false||pi.amount!==100||pi.currency!=="gbp"||pi.status!=="succeeded"||!event.id?.startsWith("evt_"))return new Response("Invalid lab event",{status:400});
    const summary=await this.ctx.storage.transaction(async txn=>{
      const state=(await txn.get<{deliveries:number;businessConsequences:number;eventIds:string[];paymentIntentId?:string}>("state"))??{deliveries:0,businessConsequences:0,eventIds:[]};
      if(state.paymentIntentId&&state.paymentIntentId!==pi.id)throw new Error("Conflicting payment");
      state.deliveries++;state.paymentIntentId=pi.id;
      if(!state.eventIds.includes(event.id))state.eventIds.push(event.id);
      state.businessConsequences=1;
      await txn.put("state",state);await txn.put("payload",raw);
      return state;
    });
    return Response.json({received:true,...summary});
  }
}
export default {fetch(request:Request,env:Env){return env.WEBHOOK_LEDGER.getByName(env.LAB_OPERATION_ID).fetch(request);}};
