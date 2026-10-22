import fs from "node:fs";import path from "node:path";import {spawn} from "node:child_process";
import {environmentForChild} from "./process-env.mjs";
const root=path.resolve(import.meta.dirname,".."), base="http://127.0.0.1:18965";
const dir=path.join(root,".evidence/runs/replay-comparison-20261022");fs.mkdirSync(dir,{recursive:true,mode:0o700});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function kill(cp){if(!cp?.pid)return;try{process.kill(-cp.pid,"SIGKILL");}catch{}await sleep(400);}
async function get(route,id,method="GET"){const r=await fetch(base+route+"?id="+id,{method,signal:AbortSignal.timeout(4000)});if(!r.ok)throw new Error("HTTP "+r.status);return r.json();}
async function until(fn,check){let last;const end=Date.now()+60000;while(Date.now()<end){try{last=await fn();if(check(last))return last;}catch(e){last=String(e);}await sleep(200);}throw new Error("Timeout: "+JSON.stringify(last));}
const results=[];
for(const replay of ["unsafe","safe"]){
 const id="probe-"+replay+"-"+Date.now(), persistence=path.join(dir,id);let cp;
 const result={replay,id,externalPaymentRequests:0,passed:false};
 const start=()=>spawn(path.join(root,"node_modules/.bin/wrangler"),["dev","--config","wrangler.replay-probe.jsonc","--port","18965","--inspector-port","0","--persist-to",persistence,"--var","PROBE_REPLAY:"+replay],{cwd:root,detached:true,stdio:["ignore",fs.openSync(path.join(dir,id+".runtime.log"),"a"),fs.openSync(path.join(dir,id+".runtime.log"),"a")],env:environmentForChild(process.env,{},"wrangler")});
 try{
  try{await fetch(base,{signal:AbortSignal.timeout(300)});throw new Error("Port occupied");}catch(e){if(e.message==="Port occupied")throw e;}
  cp=start();await until(()=>get("/status",id),s=>s.calls===0);
  await get("/start",id,"POST");await until(()=>get("/status",id),s=>s.blocked&&s.calls===1);
  await kill(cp);cp=null;cp=start();
  await until(()=>get("/status",id),s=>s.calls>=1);
  const outcome=await until(()=>get("/result",id),r=>r.status==="done");
  const status=await get("/status",id);
  if(status.calls!==(replay==="safe"?2:1)||outcome.text!==(replay==="safe"?"completed":"interrupted"))throw new Error("Replay policy mismatch");
  Object.assign(result,{calls:status.calls,outcome:outcome.text,passed:true});
 }catch(e){result.error=String(e);}finally{await kill(cp);results.push(result);}
}
fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify({mode:"read-only-fixture",results,passed:results.every(r=>r.passed)},null,2)+"\n",{mode:0o600});
console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.passed))process.exitCode=1;
