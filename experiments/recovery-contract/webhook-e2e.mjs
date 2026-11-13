#!/usr/bin/env node
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { invokeChild, assertChildOutcome } from "./subprocess-receipt.mjs";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join,resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sign } from "./webhook-core.mjs";

const args=process.argv.slice(2);
if(args[0]!=="--output"||!args[1])throw Error("Use --output with unique private path");
const root=resolve(args[1]);
if(existsSync(root)||!root.includes("/.evidence/"))throw Error("Evidence path must be new and private");
mkdirSync(root,{recursive:true,mode:0o700});
const kinds=["control","crash-before-effect","crash-after-effect","bad-signature","conflicting-payload"];
const records=[];
for(const kind of kinds){
  for(let rep=1;rep<=3;rep++){
    const dir=join(root,kind+"-"+rep);mkdirSync(dir,{mode:0o700});
    const eventId="evt-"+kind.replace(/[^a-z-]/g,"")+"-"+rep;
    const data={eventId,payload:{tenant:"synthetic-only",action:"fulfil",cost:0,rep}};
    data.signature=sign(data);
    const input=join(dir,"event.json");
    writeFileSync(input,JSON.stringify(data,null,2)+"\n",{mode:0o600,flag:"wx"});
    const modes={control:"normal","crash-before-effect":"kill-before-effect","crash-after-effect":"kill-after-effect","bad-signature":"normal","conflicting-payload":"normal"};
    const logs=[];
    function child(mode,file=input){
      const receipt=invokeChild(
        process.execPath,[new URL("./webhook-worker.mjs",import.meta.url).pathname,dir,file,mode]
      );
      logs.push(receipt);
      // Persist before asserting the child result, including ETIMEDOUT or
      // another signal, so a failed CI run preserves a precise diagnosis.
      appendFileSync(join(dir,"child-outcomes.jsonl"),JSON.stringify({
        sequence:logs.length,mode,input:mode==="normal" ? "delivery" : "fault",
        ...receipt,
      })+"\n",{mode:0o600});
      return receipt;
    }
    let started;
    if(kind==="bad-signature"){
      const bad={...data,signature:"0".repeat(64)};
      const badFile=join(dir,"tampered.json");
      writeFileSync(badFile,JSON.stringify(bad),{mode:0o600});
      started=child("normal",badFile);
      assertChildOutcome(started,2,kind+" initial invalid-signature");
    }else{
      started=child(modes[kind]);
      if(kind.startsWith("crash")){
        assert.equal(started.error,null,"Injected SIGKILL must not be a timed-out process");
        assert.equal(started.timedOut,false);
        assert.equal(started.signal,"SIGKILL","Fault injector must really kill the subprocess");
      } else assertChildOutcome(started,0,kind+" initial delivery");
    }
    function independent(){
      const inboxPath=join(dir,"inbox.sqlite"),receiverPath=join(dir,"downstream.sqlite");
      let inbox=null,effects=0,attempts=0;
      if(existsSync(inboxPath)){
        const db=new DatabaseSync(inboxPath,{readOnly:true});
        inbox=db.prepare("SELECT * FROM inbox WHERE event_id=?").get(eventId)??null;db.close();
      }
      if(existsSync(receiverPath)){
        const db=new DatabaseSync(receiverPath,{readOnly:true});
        effects=db.prepare("SELECT COUNT(*) AS n FROM effects WHERE event_id=?").get(eventId).n;
        attempts=db.prepare("SELECT COUNT(*) AS n FROM calls WHERE event_id=?").get(eventId).n;
        db.close();
      }
      return {inboxState:inbox?.state??null,deliveries:inbox?.deliveries??0,receiverEffects:effects,receiverRequests:attempts};
    }
    const during=independent();
    if(kind==="crash-before-effect"){
      assert.equal(during.inboxState,"pending");assert.equal(during.receiverEffects,0);
    }
    if(kind==="crash-after-effect"){
      assert.equal(during.inboxState,"pending");assert.equal(during.receiverEffects,1);
    }
    if(kind==="bad-signature"){
      assert.equal(during.inboxState,null);assert.equal(during.receiverEffects,0);
    }
    if(kind==="conflicting-payload"){
      const conflict={...data,payload:{...data.payload,cost:999}};
      conflict.signature=sign(conflict);
      const alternate=join(dir,"conflict.json");
      writeFileSync(alternate,JSON.stringify(conflict),{mode:0o600});
      const rejected=child("normal",alternate);
      assertChildOutcome(rejected,2,kind+" conflicting-payload rejected");
      assert.equal(independent().receiverEffects,1);
    }
    // Recover from the crash via a brand-new worker process. This is a
    // real OS SIGKILL + restart, not just a control-flow exception.
    const completed=child("normal");
    assertChildOutcome(completed,0,kind+" recovery");
    const duplicated=child("normal");
    assertChildOutcome(duplicated,0,kind+" duplicate delivery");
    const after=independent();
    assert.equal(after.inboxState,"acked");
    assert.equal(after.receiverEffects,1,"Exactly one measurable downstream effect with cooperating unique receiver");
    assert.ok(after.deliveries>=2);
    assert.ok(after.receiverRequests>=1);
    const result={kind,rep,eventId,first:started,during,after,recovery:completed,duplicateDelivery:duplicated,
      children:logs,
      scope:"isolated OS processes and separate SQLite ledgers",realExternalFulfilment:false,providerCooperationRequired:true};
    writeFileSync(join(dir,"result.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
    records.push(result);
  }
}
const summary={passed:true,scope:"real SIGKILL subprocess / SQLite-only downstream receiver",cases:records.length,
 eachCategory:3,crashAfterCommitEvidence:records.filter(r=>r.kind==="crash-after-effect").every(r=>r.first.signal==="SIGKILL"&&r.during.receiverEffects===1&&r.after.receiverEffects===1),
 crashBeforeCommitEvidence:records.filter(r=>r.kind==="crash-before-effect").every(r=>r.first.signal==="SIGKILL"&&r.during.receiverEffects===0&&r.after.receiverEffects===1),
 measurableDownstreamEffects:records.reduce((n,r)=>n+r.after.receiverEffects,0),
 duplicateDeliveriesDedupe:records.every(r=>r.after.receiverEffects===1),
 badSignaturesRejected:records.filter(r=>r.kind==="bad-signature").every(r=>r.first.status===2),
 conflictingPayloadsRejected:records.filter(r=>r.kind==="conflicting-payload").every(r=>r.during.receiverEffects===1),
 constraints:["Receiver cooperates via UNIQUE(event_id), not an arbitrary social-provider side effect",
              "Crash after receiver commit but before local acknowledgement handled by duplicate id",
              "No Stripe webhook, no external provider deliveries and no actual fulfilment of a customer task"]};
writeFileSync(join(root,"summary.json"),JSON.stringify(summary,null,2)+"\n",{mode:0o600,flag:"wx"});
console.log(JSON.stringify({summary,evidence:root},null,2));
