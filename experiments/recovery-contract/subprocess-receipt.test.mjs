import { test } from "node:test";
import assert from "node:assert/strict";
import { invokeChild, assertChildOutcome, DEFAULT_TIMEOUT_MS } from "./subprocess-receipt.mjs";

test("ordinary success contains a real zero exit code", () => {
  const p=invokeChild(process.execPath,["-e","process.stdout.write('OK')"],{timeoutMs:3000});
  assert.equal(p.status,0);
  assert.equal(p.signal,null);
  assert.equal(p.error,null);
  assert.equal(p.timedOut,false);
  assert.equal(p.stdout,"OK");
  assertChildOutcome(p,0,"successful mock");
});
test("an injected SIGKILL is distinguishable from timeout", () => {
  const p=invokeChild(process.execPath,["-e","process.kill(process.pid,'SIGKILL')"],{timeoutMs:3000});
  assert.equal(p.status,null);
  assert.equal(p.signal,"SIGKILL");
  assert.equal(p.error,null);
  assert.equal(p.timedOut,false);
  assert.throws(()=>assertChildOutcome(p,0,"deliberately killed"),/lifecycle unexpected/);
});
test("a timed-out process fails explicitly with ETIMEDOUT and never appears successful", () => {
  const p=invokeChild(process.execPath,["-e","setInterval(()=>{},100)"],{timeoutMs:180});
  assert.equal(p.status,null);
  assert.equal(p.timedOut,true);
  assert.equal(p.error?.code,"ETIMEDOUT");
  assert.ok(p.durationMs>=140);
  assert.throws(()=>assertChildOutcome(p,0,"timed-out delivery"),/ETIMEDOUT/);
});
test("a child that returns nonzero is not silently accepted", () => {
  const p=invokeChild(process.execPath,["-e","process.exit(7)"],{timeoutMs:3000});
  assert.equal(p.status,7);
  assert.equal(p.error,null);
  assert.equal(p.timedOut,false);
  assert.throws(()=>assertChildOutcome(p,0,"bad exit"),/lifecycle unexpected/);
});
test("timeout bounds refuse an unbounded child", () => {
  assert.equal(DEFAULT_TIMEOUT_MS,60000);
  assert.throws(()=>invokeChild(process.execPath,["-e","0"],{timeoutMs:0}),/Invalid bounded child timeout/);
  assert.throws(()=>invokeChild(process.execPath,["-e","0"],{timeoutMs:120001}),/Invalid bounded child timeout/);
});
