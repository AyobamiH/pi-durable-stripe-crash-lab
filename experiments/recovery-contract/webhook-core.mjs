/**
 * Two separately committed durable SQLite ledgers:
 * inbox tracks delivery/ack; receiver records measurable downstream effects.
 * Exactly-once downstream effects REQUIRE this receiver's unique event identity.
 * The inbox and receiver are NOT one distributed transaction.
 */
import { DatabaseSync } from "node:sqlite";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const hash = payload => createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const message = event => JSON.stringify({eventId:event.eventId,payload:event.payload});
export const syntheticSigningKey="public-test-only-not-for-production";
export const sign = event => createHmac("sha256",syntheticSigningKey).update(message(event)).digest("hex");
export function verifySignedEvent(event) {
  if(!/^evt-[a-z0-9-]+$/.test(event?.eventId??""))throw Error("invalid_event_id");
  if(!event.payload||typeof event.payload!=="object")throw Error("invalid_payload");
  if(typeof event.signature!=="string"||! /^[a-f0-9]{64}$/.test(event.signature))throw Error("invalid_signature");
  const a=Buffer.from(event.signature,"hex"),b=Buffer.from(sign(event),"hex");
  if(!timingSafeEqual(a,b))throw Error("invalid_signature");
  return hash(event.payload);
}
function database(file) {
  mkdirSync(dirname(file),{recursive:true});
  const db=new DatabaseSync(file,{timeout:5000});
  db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
  return db;
}
export class Inbox {
  constructor(file) {
    this.db=database(file);
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS inbox(event_id TEXT PRIMARY KEY,payload_digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('pending','acked')),deliveries INTEGER NOT NULL);",
      "CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,action TEXT NOT NULL);"
    ].join("\n"));
  }
  receive(event) {
    const payloadDigest=verifySignedEvent(event);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior=this.db.prepare("SELECT * FROM inbox WHERE event_id=?").get(event.eventId);
      if(prior && prior.payload_digest!==payloadDigest)throw Error("conflicting_payload");
      if(prior)this.db.prepare("UPDATE inbox SET deliveries=deliveries+1 WHERE event_id=?").run(event.eventId);
      else this.db.prepare("INSERT INTO inbox(event_id,payload_digest,state,deliveries) VALUES(?,?,'pending',1)").run(event.eventId,payloadDigest);
      this.db.prepare("INSERT INTO audit(event_id,action) VALUES(?,?)").run(event.eventId,prior?"redelivery":"original_delivery");
      this.db.exec("COMMIT");
      return {prior:!!prior,state:prior?.state??"pending",payloadDigest};
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }
  ack(eventId) {
    this.db.prepare("UPDATE inbox SET state='acked' WHERE event_id=? AND state='pending'").run(eventId);
    this.db.prepare("INSERT INTO audit(event_id,action) VALUES(?,?)").run(eventId,"acknowledged");
  }
  get(eventId){return this.db.prepare("SELECT * FROM inbox WHERE event_id=?").get(eventId);}
  close(){this.db.close();}
}
export class Downstream {
  constructor(file) {
    this.db=database(file);
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS effects (seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL UNIQUE,payload_digest TEXT NOT NULL,committed_at TEXT NOT NULL);",
      "CREATE TABLE IF NOT EXISTS calls (seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,result TEXT NOT NULL);"
    ].join("\n"));
  }
  apply(eventId,payloadDigest){
    this.db.exec("BEGIN IMMEDIATE");
    try{
      const prior=this.db.prepare("SELECT * FROM effects WHERE event_id=?").get(eventId);
      if(prior&&prior.payload_digest!==payloadDigest)throw Error("downstream_conflicting_payload");
      if(!prior)this.db.prepare("INSERT INTO effects(event_id,payload_digest,committed_at) VALUES(?,?,?)").run(eventId,payloadDigest,new Date().toISOString());
      this.db.prepare("INSERT INTO calls(event_id,result) VALUES(?,?)").run(eventId,prior?"deduplicated":"applied");
      this.db.exec("COMMIT");
      return {newEffect:!prior,acknowledged:true};
    }catch(e){this.db.exec("ROLLBACK");throw e;}
  }
  get(eventId){
    const effect=this.db.prepare("SELECT * FROM effects WHERE event_id=?").get(eventId);
    const attempts=this.db.prepare("SELECT COUNT(*) AS n FROM calls WHERE event_id=?").get(eventId).n;
    const effects=this.db.prepare("SELECT COUNT(*) AS n FROM effects WHERE event_id=?").get(eventId).n;
    return {effect,attempts,effects};
  }
  close(){this.db.close();}
}
