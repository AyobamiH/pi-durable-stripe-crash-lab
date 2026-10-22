import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const source = fs.readFileSync(new URL("../src/hosted-gateway.ts",import.meta.url),"utf8")
 .replace('import { DurableObject } from "cloudflare:workers";','class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {PaymentLedger}=await import("data:text/javascript;base64,"+Buffer.from(js).toString("base64"));
const id="lab-hosted-unit";
function setup(){
 const values=new Map();let tail=Promise.resolve();
 const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),
 transaction:fn=>{const p=tail.then(()=>fn(storage));tail=p.catch(()=>{});return p;}};
 const obj=new PaymentLedger({storage},{LAB_OPERATION_ID:id,STRIPE_TEST_SECRET_KEY:"sk_test_"+"x".repeat(24)});
 const request=(operationId=id)=>new Request("https://gateway.internal/payment",{method:"POST",body:JSON.stringify({operationId,amount:100,currency:"gbp"})});
 return {obj,storage,request};
}
test("hosted gateway rejects out-of-scope operations before network access",async()=>{
 const {obj,request}=setup(); const old=globalThis.fetch;
 globalThis.fetch=()=>{throw new Error("Must not fetch");};
 try{assert.equal((await obj.fetch(request("lab-wrong"))).status,403);}finally{globalThis.fetch=old;}
});
test("hosted gateway serialises concurrent admission and retains one accepted effect",async()=>{
 const {obj,storage,request}=setup();const old=globalThis.fetch;let writes=0;
 globalThis.fetch=async(url,options)=>{
  assert.equal(options.redirect,"manual");
  if(String(url).endsWith("/account"))return Response.json({id:"acct_1QNKKrGbPfXt7ec5"});
  if(String(url).endsWith("/balance"))return Response.json({livemode:false});
  writes++;assert.equal(options.method,"POST");
  return Response.json({id:"pi_unit",amount:100,currency:"gbp",livemode:false,status:"succeeded"});
 };
 try{
  const replies=await Promise.all([obj.fetch(request()),obj.fetch(request())]);
  assert.ok(replies.some(r=>r.status===200));assert.equal(writes,1);
  const again=await obj.fetch(request());assert.equal(again.status,200);assert.equal(writes,1);
  const state=await storage.get("ledger");assert.equal(state.stripeCreateRequests,1);assert.equal(state.gatewayRequests,3);
 }finally{globalThis.fetch=old;}
});
test("hosted gateway cannot retry an ambiguous provider outcome, including after replacement",async()=>{
 const {obj,storage,request}=setup();const old=globalThis.fetch;let writes=0;
 globalThis.fetch=async url=>{
  if(String(url).endsWith("/account"))return Response.json({id:"acct_1QNKKrGbPfXt7ec5"});
  if(String(url).endsWith("/balance"))return Response.json({livemode:false});
  writes++;throw new Error("Connection lost after send");
 };
 try{
  assert.equal((await obj.fetch(request())).status,502);
  const replacement=new PaymentLedger({storage},{LAB_OPERATION_ID:id,STRIPE_TEST_SECRET_KEY:"sk_test_"+"x".repeat(24)});
  assert.equal((await replacement.fetch(request())).status,409);assert.equal(writes,1);
 }finally{globalThis.fetch=old;}
});
test("hosted wrong account consumes no payment request",async()=>{
 const {obj,storage,request}=setup();const old=globalThis.fetch;
 globalThis.fetch=async url=>Response.json(String(url).endsWith("/account")?{id:"acct_wrong"}:{livemode:false});
 try{assert.equal((await obj.fetch(request())).status,502);assert.equal((await storage.get("ledger")).stripeCreateRequests,0);}
 finally{globalThis.fetch=old;}
});
