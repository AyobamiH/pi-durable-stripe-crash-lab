#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Provider, Controller, inspectIndependent } from "./core.mjs";
const args=process.argv.slice(2);
if(args[0]!=="--output"||!args[1])throw Error("Use --output unique evidence root");
const root=path.resolve(args[1]);
if(fs.existsSync(root)||!root.includes("/.evidence/"))throw Error("Require new private evidence dir");
fs.mkdirSync(root,{recursive:true,mode:0o700});
const policies=["A-new-key","B-stable-key","C-authority-ledger"];
const rows=[];
async function waitUntil(predicate) {
 const deadline=Date.now()+12000;
 while(Date.now()<deadline){
  if(predicate())return;
  await delay(15);
 }
 throw Error("Concurrent workers failed a barrier");
}
for(const policy of policies)for(let rep=1;rep<=3;rep++){
 const dir=path.join(root,policy+"-"+rep);fs.mkdirSync(dir);
 const intent="intent-"+policy+"-"+rep;
 const provider=new Provider(path.join(dir,"provider.sqlite"));
 const controller=new Controller(path.join(dir,"controller.sqlite"));
 const payload={amount:100,currency:"gbp",recipient:"synthetic-recipient"};
 controller.create(intent,payload,"key-"+intent);
 provider.close();controller.close();
 const runChild=workerId=>{
  const cp=spawn(process.execPath,[new URL("./concurrent-worker.mjs",import.meta.url).pathname,dir,policy,String(workerId),intent],{
   stdio:["ignore","pipe","pipe"]
  });
  let stdout="",stderr="";
  cp.stdout.on("data",x=>stdout+=x.toString());cp.stderr.on("data",x=>stderr+=x.toString());
  const settled=new Promise(resolve=>cp.once("exit",(code,signal)=>resolve({code,signal,stdout,stderr})));
  return {cp,settled};
 };
 const w1=runChild(1),w2=runChild(2);
 try{
  await waitUntil(()=>fs.existsSync(path.join(dir,"ready-1"))&&fs.existsSync(path.join(dir,"ready-2")));
  fs.writeFileSync(path.join(dir,"go"),"go",{flag:"wx"});
  await waitUntil(()=>fs.existsSync(path.join(dir,"admitted-1.json"))&&fs.existsSync(path.join(dir,"admitted-2.json")));
  fs.writeFileSync(path.join(dir,"release"),"go",{flag:"wx"});
  const [exit1,exit2]=await Promise.all([w1.settled,w2.settled]);
  assert.equal(exit1.code,0,exit1.stderr);
  assert.equal(exit2.code,0,exit2.stderr);
  const admissions=[1,2].map(n=>JSON.parse(fs.readFileSync(path.join(dir,"admitted-"+n+".json"),"utf8")));
  const effects=inspectIndependent(path.join(dir,"provider.sqlite"),intent);
  const expectedAdmissions=policy==="C-authority-ledger"?1:2;
  const expectedEffects=policy==="A-new-key"?2:1;
  assert.equal(admissions.filter(x=>x.accepted).length,expectedAdmissions,"Concurrent admission count");
  assert.equal(effects.length,expectedEffects,"Independent provider effect count");
  const result={policy,rep,concurrentChildProcesses:2,admissionCount:expectedAdmissions,
   providerEffectCount:effects.length,duplicates:Math.max(0,effects.length-1),
   controllerExclusive:policy==="C-authority-ledger",
   isolatedPersistedProvider:true,effects:effects.map(x=>({seq:x.seq,attempt:x.attempt}))};
  fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
  rows.push(result);
 }catch(e){
  for(const w of [w1,w2])if(w.cp.exitCode===null)w.cp.kill("SIGKILL");
  throw e;
 }
}
const summary={passed:true,scope:"two real OS processes admitted through shared SQLite transaction",runs:rows.length,
 policies:Object.fromEntries(policies.map(p=>{
  const r=rows.filter(x=>x.policy===p);
  return [p,{runs:r.length,admitted:r.reduce((n,x)=>n+x.admissionCount,0),
   effects:r.reduce((n,x)=>n+x.providerEffectCount,0),duplicates:r.reduce((n,x)=>n+x.duplicates,0)}];
 })),
 limitations:["Simulated cooperating provider, no external Stripe API", "Physical concurrent process admission exercised via shared local SQLite, not distributed Cloudflare failover"]};
fs.writeFileSync(path.join(root,"summary.json"),JSON.stringify(summary,null,2)+"\n",{flag:"wx",mode:0o600});
console.log(JSON.stringify({summary,evidence:root},null,2));
