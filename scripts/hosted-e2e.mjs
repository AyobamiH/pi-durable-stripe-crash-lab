import fs from "node:fs";
import path from "node:path";
import { assertMatchingReceipt } from "./acceptance.mjs";
const root = path.resolve(import.meta.dirname,"..");
const config = JSON.parse(fs.readFileSync(path.join(root,"wrangler.hosted-agent.jsonc"),"utf8"));
const id = config.vars.LAB_OPERATION_ID;
const base = "https://pi-stripe-lab-agent.woeinvests.workers.dev";
const credentialPath = path.join(process.env.HOME,".config/pi-durable-stripe-lab/hosted-control.json");
const { LAB_CONTROL_TOKEN: token } = JSON.parse(fs.readFileSync(credentialPath,"utf8"));
const dir = path.join(root,".evidence/runs",id);
fs.mkdirSync(dir,{recursive:true,mode:0o700});
const result = {runId:id,startedAt:new Date().toISOString(),mode:"stripe-test",environment:"cloudflare-hosted",
  upstream:"agents@0.28.1 / pi-durable@1.3.0",crashMethod:"DurableObjectState.abort",noRealMoney:true,passed:false,phases:[]};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const call = async (route, method="GET",body) => {
 const url = base+route+(route.includes("?")?"&":"?")+"session="+id;
 const r=await fetch(url,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 const d=await r.json();
 if(!r.ok) throw new Error("HTTP "+r.status+": "+JSON.stringify(d));
 return d;
};
const eventually = async (fn, predicate, timeout=90000) => {
 const end=Date.now()+timeout; let last;
 while(Date.now()<end){try{last=await fn();if(predicate(last))return last;}catch(e){last=String(e);}
 await sleep(500);}
 throw new Error("Timed out: "+JSON.stringify(last));
};
try {
 const unauthorised=await fetch(base+"/status?session="+id);
 if(unauthorised.status!==401)throw new Error("Public control endpoint not protected");
 result.phases.push("unauthenticated_requests_denied");
 const initial=await call("/status");
 if(initial.phase!=="not_started")throw new Error("Run already started; inspect existing evidence, no rerun");
 const first=await call("/start","POST",{operationId:id});
 if(!first.accepted)throw new Error("First operation not admitted");
 const before=await eventually(()=>call("/status"),v=>v.phase==="provider_accepted_waiting");
 const gwBefore=await call("/gateway-state");
 assertMatchingReceipt(before,gwBefore,id,"stripe-test");
 result.before=before;result.gatewayBefore=gwBefore;result.providerId=before.providerReceipt.id;
 result.phases.push("stripe_effect_before_tool_completion");
 try{await call("/crash","POST");}catch(e){result.crashResponse=String(e);}
 if(!result.crashResponse?.includes("Intentional Pi laboratory crash after provider acceptance"))throw new Error("Expected crash response absent");
 // abort may discard a buffered marker write; the external RPC outcome and
 // replaced instance prove the boundary without relying on that marker.
 const after=await eventually(()=>call("/status"),v=>v.instanceId!==before.instanceId);
 if(after.toolExecutions!==1)throw new Error("Tool replayed");
 result.phases.push("new_durable_object_instance_after_abort");
 const completed=await eventually(()=>call("/result?operationId="+id),v=>v.status==="done");
 if(!completed.text?.startsWith("interrupted or failed:"))throw new Error("Unsafe interruption not reported");
 result.recoveryText=completed.text;
 const repeated=await call("/start","POST",{operationId:id});
 if(repeated.accepted!==false)throw new Error("Duplicate operation admitted");
 for(let n=0;n<3;n++){await sleep(500);assertMatchingReceipt(await call("/status"),await call("/gateway-state"),id,"stripe-test");}
 result.after=await call("/status");result.gatewayAfter=await call("/gateway-state");
 result.phases.push("unsafe_tool_not_replayed","duplicate_submission_rejected","post_duplicate_receipts_unchanged");
 result.passed=true;
}catch(e){result.error=String(e);}
finally{result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(result,null,2));}
if(!result.passed)process.exitCode=1;
