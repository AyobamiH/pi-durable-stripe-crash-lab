import fs from "node:fs";import path from "node:path";
import {assertMatchingReceipt} from "./acceptance.mjs";
const root=path.resolve(import.meta.dirname,"..");
const id=JSON.parse(fs.readFileSync(path.join(root,"wrangler.hosted-agent.jsonc"),"utf8")).vars.LAB_OPERATION_ID;
const dir=path.join(root,".evidence/runs",id);
const initial=JSON.parse(fs.readFileSync(path.join(dir,"result.json"),"utf8"));
const {LAB_CONTROL_TOKEN:t}=JSON.parse(fs.readFileSync(path.join(process.env.HOME,".config/pi-durable-stripe-lab/hosted-control.json"),"utf8"));
const call=async(route,method="GET",body)=>{const r=await fetch("https://pi-stripe-lab-agent.woeinvests.workers.dev"+route+(route.includes("?")?"&":"?")+"session="+id,{method,headers:{authorization:"Bearer "+t,"content-type":"application/json"},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok)throw new Error("HTTP "+r.status);return d;};
const result={runId:id,startedAt:new Date().toISOString(),noNewPayment:true,passed:false,initialHarnessAssertion:"Expected crash marker did not persist through abort; original failed result retained"};
try{
 if(!initial.providerId||!initial.crashResponse?.includes("Intentional Pi laboratory crash after provider acceptance"))throw new Error("No recorded deliberate crash");
 const after=await call("/status");
 if(after.instanceId===initial.before.instanceId)throw new Error("Object instance did not change");
 const terminal=await call("/result?operationId="+id);
 if(terminal.status!=="done"||!terminal.text?.startsWith("interrupted or failed:"))throw new Error("Unsafe tool recovery not complete");
 assertMatchingReceipt(after,await call("/gateway-state"),id,"stripe-test");
 const duplicate=await call("/start","POST",{operationId:id});
 if(duplicate.accepted!==false)throw new Error("Duplicate admitted");
 for(let n=0;n<3;n++){await new Promise(r=>setTimeout(r,500));assertMatchingReceipt(await call("/status"),await call("/gateway-state"),id,"stripe-test");}
 Object.assign(result,{providerId:initial.providerId,before:initial.before,after:await call("/status"),gatewayAfter:await call("/gateway-state"),terminal,duplicate,passed:true});
}catch(e){result.error=String(e);}
finally{result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(dir,"recovery-readback.json"),JSON.stringify(result,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(result,null,2));}
if(!result.passed)process.exitCode=1;
