#!/usr/bin/env node
/**
 * Read-only verification of redacted hosted Pi 1.4 observation files.
 * The readbacks are owner-recorded, not third-party audited.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here=path.dirname(fileURLToPath(import.meta.url));
const repository=path.resolve(here,"../..");
const evidence=process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repository,"docs/evidence/pi14-hosted-inert-20261113");
const manifest=JSON.parse(fs.readFileSync(path.join(evidence,"manifest.json"),"utf8"));
assert.equal(manifest.schema,1);
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for(const [name,expected] of Object.entries(manifest.files)){
  if(!/^[a-z0-9-]+\.json$/.test(name) || name==="manifest.json")throw Error("Invalid evidence filename");
  assert.equal(sha(path.join(evidence,name)),expected,"Evidence file changed: "+name);
}
assert.equal(sha(path.join(here,"worker.js")),manifest.workerSha256);
assert.equal(sha(path.join(here,"package-lock.json")),manifest.lockSha256);
const get=name=>JSON.parse(fs.readFileSync(path.join(evidence,name),"utf8"));
const before=get("retry-inflight-observed.json");
const first=get("retry-after-crash1.json");
const second=get("retry-after-crash2.json");
const finished=get("retry-final-readback.json");
const separate=get("abort-inflight-observed.json");
const preflight=get("preflight-readback.json");
assert.equal(preflight.unauthorisedDenied,true);
assert.equal(preflight.outOfScopeDenied,true);
assert.equal(before.calls,1);
assert.notEqual(first.instance,before.instance);
assert.ok(first.calls>=2);
assert.notEqual(second.instance,first.instance);
assert.equal(second.pending?.some(x=>x.status==="parked"),true);
assert.equal(second.completed,false);
assert.equal(second.crashes,0,"Premature crash marker unexpectedly persisted; reconcile source if changed");
assert.equal(finished.observed.completed,true);
assert.deepEqual(finished.observed.pending,[]);
assert.equal(finished.observed.calls,3);
assert.equal(finished.result.value.status,"done");
assert.equal(finished.result.value.text,"completed");
assert.equal(separate.calls,1);
assert.equal(separate.completed,false);
assert.equal(separate.pending?.some(x=>x.status==="running"),true);
assert.equal(manifest.stripeCalls,0);
assert.equal(manifest.workerDeleted,true);
assert.equal(manifest.tokenDeleted,true);
assert.equal(manifest.postDeleteHttp,404);
console.log(JSON.stringify({
  verified:true,sourceSha256:manifest.workerSha256,redactedFiles:Object.keys(manifest.files).length,
  hostedRetryParked:true,hostedRetryDone:true,hostedAbortFinished:false,
  sourceVersion:"Pi 1.4.0 / Agents 0.30.1",externalStripeCalls:0,
  cleanup:{workerDeleted:true,tokenDeleted:true,http:404},
  independentThirdPartyAudit:false
}));
