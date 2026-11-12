#!/usr/bin/env node
// Self-contained offline evidence bundle: files, digests and independent SQLite checks.
// Hashes attest to bundle byte identity only, not external provider history.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
const args=process.argv.slice(2);
const SHA=filename=>crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
function walk(dir){
 const result=[];
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,item.name);
  if(item.isDirectory())result.push(...walk(full));
  else if(item.isFile())result.push(full);
  else throw Error("Symlink or unsupported evidence object: "+full);
 }
 return result;
}
function read(file){return JSON.parse(fs.readFileSync(file,"utf8"));}
function independentCount(file,table,field,id){
 const db=new DatabaseSync(file,{readOnly:true});
 const count=db.prepare("SELECT COUNT(*) AS n FROM "+table+" WHERE "+field+"=?").get(id).n;
 db.close();
 return count;
}
function inspect(root){
 const matrix=read(path.join(root,"matrix","summary.json"));
 const webhook=read(path.join(root,"webhook","summary.json"));
 const concurrent=read(path.join(root,"concurrent","summary.json"));
 const adversarial=read(path.join(root,"adversarial","summary.json"));
 const actual=read(path.join(root,"stripe-readonly.json"));
 assert.equal(matrix.runCount,120);
 assert.equal(webhook.cases,15);
 assert.equal(concurrent.runs,9);
 assert.equal(adversarial.repetitions,3);
 assert.equal(actual.originalPaymentIntents?.length,2);
 assert.equal(actual.day2ListComplete,true);
 assert.equal(actual.day2MatchedPaymentIntents?.length,0);
 assert.equal(actual.externalWrites,0);
 let matrixCount=0,webhookCount=0,concurrentCount=0,adversarialCount=0;
 for(const dir of fs.readdirSync(path.join(root,"matrix","cells"))){
  const where=path.join(root,"matrix","cells",dir);
  const r=read(path.join(where,"result.json"));
  const count=independentCount(path.join(where,"provider.sqlite"),"effects","intent",r.operationId);
  assert.equal(count,r.scores.effectCount,dir+" independent provider count mismatch");
  assert.equal(r.scores.duplicates,Math.max(0,count-1));
  assert.equal(r.scores.safety,!Boolean(r.scores.duplicates||r.scores.newPayloadEffects||r.scores.dispatchesAfterRevocation||r.scores.falseClaim));
  if(r.policy==="C-authority-ledger")assert.equal(r.scores.safety,true);
  matrixCount++;
 }
 for(const dir of fs.readdirSync(path.join(root,"webhook"))){
  const where=path.join(root,"webhook",dir);
  if(!fs.statSync(where).isDirectory())continue;
  const r=read(path.join(where,"result.json"));
  assert.equal(independentCount(path.join(where,"downstream.sqlite"),"effects","event_id",r.eventId),1);
  const db=new DatabaseSync(path.join(where,"inbox.sqlite"),{readOnly:true});
  const inbox=db.prepare("SELECT * FROM inbox WHERE event_id=?").get(r.eventId);
  db.close();
  assert.equal(inbox.state,"acked");
  assert.ok(inbox.deliveries>=2);
  webhookCount++;
 }
 for(const dir of fs.readdirSync(path.join(root,"concurrent"))){
  const where=path.join(root,"concurrent",dir);
  if(!fs.statSync(where).isDirectory())continue;
  const r=read(path.join(where,"result.json"));
  assert.equal(independentCount(path.join(where,"provider.sqlite"),"effects","intent","intent-"+r.policy+"-"+r.rep),r.providerEffectCount);
  concurrentCount++;
 }
 for(const dir of fs.readdirSync(path.join(root,"adversarial"))){
  const where=path.join(root,"adversarial",dir);
  if(!fs.statSync(where).isDirectory())continue;
  const r=read(path.join(where,"result.json"));
  assert.equal(independentCount(path.join(where,"provider.sqlite"),"effects","intent","user-intent-"+r.rep),1);
  assert.equal(r.newEffectsAfterRestart,0);
  adversarialCount++;
 }
 assert.deepEqual([matrixCount,webhookCount,concurrentCount,adversarialCount],[120,15,9,3]);
 return {matrixCount,webhookCount,concurrentCount,adversarialCount,
  sqliteProviderReadbacks:matrixCount+webhookCount+concurrentCount+adversarialCount,
  day2CompleteProviderListHadZeroMatches:true,originalStripeReadbackCount:2,
  distinctions:{
   independentAudit:false,realProviderWritesUnderThisProgramme:0,
   simulatedExpiryNotStripePruning:true,downstreamCooperatingIdempotencyRequired:true
  }};
}
if(args[0]==="--seal"){
 const mapping={};
 for(let i=1;i<args.length;i+=2) mapping[args[i].replace(/^--/,"")]=args[i+1];
 const names=["output","matrix","webhook","concurrent","adversarial","stripe"];
 for(const name of names)if(!mapping[name])throw Error("Missing "+name);
 const out=path.resolve(mapping.output);
 if(fs.existsSync(out)||!out.includes("/.evidence/"))throw Error("Refuse overwrite or public evidence path");
 fs.mkdirSync(out,{recursive:true,mode:0o700});
 for(const suite of ["matrix","webhook","concurrent","adversarial"]){
  fs.cpSync(path.resolve(mapping[suite]),path.join(out,suite),{recursive:true,dereference:false});
 }
 fs.copyFileSync(path.resolve(mapping.stripe),path.join(out,"stripe-readonly.json"),fs.constants.COPYFILE_EXCL);
 const validation=inspect(out);
 const files=walk(out).sort().map(file=>{
  const relative=path.relative(out,file);
  return {path:relative,bytes:fs.statSync(file).size,sha256:SHA(file)};
 });
 const manifest={schema:1,createdAt:new Date().toISOString(),scope:"private reproducible engineering evidence",
  sourceCommit:"74a4521da15f4bec16e207e91323b426ef02b32d",
  datasetCounts:validation,files,hashAlgorithm:"sha256",
  disclaimer:"Self-issued digest manifest, no third-party signing or provider attestation"};
 fs.writeFileSync(path.join(out,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{flag:"wx",mode:0o600});
 console.log(JSON.stringify({sealed:true,output:out,fileCount:files.length,validated:validation},null,2));
}else if(args[0]==="--verify"){
 const dir=path.resolve(args[1]||"");
 const manifest=read(path.join(dir,"manifest.json"));
 assert.equal(manifest.schema,1);
 const actual=walk(dir).filter(file=>path.relative(dir,file)!=="manifest.json").map(file=>path.relative(dir,file)).sort();
 const listed=manifest.files.map(item=>item.path).sort();
 assert.deepEqual(actual,listed,"Unmanifested or missing evidence file");
 for(const item of manifest.files){
  if(!item.path||path.isAbsolute(item.path)||item.path.split(path.sep).includes(".."))throw Error("Unsafe manifest path");
  const file=path.join(dir,item.path);
  assert.equal(fs.statSync(file).size,item.bytes,"Evidence byte count mismatch: "+item.path);
  assert.equal(SHA(file),item.sha256,"Evidence digest mismatch: "+item.path);
 }
 const checked=inspect(dir);
 console.log(JSON.stringify({verified:true,files:listed.length,checks:checked,limitations:manifest.disclaimer},null,2));
}else throw Error("Use --seal or --verify");
