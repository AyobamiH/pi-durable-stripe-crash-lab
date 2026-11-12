#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { Inbox, Downstream } from "./webhook-core.mjs";
const [directory,eventFile,mode="normal"]=process.argv.slice(2);
if(!directory||!eventFile||!["normal","kill-before-effect","kill-after-effect"].includes(mode))throw Error("Invalid worker arguments");
const event=JSON.parse(fs.readFileSync(eventFile,"utf8"));
const inbox=new Inbox(path.join(directory,"inbox.sqlite"));
const downstream=new Downstream(path.join(directory,"downstream.sqlite"));
let current;
try {
  current=inbox.receive(event);
  process.stdout.write(JSON.stringify({stage:"inbox-committed",prior:current.prior,state:current.state})+"\n");
  if(mode==="kill-before-effect")process.kill(process.pid,"SIGKILL");
  const downstreamResult=downstream.apply(event.eventId,current.payloadDigest);
  process.stdout.write(JSON.stringify({stage:"downstream-committed",newEffect:downstreamResult.newEffect})+"\n");
  if(mode==="kill-after-effect")process.kill(process.pid,"SIGKILL");
  inbox.ack(event.eventId);
  process.stdout.write(JSON.stringify({stage:"acknowledged",ok:true})+"\n");
}catch(error){
  process.stderr.write(JSON.stringify({stage:"rejected",reason:error.message})+"\n");
  process.exitCode=2;
}finally {
  // SIGKILL bypasses this, forcing recovery to read the persisted databases.
  downstream.close();inbox.close();
}
