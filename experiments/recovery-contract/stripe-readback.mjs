#!/usr/bin/env node
// READ ONLY: two original Stripe test-mode PaymentIntents and the aborted Day 2 scope.
// Never creates, confirms, retries or cancels payments. Never prints secrets.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPrivateTestKey, verifyTestAccount, EXPECTED_ACCOUNT } from "../../scripts/test-scope.mjs";
const args=process.argv.slice(2);
if(args[0]!=="--output"||!args[1])throw Error("Use unique --output private path");
const output=path.resolve(args[1]);
if(!output.includes("/.evidence/")||fs.existsSync(output))throw Error("Evidence file must be new and ignored");
const key=loadPrivateTestKey(path.join(process.env.HOME,".config/pi-durable-stripe-lab/stripe-test.env"));
const account=await verifyTestAccount(key);
assert.equal(account.accountId,EXPECTED_ACCOUNT);
assert.equal(account.livemode,false);
async function fetchStripe(url){
 const r=await fetch(url,{
  method:"GET",headers:{authorization:"Bearer "+key},
  redirect:"error",signal:AbortSignal.timeout(13000)
 });
 assert.equal(r.ok,true,"Provider read-only GET returned HTTP "+r.status);
 const data=await r.json();
 return {data,requestId:r.headers.get("request-id"),apiVersion:r.headers.get("stripe-version")};
}
const original=[
 {id:"pi_3UTReLGbPfXt7ec50W8SyVvv",operation:"lab-work-20261022-local"},
 {id:"pi_3UTRr4GbPfXt7ec50z2eLbbo",operation:"lab-work-20261022-hosted-v2"}
];
const reviewed=[];
for(const item of original){
 const r=await fetchStripe("https://api.stripe.com/v1/payment_intents/"+encodeURIComponent(item.id));
 assert.equal(r.data.id,item.id);
 assert.equal(r.data.metadata?.lab_operation,item.operation);
 assert.equal(r.data.livemode,false);
 assert.equal(r.data.amount,100);
 assert.equal(r.data.currency,"gbp");
 reviewed.push({
  id:r.data.id,operation:item.operation,status:r.data.status,
  amount:r.data.amount,amountReceived:r.data.amount_received,
  currency:r.data.currency,livemode:r.data.livemode,
  metadataOperationMatches:true,readbackRequestId:r.requestId,
  readbackStripeVersion:r.apiVersion??null
 });
}
const abortedOperation="lab-d2-261112-589092";
const day2=[];
const since=Math.floor(Date.parse("2026-11-12T00:58:00Z")/1000);
let hasMore=true,startingAfter=null,pages=0;
while(hasMore&&pages<12){
 const q=new URLSearchParams({"created[gte]":String(since),"limit":"100"});
 if(startingAfter)q.set("starting_after",startingAfter);
 const page=(await fetchStripe("https://api.stripe.com/v1/payment_intents?"+q)).data;
 assert.ok(Array.isArray(page.data));
 for(const p of page.data)if(p.metadata?.lab_operation===abortedOperation)day2.push(p.id);
 hasMore=page.has_more===true;
 startingAfter=page.data.at(-1)?.id;
 pages++;
 if(hasMore&&!startingAfter)throw Error("Cannot prove complete Stripe list");
}
assert.equal(hasMore,false,"Readback window incomplete: no absence claim permitted");
const result={
 observedAt:new Date().toISOString(),
 mode:"real Stripe API test account, READ ONLY",
 originalPaymentIntents:reviewed,
 day2Operation:abortedOperation,
 day2MatchedPaymentIntents:day2,
 day2ListPages:pages,
 day2ListComplete:true,
 requestMode:"GET only",
 externalWrites:0,
 credentialsExported:false,
 resultLimitations:[
  "Historical effective API revision on the original POST still unknown",
  "Owner-controlled provider readback, not external auditor",
  "No evidence of expiry/pruning or general exactly-once guarantee",
  "Readback completeness is for a filterable creation window at this observation time"
 ]
};
fs.writeFileSync(output,JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
console.log(JSON.stringify({readOnly:true,originalPayments:reviewed.map(x=>({id:x.id,status:x.status,livemode:x.livemode})),day2MatchingPayments:day2.length,listComplete:true,out:output}));
