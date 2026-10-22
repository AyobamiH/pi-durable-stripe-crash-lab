import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawnSync} from "node:child_process";
import {loadPrivateTestKey,verifyTestAccount} from "./test-scope.mjs";
const root=path.resolve(import.meta.dirname,"..");
const privateDir=path.join(process.env.HOME,".config/pi-durable-stripe-lab");
const key=loadPrivateTestKey(path.join(privateDir,"stripe-test.env"));
await verifyTestAccount(key);
const controlFile=path.join(privateDir,"hosted-control.json");
if(!fs.existsSync(controlFile)) fs.writeFileSync(controlFile,JSON.stringify({LAB_CONTROL_TOKEN:crypto.randomBytes(32).toString("hex")}),{mode:0o600,flag:"wx"});
if((fs.statSync(controlFile).mode&0o777)!==0o600)throw new Error("Private control file requires 0600");
const control=JSON.parse(fs.readFileSync(controlFile,"utf8"));
for(const [config,secrets] of [
 ["wrangler.hosted-gateway.jsonc",{STRIPE_TEST_SECRET_KEY:key}],
 ["wrangler.hosted-agent.jsonc",control]
]){
 const r=spawnSync(path.join(root,"node_modules/.bin/wrangler"),["secret","bulk","--config",config],{cwd:root,input:JSON.stringify(secrets),encoding:"utf8",env:process.env});
 if(r.status!==0)throw new Error("Secret binding failed for "+config+"; review Wrangler diagnostics locally");
 console.log("Secret binding succeeded: "+config+" ("+Object.keys(secrets).join(",")+")");
}
