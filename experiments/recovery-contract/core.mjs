/**
 * Deterministic provider-backed simulation of recovery contracts.
 * Provider and controller use separate durable SQLite files.
 * Synthetic time is not real Stripe key-retention evidence.
 * No external API, money, or model inference.
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function openDB(location) {
  mkdirSync(dirname(location), { recursive: true });
  const db = new DatabaseSync(location, { timeout: 5000 });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;");
  return db;
}
export function readDB(location) {
  return new DatabaseSync(location, { readOnly: true });
}
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const value = fn(); db.exec("COMMIT"); return value; }
  catch (error) { db.exec("ROLLBACK"); throw error; }
}
export class Provider {
  constructor(location, { retentionTicks = 100 } = {}) {
    this.location = location;
    this.db = openDB(location);
    this.retentionTicks = retentionTicks;
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS effects (seq INTEGER PRIMARY KEY AUTOINCREMENT,intent TEXT NOT NULL,provider_key TEXT NOT NULL,payload_digest TEXT NOT NULL,attempt TEXT NOT NULL,dispatched_tick INTEGER NOT NULL,committed_tick INTEGER NOT NULL,observed_authority_epoch INTEGER NOT NULL);",
      "CREATE TABLE IF NOT EXISTS key_cache (provider_key TEXT PRIMARY KEY,effect_seq INTEGER NOT NULL,payload_digest TEXT NOT NULL,stored_tick INTEGER NOT NULL);",
      "CREATE INDEX IF NOT EXISTS effects_by_intent ON effects(intent);"
    ].join("\n"));
  }
  commit({ intent, key, payload, attempt, tick, epoch = 1 }) {
    if (!intent || !key || !attempt || !Number.isInteger(tick)) throw Error("Invalid simulated provider operation");
    const payloadDigest = digest(payload);
    return transaction(this.db, () => {
      const saved = this.db.prepare("SELECT * FROM key_cache WHERE provider_key=?").get(key);
      if (saved && tick - saved.stored_tick < this.retentionTicks) {
        if (saved.payload_digest !== payloadDigest) return { status: "conflict", effectId: null, duplicateKey: true };
        return { status: "deduplicated", effectId: saved.effect_seq, duplicateKey: true };
      }
      // Deliberately simulated expiry: NOT an observed Stripe pruning event.
      if (saved) this.db.prepare("DELETE FROM key_cache WHERE provider_key=?").run(key);
      const inserted = this.db.prepare(
        "INSERT INTO effects(intent,provider_key,payload_digest,attempt,dispatched_tick,committed_tick,observed_authority_epoch) VALUES(?,?,?,?,?,?,?)"
      ).run(intent,key,payloadDigest,attempt,tick,tick,epoch);
      const seq = Number(inserted.lastInsertRowid);
      this.db.prepare("INSERT INTO key_cache(provider_key,effect_seq,payload_digest,stored_tick) VALUES(?,?,?,?)")
        .run(key,seq,payloadDigest,tick);
      return { status: "committed", effectId: seq, duplicateKey: false };
    });
  }
  lookup(intent, { allowed = true, available = true } = {}) {
    if (!allowed || !available) return { kind: "unknown", authorised: allowed, available };
    const effects = this.db.prepare("SELECT * FROM effects WHERE intent=? ORDER BY seq").all(intent);
    return { kind: effects.length ? "present" : "absent", effects };
  }
  close() { this.db.close(); }
}
export class Controller {
  constructor(location) {
    this.location = location;
    this.db = openDB(location);
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS intents (intent TEXT PRIMARY KEY,frozen_payload_digest TEXT NOT NULL,provider_key TEXT NOT NULL,authority_epoch INTEGER NOT NULL,authorised INTEGER NOT NULL,inflight INTEGER NOT NULL DEFAULT 0,last_claim TEXT NOT NULL DEFAULT 'unknown');",
      "CREATE TABLE IF NOT EXISTS attempts (attempt TEXT PRIMARY KEY,intent TEXT NOT NULL,authority_epoch INTEGER NOT NULL,accepted INTEGER NOT NULL,reason TEXT NOT NULL);",
      "CREATE INDEX IF NOT EXISTS attempts_by_intent ON attempts(intent);"
    ].join("\n"));
  }
  create(intent,payload,key,epoch=1) {
    this.db.prepare("INSERT INTO intents(intent,frozen_payload_digest,provider_key,authority_epoch,authorised) VALUES(?,?,?,?,1)")
      .run(intent,digest(payload),key,epoch);
  }
  revoke(intent) { this.db.prepare("UPDATE intents SET authorised=0,authority_epoch=authority_epoch+1 WHERE intent=?").run(intent); }
  claim(intent,value) {
    if (!["confirmed","absent","unknown","denied"].includes(value)) throw Error("Unproved claim vocabulary");
    this.db.prepare("UPDATE intents SET last_claim=? WHERE intent=?").run(value,intent);
  }
  get(intent) { return this.db.prepare("SELECT * FROM intents WHERE intent=?").get(intent); }
  admit(intent,attempt,payload,epoch,{enforceAuthority=true,enforcePayload=true,exclusive=true}={}) {
    return transaction(this.db,()=>{
      const state=this.get(intent);
      if (!state) throw Error("Intent not registered");
      let reason="accepted";
      if (enforcePayload && state.frozen_payload_digest !== digest(payload)) reason="payload_mismatch";
      else if (enforceAuthority && (!state.authorised || state.authority_epoch !== epoch)) reason="authority_denied";
      else if (exclusive && state.inflight) reason="existing_inflight";
      const accepted=reason==="accepted";
      this.db.prepare("INSERT INTO attempts(attempt,intent,authority_epoch,accepted,reason) VALUES(?,?,?,?,?)")
        .run(attempt,intent,epoch,accepted?1:0,reason);
      if (accepted && exclusive) this.db.prepare("UPDATE intents SET inflight=1 WHERE intent=?").run(intent);
      return { accepted, reason };
    });
  }
  complete(intent) { this.db.prepare("UPDATE intents SET inflight=0 WHERE intent=?").run(intent); }
  close(){this.db.close();}
}
export function inspectIndependent(location, intent) {
  const db=readDB(location);
  const rows=db.prepare("SELECT seq,intent,provider_key,payload_digest,attempt,dispatched_tick,committed_tick,observed_authority_epoch FROM effects WHERE intent=? ORDER BY seq").all(intent);
  db.close();
  return rows;
}
