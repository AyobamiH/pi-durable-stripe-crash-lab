/**
 * Four recovery policies × ten fault cases × repeatable seeds.
 * This model gives each case independent controller/provider SQLite databases.
 * Its output contains known-bad policy results; "PASS" is the grader's ability
 * to detect them, never a blanket assertion that every policy is safe.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Provider, Controller, inspectIndependent, digest } from "./core.mjs";

export const policies = ["A-new-key", "B-stable-key", "C-authority-ledger", "D-hold"];
export const cases = [
  "clean",
  "committed-response-lost",
  "uncommitted-response-lost",
  "same-intent-new-attempt",
  "concurrent-recovery",
  "changed-payload",
  "cancel-before-retry",
  "inflight-commit-after-cancel",
  "readback-unavailable",
  "simulated-expired-provider-key"
];
export function runCell({ policy, fault, repetition, directory }) {
  if (!policies.includes(policy) || !cases.includes(fault)) throw Error("Invalid policy or fault");
  const stem=policy+"__"+fault+"__"+repetition;
  const dir=join(directory,stem);
  mkdirSync(dir,{recursive:false});
  const providerPath=join(dir,"provider.sqlite");
  const controllerPath=join(dir,"controller.sqlite");
  const provider=new Provider(providerPath,{retentionTicks:100});
  const control=new Controller(controllerPath);
  const intent="intent-"+stem;
  const originalPayload={amount:100,currency:"gbp",recipient:"synthetic-recipient"};
  const changed={...originalPayload,amount:200};
  const originalKey="key-"+intent;
  control.create(intent,originalPayload,originalKey,1);
  const observations=[];
  let dispatches=0,dispatchAfterRevocation=0,payloadConflict=0,lateCommits=0;
  let claim="unknown", outcome="held";
  let acceptedOriginal=false;
  function emit({key=originalKey,payload=originalPayload,label="retry",tick=2,epoch=1,enforce=false,exclusive=false}={}){
    const attempt=intent+"-"+label;
    const state=control.get(intent);
    const admitted=control.admit(intent,attempt,payload,epoch,{
      enforceAuthority:enforce,enforcePayload:enforce,exclusive
    });
    observations.push({kind:"admission",label,accepted:admitted.accepted,reason:admitted.reason,epoch});
    if(!admitted.accepted) return {status:"refused"};
    dispatches++;
    if(!state.authorised || state.authority_epoch!==epoch) dispatchAfterRevocation++;
    const result=provider.commit({intent,key,payload,attempt,tick,epoch});
    observations.push({kind:"provider",label,status:result.status,effectId:result.effectId});
    if(result.status==="conflict") payloadConflict++;
    return result;
  }
  // The original external action is already in flight or completed BEFORE recovery.
  if(["clean","committed-response-lost","same-intent-new-attempt","changed-payload","readback-unavailable","simulated-expired-provider-key"].includes(fault)){
    const result=provider.commit({intent,key:originalKey,payload:originalPayload,attempt:intent+"-original",tick:1,epoch:1});
    acceptedOriginal=true;
    observations.push({kind:"original",result:result.status,receiptVisible:fault==="clean"});
  }
  if(fault==="inflight-commit-after-cancel"){
    // Authorised dispatch occurred, but its provider commit is delayed.
    acceptedOriginal=true;
    observations.push({kind:"inflight",authorisedAtDispatch:true,committed:false});
  }
  if(["cancel-before-retry","inflight-commit-after-cancel"].includes(fault)) control.revoke(intent);
  if(fault==="inflight-commit-after-cancel"){
    const after=provider.commit({intent,key:originalKey,payload:originalPayload,attempt:intent+"-original",tick:2,epoch:1});
    observations.push({kind:"late-commit",result:after.status,dispatchAuthority:1,commitAfterRevocation:true});
    lateCommits++;
  }

  const active = control.get(intent);
  const stableKey=originalKey;
  const freshKey="fresh-"+intent;
  if(fault==="clean"){
    claim="confirmed"; outcome="initial-receipt";
  } else if(policy==="D-hold"){
    claim="unknown";outcome="held-unconditionally";
  } else if(policy==="C-authority-ledger"){
    if(fault==="changed-payload"){
      const rejected=control.admit(intent,intent+"-changed",changed,1,{
        enforceAuthority:true,enforcePayload:true,exclusive:true
      });
      if(rejected.accepted) throw Error("Payload mutation unexpectedly admitted");
      observations.push({kind:"denial",reason:rejected.reason});
      claim="denied";outcome="payload-conflict-blocked";
    } else if(!active.authorised){
      const rejected=control.admit(intent,intent+"-revoked",originalPayload,1,{
        enforceAuthority:true,enforcePayload:true,exclusive:true
      });
      if(rejected.accepted) throw Error("Revocation unexpectedly admitted");
      observations.push({kind:"denial",reason:rejected.reason});
      claim="denied";outcome="withdrawn-authority";
    } else if(fault==="readback-unavailable"){
      const lookup=provider.lookup(intent,{available:false});
      observations.push({kind:"readback",value:lookup.kind});
      claim="unknown";outcome="readback-unavailable-held";
    } else {
      const lookup=provider.lookup(intent);
      observations.push({kind:"readback",value:lookup.kind,effectCount:lookup.effects.length});
      if(lookup.kind==="present"){
        claim="confirmed";outcome="observed-provider-effect";
      } else if(fault==="uncommitted-response-lost" || fault==="concurrent-recovery"){
        // For case 3 the fixture proves that the first attempt cannot commit later.
        // For case 5 the admission layer serialises simultaneous workers.
        const r1=control.admit(intent,intent+"-worker-1",originalPayload,1,{
          enforceAuthority:true,enforcePayload:true,exclusive:true
        });
        const r2=fault==="concurrent-recovery"
          ?control.admit(intent,intent+"-worker-2",originalPayload,1,{
            enforceAuthority:true,enforcePayload:true,exclusive:true
          }):null;
        observations.push({kind:"admission",worker1:r1,worker2:r2,authoritativeAbsence:fault==="uncommitted-response-lost"});
        if(!r1.accepted || (r2 && r2.accepted))throw Error("Exclusive claim failed");
        dispatches++;
        const r=provider.commit({intent,key:originalKey,payload:originalPayload,attempt:intent+"-worker-1",tick:2,epoch:1});
        observations.push({kind:"provider",result:r.status,effectId:r.effectId});
        control.complete(intent);
        claim="confirmed";outcome="authorised-single-commit";
      } else {
        claim="unknown";outcome="absence-not-enough";
      }
    }
  } else {
    // Deliberately weaker policies retain their shortcomings for the grader.
    const payload=fault==="changed-payload"?changed:originalPayload;
    const key=policy==="A-new-key"?freshKey:stableKey;
    if(fault==="concurrent-recovery"){
      const k1=key+"-1",k2=policy==="A-new-key"?key+"-2":key;
      const a1=control.admit(intent,intent+"-w1",payload,1,{enforceAuthority:false,enforcePayload:false,exclusive:false});
      const a2=control.admit(intent,intent+"-w2",payload,1,{enforceAuthority:false,enforcePayload:false,exclusive:false});
      if(!a1.accepted||!a2.accepted)throw Error("Weak baseline admission unexpected");
      dispatches+=2;
      const r1=provider.commit({intent,key:policy==="A-new-key"?k1:key,payload,attempt:intent+"-w1",tick:2,epoch:1});
      const r2=provider.commit({intent,key:policy==="A-new-key"?k2:key,payload,attempt:intent+"-w2",tick:2,epoch:1});
      observations.push({kind:"concurrent-recovery",admissions:2,results:[r1.status,r2.status]});
      claim="confirmed";outcome="both-attempts-submitted";
    }else{
      const tick=fault==="simulated-expired-provider-key"?102:3;
      const r=emit({key,payload,label:"recovery",tick,enforce:false,exclusive:false});
      claim=r.status==="committed"||r.status==="deduplicated"?"confirmed":"unknown";
      outcome=r.status;
    }
  }
  control.claim(intent,claim);
  const independent=inspectIndependent(providerPath,intent);
  const newPayloadEffects=independent.filter(row=>row.payload_digest!==digest(originalPayload)).length;
  const duplicates=Math.max(0,independent.length-1);
  const lateEffect=fault==="inflight-commit-after-cancel" ? lateCommits : 0;
  const falseClaim=(claim==="confirmed"&&independent.length===0)||(claim==="absent"&&independent.length!==0);
  const safety=duplicates===0&&dispatchAfterRevocation===0&&newPayloadEffects===0&&!falseClaim;
  const noEffectYet=independent.length===0;
  const authorisedProgress=claim==="confirmed"&&independent.length===1&&dispatchAfterRevocation===0&&newPayloadEffects===0;
  const unnecessarilyHeld=policy==="D-hold"&&fault==="uncommitted-response-lost"&&noEffectYet;
  const result={
    policy,fault,repetition,environment:"isolated SQLite synthetic provider, NOT Stripe",
    providerDeduplicationExpiry:"simulated-only",
    assumedProviderCooperation:true,
    operationId:intent,
    claim,decision:outcome,
    observations,
    externalEffects:independent.map(e=>({seq:e.seq,attempt:e.attempt,providerKey:e.provider_key,payloadDigest:e.payload_digest,authorityEpoch:e.observed_authority_epoch})),
    scores:{
      effectCount:independent.length,duplicates,newPayloadEffects,
      dispatchesAfterRevocation:dispatchAfterRevocation,
      lateCommitsAfterRevocation:lateEffect,
      providerPayloadConflicts:payloadConflict,
      newlyDispatchedAttempts:dispatches,
      falseClaim,safety,authorisedProgress,unnecessaryHold:unnecessarilyHeld,
      unresolvedClaim:claim==="unknown"
    },
    falsificationMarkers:{
      claimedExactlyOnce:false,
      providerKeyExpiryActuallyObserved:false,
      thirdPartyValidated:false
    }
  };
  writeFileSync(join(dir,"result.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});
  control.close();provider.close();
  return result;
}
