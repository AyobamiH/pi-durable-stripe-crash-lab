import fs from "node:fs";
import path from "node:path";
import {createHmac} from "node:crypto";
const root=path.resolve(import.meta.dirname,"..");
const privateDir=path.join(process.env.HOME,".config/pi-durable-stripe-lab");
const {LAB_CONTROL_TOKEN:token}=JSON.parse(fs.readFileSync(path.join(privateDir,"hosted-control.json"),"utf8"));
const endpoint=JSON.parse(fs.readFileSync(path.join(privateDir,"hosted-webhook.json"),"utf8"));
const runId=JSON.parse(fs.readFileSync(path.join(root,"wrangler.hosted-agent.jsonc"),"utf8")).vars.LAB_OPERATION_ID;
const initial=JSON.parse(fs.readFileSync(path.join(root,".evidence/runs",runId,"result.json"),"utf8"));
const hosted=initial.passed ? initial : JSON.parse(fs.readFileSync(path.join(root,".evidence/runs",runId,"recovery-readback.json"),"utf8"));
const base="https://pi-stripe-lab-webhook.woeinvests.workers.dev";
const get=async route=>{const r=await fetch(base+route,{headers:{authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error("Webhook read failed");return r;};
const result={runId,startedAt:new Date().toISOString(),endpointId:endpoint.id,mode:"stripe-test",passed:false};
try{
 if(!hosted.passed)throw new Error("Hosted payment not accepted");
 const invalid=await fetch(endpoint.url,{method:"POST",headers:{"stripe-signature":"invalid"},body:"{}"});
 if(invalid.status!==400)throw new Error("Invalid signature accepted");
 let first;
 for(let n=0;n<120;n++){first=await (await get("/state")).json();if(first.deliveries>0)break;await new Promise(r=>setTimeout(r,500));}
 if(first.businessConsequences!==1||first.paymentIntentId!==hosted.providerId)throw new Error("No genuine Stripe delivery");
 result.originalStripeDelivery=first;
 const raw=await(await get("/payload")).text();
 const event=JSON.parse(raw);
 if(event.id!==first.eventIds[0]||event.data.object.id!==hosted.providerId)throw new Error("Event mismatch");
 for(let n=0;n<2;n++){
  const t=Math.floor(Date.now()/1000);
  const signature="t="+t+",v1="+createHmac("sha256",endpoint.secret).update(t+"."+raw).digest("hex");
  const r=await fetch(endpoint.url,{method:"POST",headers:{"content-type":"application/json","stripe-signature":signature},body:raw,signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error("Signed duplicate rejected");
 }
 const after=await(await get("/state")).json();
 if(after.deliveries!==first.deliveries+2||after.businessConsequences!==1||after.eventIds.length!==1)throw new Error("Duplicate consequence");
 result.afterSignedTestReplays=after;result.duplicateSource="Two deliberately signed HTTP replays of the original Stripe-delivered payload; not Stripe retry scheduling";
 result.invalidSignatureRejected=true;result.passed=true;
}catch(e){result.error=String(e);}
finally{result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,".evidence/runs",runId,"webhook-result.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(result,null,2));}
if(!result.passed)process.exitCode=1;
