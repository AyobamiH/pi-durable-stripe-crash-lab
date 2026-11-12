#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { policies, cases, runCell } from "./matrix.mjs";

const ROOT=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const index=args.indexOf("--output");
if(index<0||!args[index+1])throw Error("Use --output with a new, private, empty evidence directory");
const output=path.resolve(args[index+1]);
if(!output.includes("/.evidence/")||fs.existsSync(output))throw Error("Evidence path must be unique and beneath ignored .evidence");
fs.mkdirSync(output,{recursive:true,mode:0o700});
const runs=path.join(output,"cells");
fs.mkdirSync(runs,{mode:0o700});
const startedAt=new Date().toISOString();
const records=[];
for(const policy of policies){
 for(const fault of cases){
  for(let rep=1;rep<=3;rep++){
   records.push(runCell({policy,fault,repetition:rep,directory:runs}));
  }
 }
}
assert.equal(records.length,120);
const group=(policy,fault)=>records.filter(r=>r.policy===policy&&(!fault||r.fault===fault));
const c=group("C-authority-ledger");
assert.equal(c.length,30);
assert.equal(c.every(r=>r.scores.safety),true,"Authority-aware policy breached");
assert.equal(group("C-authority-ledger","readback-unavailable").every(r=>r.claim==="unknown"&&r.scores.effectCount===1),true);
assert.equal(group("C-authority-ledger","cancel-before-retry").every(r=>r.scores.newlyDispatchedAttempts===0),true);
assert.equal(group("C-authority-ledger","changed-payload").every(r=>r.scores.newPayloadEffects===0&&r.claim==="denied"),true);
assert.equal(group("C-authority-ledger","inflight-commit-after-cancel").every(r=>r.scores.lateCommitsAfterRevocation===1&&r.scores.dispatchesAfterRevocation===0),true);
assert.equal(group("A-new-key","committed-response-lost").every(r=>r.scores.duplicates===1),true,"Bad control must actually duplicate");
assert.equal(group("A-new-key","concurrent-recovery").every(r=>r.scores.duplicates===1),true);
assert.equal(group("B-stable-key","simulated-expired-provider-key").every(r=>r.scores.duplicates===1),true);
assert.equal(group("B-stable-key","changed-payload").every(r=>r.scores.providerPayloadConflicts===1),true);
assert.equal(group("D-hold","uncommitted-response-lost").every(r=>r.scores.unnecessaryHold),true);
const counts=Object.fromEntries(policies.map(policy=>{
 const x=group(policy);
 return [policy,{
  scenarios:x.length,
  unsafe:x.filter(r=>!r.scores.safety).length,
  duplicates:x.reduce((a,r)=>a+r.scores.duplicates,0),
  unauthorisedDispatches:x.reduce((a,r)=>a+r.scores.dispatchesAfterRevocation,0),
  lateCommitsAfterRevocation:x.reduce((a,r)=>a+r.scores.lateCommitsAfterRevocation,0),
  authorisedProgressCases:x.filter(r=>r.scores.authorisedProgress).length,
  unnecessaryHolds:x.filter(r=>r.scores.unnecessaryHold).length,
  unresolvedClaims:x.filter(r=>r.scores.unresolvedClaim).length,
  falseClaims:x.filter(r=>r.scores.falseClaim).length
 }];
}));
const summary={schema:1,scope:"synthetic SQLite simulation (NOT Stripe or Cloudflare)",
  reproducibility: "deterministic policy × 10 cases × three repetitions",
  startedAt,completedAt:new Date().toISOString(),runCount:records.length,
  policyCount:policies.length,faultCaseCount:cases.length,repetitions:3,counts,
  controls:{
   unsafeNewKeyDuplicatesDetected:true,
   stableKeyExpiredSimulatedDuplicateDetected:true,
   conflictingPayloadRejected:true,
   holdOnUncertainSacrificesProgress:true,
   authorityPolicyZeroDuplicatesWithinSimulation:true,
   lateCommitAfterCancelDistinguishedFromNewDispatch:true,
   providerReadbackUnavailableMarkedUnknown:true
  },
  limits:[
   "No genuine provider failure, Stripe pruning, real account auth change, hosted Cloudflare eviction, or model reasoning measured",
   "SQLite provider uses a cooperating durable idempotency cache and authoritative lookup",
   "Retention expiry is injected using synthetic ticks, not elapsed real hours",
   "A passing harness assertion is not proof of global novelty or general exactly-once execution",
   "Each case independently resets state, so no statistical inference about real-world incident rates"
  ]
};
fs.writeFileSync(path.join(output,"summary.json"),JSON.stringify(summary,null,2)+"\n",{mode:0o600,flag:"wx"});
const trackedSource=["core.mjs","matrix.mjs","run.mjs"];
const hashes=Object.fromEntries(trackedSource.map(n=>[n,crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT,n))).digest("hex")]));
const receipts={sha256Source:hashes,sha256Summary:crypto.createHash("sha256").update(fs.readFileSync(path.join(output,"summary.json"))).digest("hex"),recordCount:records.length,generatedAt:new Date().toISOString()};
fs.writeFileSync(path.join(output,"manifest.json"),JSON.stringify(receipts,null,2)+"\n",{mode:0o600,flag:"wx"});
console.log(JSON.stringify({passed:true,evidence:output,summary,manifest:receipts},null,2));
