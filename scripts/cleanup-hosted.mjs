import fs from "node:fs";import path from "node:path";import {spawnSync} from "node:child_process";
import {loadPrivateTestKey,verifyTestAccount} from "./test-scope.mjs";
const root=path.resolve(import.meta.dirname,".."),privateDir=path.join(process.env.HOME,".config/pi-durable-stripe-lab");
const key=loadPrivateTestKey(path.join(privateDir,"stripe-test.env"));await verifyTestAccount(key);
const file=path.join(privateDir,"hosted-webhook.json"),endpoint=JSON.parse(fs.readFileSync(file,"utf8"));
if(endpoint.id!=="we_1UTRlUGbPfXt7ec5LCmYMv3h"||endpoint.livemode!==false||endpoint.url!=="https://pi-stripe-lab-webhook.woeinvests.workers.dev/stripe/webhook")throw new Error("Cleanup scope mismatch");
const record={at:new Date().toISOString(),endpointId:endpoint.id,endpointDeleted:false,removedSecrets:[],disabledPublicEndpoints:[]};
if(!endpoint.deleted){
 const r=await fetch("https://api.stripe.com/v1/webhook_endpoints/"+endpoint.id,{method:"DELETE",redirect:"error",headers:{authorization:"Bearer "+key}});
 const d=await r.json();if(!r.ok||d.deleted!==true||d.id!==endpoint.id)throw new Error("Webhook deletion not confirmed");
 fs.writeFileSync(file,JSON.stringify({id:endpoint.id,url:endpoint.url,livemode:false,deleted:true}),{mode:0o600});
}
record.endpointDeleted=true;
function run(args,input){const r=spawnSync(path.join(root,"node_modules/.bin/wrangler"),args,{cwd:root,input,encoding:"utf8"});if(r.status!==0)throw new Error("Scoped Wrangler cleanup failed: "+args.join(" "));}
for(const [config,name] of [["wrangler.hosted-gateway.jsonc","STRIPE_TEST_SECRET_KEY"],["wrangler.hosted-webhook.jsonc","STRIPE_WEBHOOK_SECRET"]]){
 run(["secret","delete",name,"--config",config],"y\n");record.removedSecrets.push(name);
}
for(const config of ["wrangler.hosted-agent.jsonc","wrangler.hosted-webhook.jsonc"]){
 const file=path.join(root,config),d=JSON.parse(fs.readFileSync(file,"utf8"));d.workers_dev=false;d.preview_urls=false;
 fs.writeFileSync(file,JSON.stringify(d,null,2)+"\n");run(["deploy","--config",config]);
 record.disabledPublicEndpoints.push(d.name);
}
fs.writeFileSync(path.join(root,".evidence/cleanup-20261022.json"),JSON.stringify(record,null,2)+"\n",{mode:0o600});
console.log(JSON.stringify(record,null,2));
