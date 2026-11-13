#!/usr/bin/env node
// One-shot Cloudflare-hosted lifecycle client. Polls WITNESS only until
// automatic completion; cannot wake the Pi probe during the alarm interval.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const mode=process.argv[2];
if(!["preflight","execute"].includes(mode))throw Error("Use preflight or execute");
const dir=process.env.PI14_PRIVATE_RUN_DIR;
if(!dir || !/^\/home\/johnh\/\.local\/state\/pi14-lifecycle-run-20261113-[a-f0-9]{8}$/.test(dir))
  throw Error("Invalid owner-private run directory");
const stat=fs.statSync(dir);
if(stat.uid!==process.getuid() || (stat.mode & 0o777)!==0o700)throw Error("Private directory mode/owner invalid");
const m=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"),"utf8"));
const conf=JSON.parse(fs.readFileSync(path.join(dir,"wrangler.jsonc"),"utf8"));
const tokenFile=path.join(dir,"control-token");
const tokenStat=fs.statSync(tokenFile);
if((tokenStat.mode&0o777)!==0o600 || tokenStat.uid!==process.getuid())throw Error("Control token not protected");
const token=fs.readFileSync(tokenFile,"utf8").trim();
if(!/^[a-f0-9]{64}$/.test(token))throw Error("Bad private token");
assert.equal(conf.name,m.workerName);
assert.deepEqual(JSON.parse(conf.vars.LAB_ALLOWED_IDS),m.operationIds);
assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(dir,"worker.js"))).digest("hex"),m.workerSha256);
const base="https://"+m.workerName+".woeinvests.workers.dev";
const headers={"authorization":"Bearer "+token};
const read=async (route,id,authenticated=true) => {
  const r=await fetch(base+route+"?id="+encodeURIComponent(id),{
    headers:authenticated?headers:{},redirect:"error",signal:AbortSignal.timeout(12000)});
  const json=await r.json().catch(()=>null);
  return {http:r.status,data:json};
};
const send=async(route,id) => {
  const r=await fetch(base+route+"?id="+encodeURIComponent(id),{
    method:"POST",headers,redirect:"error",signal:AbortSignal.timeout(18000)});
  return {http:r.status,data:await r.json().catch(()=>null)};
};
const archive=(name,data) => fs.writeFileSync(path.join(dir,name),JSON.stringify(data,null,2)+"\n",{mode:0o600,flag:"wx"});
const persist=(name,data) => archive(name,{at:new Date().toISOString(),...data});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const getWitness=async id=>{
  const r=await read("/witness",id);
  assert.equal(r.http,200,"Witness GET failed");
  return r.data;
};
async function preflight(){
  const auth=await read("/witness",m.operationIds[0],false);
  assert.equal(auth.http,401,"Anonymous witness access must fail");
  const wrong=await read("/witness","probe-lifecycle-deadbeef-auto");
  assert.equal(wrong.http,403,"Unadmitted operation must be rejected");
  const blocked=await read("/status",m.operationIds[0]);
  assert.equal(blocked.http,425,"Cannot externally wake the automatic probe before completion");
  for(const id of m.operationIds){
    const state=await getWitness(id);
    assert.equal(state.reserved,false);
    assert.deepEqual(state.events,[]);
  }
  const result={pass:true,anonymousHttp:auth.http,outOfScopeHttp:wrong.http,
    prematureProbeHttp:blocked.http,operationCount:m.operationIds.length,
    sourceSha256:m.workerSha256,worker:m.workerName};
  persist("preflight.json",result);
  console.log(JSON.stringify(result));
}
async function auto(){
  const id=m.operationIds[0];
  archive("auto-start-reservation.json",{id,at:new Date().toISOString(),maxStarts:1});
  const started=await send("/start",id);
  persist("auto-start-response.json",started);
  assert.equal(started.http,200,"Automatic operation did not start; no blind retry");
  assert.equal(started.data?.accepted,true);
  const deadline=Date.now()+105000;
  const poll=[];
  let last;
  while(Date.now()<deadline){
    last=await getWitness(id);
    const events=last.events??[];
    poll.push({at:new Date().toISOString(),events:events.length,
      kinds:events.map(e=>e.kind)});
    if(events.some(e=>e.kind==="tool_completed"))break;
    await sleep(1700);
  }
  persist("auto-witness-poll.json",{poll});
  persist("auto-witness-final.json",last||{});
  const entries=(last?.events??[]).filter(e=>e.kind==="tool_entry");
  assert.equal(entries.length,2,"Expected exactly two tool entries across a natural automatic wake");
  assert.notEqual(entries[0].instance,entries[1].instance,"Must be a new DO instance");
  assert.equal(last.events.filter(e=>e.kind==="auto_crash_planned").length,1);
  assert.equal(last.events.filter(e=>e.kind==="tool_completed").length,1);
  const deltaMs=new Date(entries[1].at)-new Date(entries[0].at);
  assert.ok(deltaMs>=2000,"Witness did not establish asynchronous alarm-delayed recovery");
  // This is the first Probe GET issued since /start. The witness observed
  // completion first; the public Worker also returned HTTP 425 before it.
  const status=await read("/status",id);
  const result=await read("/result",id);
  persist("auto-probe-final.json",{status,result,witnessEntries:entries,deltaMs});
  assert.equal(status.http,200);
  assert.equal(status.data?.completed,true);
  assert.deepEqual(status.data?.pending,[]);
  assert.equal(result.http,200);
  assert.equal(result.data?.settled,true);
  assert.equal(result.data?.value?.status,"done");
  console.log(JSON.stringify({auto:"PASS",entryCount:entries.length,
    newInstance:true,alarmDelayMs:deltaMs,terminalStatus:result.data.value.status,
    externalProbeGetsBeforeWitnessCompletion:0}));
}
async function abort(){
  const id=m.operationIds[1];
  archive("abort-start-reservation.json",{id,at:new Date().toISOString(),maxStarts:1});
  const started=await send("/start",id);
  persist("abort-start-response.json",started);
  assert.equal(started.http,200);
  assert.equal(started.data?.accepted,true);
  let observed;
  for(let i=0;i<12;i++){
    observed=await getWitness(id);
    if(observed.events.some(e=>e.kind==="tool_entry"))break;
    await sleep(500);
  }
  persist("abort-witness-entry.json",observed);
  assert.equal(observed.events.filter(e=>e.kind==="tool_entry").length,1);
  archive("abort-request-reservation.json",{id,at:new Date().toISOString(),maxAbortRequests:1});
  let command;
  try {command=await send("/abort",id);}
  catch(error){command={http:null,errorClass:error?.cause?.code??error?.name??"unknown"};}
  persist("abort-command-response.json",command);
  // Never retry an unknown abort. Read the independent witness and probe.
  let state,probe;
  for(let i=0;i<12;i++){
    state=await getWitness(id);
    probe=await read("/status",id);
    if(state.events.some(e=>e.kind==="abort_returned") &&
      probe.http===200 && (probe.data?.pending??[]).length===0) break;
    await sleep(750);
  }
  const terminal=await read("/result",id);
  persist("abort-final-readback.json",{witness:state,probe,terminal});
  if(command.http!==200 || command.data?.aborted!==true ||
    !state.events.some(e=>e.kind==="abort_returned") ||
    probe.http!==200 || probe.data?.pending?.length!==0 ||
    terminal.http!==200 || terminal.data?.settled!==true)
    throw Error("Abort outcome NOT verified; preserved evidence, no retry");
  assert.equal(state.events.filter(e=>e.kind==="tool_completed").length,0);
  console.log(JSON.stringify({abort:"PASS",aborted:true,
    pending:probe.data.pending,terminal:terminal.data.value?.status,
    externalProviderEffects:0}));
}
if(mode==="preflight") await preflight();
else {
  if(!fs.existsSync(path.join(dir,"preflight.json")))throw Error("Preflight missing; cannot start");
  await auto();
  await abort();
}
