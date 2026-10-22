import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {createHmac} from "node:crypto";
const source=fs.readFileSync(new URL("../src/hosted-webhook.ts",import.meta.url),"utf8").replace('import { DurableObject } from "cloudflare:workers";','class DurableObject {constructor(ctx,env){this.ctx=ctx;this.env=env;}}');
const {validSignature,WebhookLedger}=await import("data:text/javascript;base64,"+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString("base64"));
const secret="whsec_unit_test";const timestamp=Math.floor(Date.now()/1000);
const sign=raw=>"t="+timestamp+",v1="+createHmac("sha256",secret).update(timestamp+"."+raw).digest("hex");
test("webhook rejects changed payload, stale timestamps and bad signatures",async()=>{
 const raw='{"ok":true}';
 assert.equal(await validSignature(raw,sign(raw),secret),true);
 assert.equal(await validSignature(raw+" ",sign(raw),secret),false);
 assert.equal(await validSignature(raw,sign(raw),secret,(timestamp+301)*1000),false);
 assert.equal(await validSignature(raw,"t="+timestamp+",v1=bad",secret),false);
});
test("duplicate signed deliveries preserve one business consequence",async()=>{
 const data=new Map();const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),transaction:async fn=>fn(storage)};
 const ledger=new WebhookLedger({storage},{STRIPE_WEBHOOK_SECRET:secret,LAB_OPERATION_ID:"lab-webhook",LAB_CONTROL_TOKEN:"test-token"});
 const raw=JSON.stringify({id:"evt_unit",type:"payment_intent.succeeded",livemode:false,data:{object:{id:"pi_unit",status:"succeeded",livemode:false,amount:100,currency:"gbp",metadata:{lab_operation:"lab-webhook"}}}});
 for(let n=0;n<3;n++){
  const response=await ledger.fetch(new Request("https://test/stripe/webhook",{method:"POST",headers:{"stripe-signature":sign(raw)},body:raw}));
  assert.equal(response.status,200);
 }
 const state=await storage.get("state");assert.equal(state.deliveries,3);assert.equal(state.businessConsequences,1);assert.deepEqual(state.eventIds,["evt_unit"]);
 assert.equal((await ledger.fetch(new Request("https://test/payload"))).status,401);
});
