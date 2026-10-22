import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {loadPrivateTestKey,verifyTestAccount} from "./test-scope.mjs";
const root=path.resolve(import.meta.dirname,"..");
const privateDir=path.join(process.env.HOME,".config/pi-durable-stripe-lab");
const key=loadPrivateTestKey(path.join(privateDir,"stripe-test.env"));
await verifyTestAccount(key);
const file=path.join(privateDir,"hosted-webhook.json");
let endpoint;
if(fs.existsSync(file))endpoint=JSON.parse(fs.readFileSync(file,"utf8"));
else{
 const r=await fetch("https://api.stripe.com/v1/webhook_endpoints",{method:"POST",redirect:"error",headers:{authorization:"Bearer "+key,"content-type":"application/x-www-form-urlencoded","idempotency-key":"pi-lab-webhook-20261022"},
 body:new URLSearchParams({url:"https://pi-stripe-lab-webhook.woeinvests.workers.dev/stripe/webhook","enabled_events[]":"payment_intent.succeeded",description:"Temporary Pi Durable crash lab, test mode only","metadata[lab]":"pi-durable-stripe-crash-lab"})});
 const d=await r.json();
 if(!r.ok||d.livemode!==false||!d.secret?.startsWith("whsec_"))throw new Error("Test webhook provisioning failed");
 endpoint={id:d.id,secret:d.secret,livemode:false,url:d.url};
 fs.writeFileSync(file,JSON.stringify(endpoint),{mode:0o600,flag:"wx"});
}
if(endpoint.deleted)throw new Error("Prior temporary endpoint was removed; explicitly provision a new scoped run");
const {LAB_CONTROL_TOKEN}=JSON.parse(fs.readFileSync(path.join(privateDir,"hosted-control.json"),"utf8"));
const r=spawnSync(path.join(root,"node_modules/.bin/wrangler"),["secret","bulk","--config","wrangler.hosted-webhook.jsonc"],{cwd:root,input:JSON.stringify({STRIPE_WEBHOOK_SECRET:endpoint.secret,LAB_CONTROL_TOKEN}),encoding:"utf8"});
if(r.status!==0)throw new Error("Webhook secret binding failed");
console.log(JSON.stringify({id:endpoint.id,livemode:endpoint.livemode,url:endpoint.url,configured:true}));
