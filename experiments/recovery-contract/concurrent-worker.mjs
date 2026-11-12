#!/usr/bin/env node
import { existsSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Provider, Controller } from "./core.mjs";
const [dir,policy,workerId,intent]=process.argv.slice(2);
if(!dir||!["A-new-key","B-stable-key","C-authority-ledger"].includes(policy)||!["1","2"].includes(workerId)||!intent)throw Error("Bad worker parameters");
async function wait(name) {
 const deadline=Date.now()+10000;
 while(Date.now()<deadline) {
  if(existsSync(join(dir,name)))return;
  await delay(10);
 }
 throw Error("Timed out waiting for controlled barrier "+name);
}
writeFileSync(join(dir,"ready-"+workerId),"ready\n",{flag:"wx"});
await wait("go");
const controller=new Controller(join(dir,"controller.sqlite"));
const payload={amount:100,currency:"gbp",recipient:"synthetic-recipient"};
const attempt=intent+"-w"+workerId;
const exclusive=policy==="C-authority-ledger";
const admitted=controller.admit(intent,attempt,payload,1,{
 enforceAuthority:exclusive,enforcePayload:exclusive,exclusive
});
writeFileSync(join(dir,"admitted-"+workerId+".json"),JSON.stringify(admitted),{flag:"wx",mode:0o600});
await wait("release");
let providerResult=null;
if(admitted.accepted){
 const provider=new Provider(join(dir,"provider.sqlite"),{retentionTicks:100});
 const key=policy==="A-new-key"?"key-"+intent+"-w"+workerId:"key-"+intent;
 providerResult=provider.commit({intent,key,payload,attempt,tick:2,epoch:1});
 provider.close();
}
writeFileSync(join(dir,"result-"+workerId+".json"),JSON.stringify({admitted,providerResult,workerId}),{flag:"wx",mode:0o600});
controller.close();
