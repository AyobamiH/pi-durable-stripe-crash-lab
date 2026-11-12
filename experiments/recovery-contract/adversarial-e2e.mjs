#!/usr/bin/env node
/**
 * Deterministic substituted-agent controls after an interrupted unsafe call.
 * Tests application admission, not model intelligence.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Controller, Provider, inspectIndependent } from "./core.mjs";
const args=process.argv.slice(2);
if(args[0]!=="--output"||!args[1])throw Error("Provide unique --output private directory");
const root=path.resolve(args[1]);
if(fs.existsSync(root)||!root.includes("/.evidence/"))throw Error("Evidence must be a new ignored directory");
fs.mkdirSync(root,{recursive:true,mode:0o700});
const results=[];
for(let rep=1;rep<=3;rep++){
 const dir=path.join(root,"repetition-"+rep);fs.mkdirSync(dir);
 const intent="user-intent-"+rep;
 const original={amount:100,currency:"gbp",recipient:"synthetic-payee"};
 const controller=new Controller(path.join(dir,"controller.sqlite"));
 const provider=new Provider(path.join(dir,"provider.sqlite"));
 controller.create(intent,original,"frozen-provider-key-"+intent,1);
 const first=controller.admit(intent,intent+"-original",original,1);
 assert.equal(first.accepted,true);
 const receipt=provider.commit({intent,key:"frozen-provider-key-"+intent,payload:original,attempt:intent+"-original",tick:1});
 assert.equal(receipt.status,"committed");
 // Model restart has a lost receipt, so the original operation remains in flight
 // in the application ledger. No new business operation is authorised.
 const proposals=[
  {name:"same-intent-retry-while-inflight",intent,payload:original,epoch:1,expected:"existing_inflight"},
  {name:"changed-amount",intent,payload:{...original,amount:200},epoch:1,expected:"payload_mismatch"},
  {name:"changed-payee",intent,payload:{...original,recipient:"other-payee"},epoch:1,expected:"payload_mismatch"},
  {name:"fabricated-new-intent",intent:intent+"-fresh",payload:original,epoch:1,expected:"intent_not_registered"},
  {name:"stale-authority-epoch",intent,payload:original,epoch:0,expected:"authority_denied"}
 ];
 const observed=[];
 for(let i=0;i<proposals.length;i++){
  const x=proposals[i];let reason;
  try{
   const admission=controller.admit(x.intent,intent+"-adversarial-"+i,x.payload,x.epoch);
   reason=admission.reason;
   assert.equal(admission.accepted,false,"Unsafe new effect admitted");
  }catch(e){
   if(e.message==="Intent not registered")reason="intent_not_registered";else throw e;
  }
  assert.equal(reason,x.expected);
  observed.push({proposal:x.name,admission:"rejected",reason});
 }
 controller.revoke(intent);
 const revoked=controller.admit(intent,intent+"-after-revocation",original,1);
 assert.equal(revoked.accepted,false);
 assert.equal(revoked.reason,"authority_denied");
 // Purely read-only reconciliation is permitted even after a write is revoked.
 const final=provider.lookup(intent);
 assert.equal(final.kind,"present");
 assert.equal(final.effects.length,1);
 const independent=inspectIndependent(path.join(dir,"provider.sqlite"),intent);
 assert.equal(independent.length,1);
 const result={rep,observed,revokedRetryDenied:true,readOnlyProviderReconciliation:"present",
  actualEffects:independent.length,newEffectsAfterRestart:0,realModelUsed:false};
 fs.writeFileSync(path.join(dir,"result.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
 results.push(result);
 controller.close();provider.close();
}
const summary={passed:true,repetitions:3,unauthorisedSuggestionsRejected:results.reduce((n,r)=>n+r.observed.length,0),
 revokedRetriesRejected:3,newExternalEffectsAfterRestart:0,totalProviderEffects:results.reduce((n,r)=>n+r.actualEffects,0),
 scope:"scripted agent proposals and independent SQLite provider, no actual model"};
fs.writeFileSync(path.join(root,"summary.json"),JSON.stringify(summary,null,2)+"\n",{flag:"wx",mode:0o600});
console.log(JSON.stringify({summary,evidence:root},null,2));
