import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const script = fileURLToPath(new URL("./gateway.mjs", import.meta.url));
const BASE = "http://127.0.0.1:18962";
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function start(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-stripe-gw-test-"));
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      STRIPE_TEST_SECRET_KEY: "",
      GATEWAY_MODE: "fixture",
      LAB_EVIDENCE_DIR: dir,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (d) => { output += String(d); });
  child.stderr.on("data", (d) => { output += String(d); });
  return {
    child, dir,
    output: () => output,
    async ready() {
      for (let n = 0; n < 100; n++) {
        if (child.exitCode !== null) throw new Error("Gateway exited: " + output);
        try {
          const r = await fetch(BASE + "/health", { signal: AbortSignal.timeout(200) });
          if (r.ok) return;
        } catch {}
        await sleep(40);
      }
      throw new Error("Gateway readiness timeout: " + output);
    },
    async close() {
      if (child.exitCode === null) {
        child.kill("SIGTERM");
        await Promise.race([
          new Promise((resolve) => child.once("exit", resolve)),
          sleep(1000)
        ]);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("never boots in stripe-test without an sk_test key", async () => {
  const gw = await start({ GATEWAY_MODE: "stripe-test", STRIPE_TEST_SECRET_KEY: "" });
  try {
    const exit = await Promise.race([
      new Promise((r) => gw.child.once("exit", (c) => r(c))),
      sleep(2000).then(() => "timeout")
    ]);
    assert.notEqual(exit, "timeout");
    assert.notEqual(exit, 0);
    assert.match(gw.output(), /requires a verified sk_test_/);
  } finally { await gw.close(); }
});

test("rejects live Stripe secrets in both modes", async () => {
  for (const mode of ["fixture", "stripe-test"]) {
    const gw = await start({ GATEWAY_MODE: mode, STRIPE_TEST_SECRET_KEY: "sk_live_never_use" });
    try {
      const exit = await Promise.race([
        new Promise((r) => gw.child.once("exit", (c) => r(c))),
        sleep(2000).then(() => "timeout")
      ]);
      assert.notEqual(exit, "timeout");
      assert.notEqual(exit, 0);
      assert.match(gw.output(), /SAFETY GATE/);
    } finally { await gw.close(); }
  }
});

test("fixture gateway keeps one external success under two submissions, rejects invalid amount", async () => {
  const gw = await start();
  try {
    await gw.ready();
    const req = { operationId: "lab-unit-test-001", amount: 100, currency: "gbp" };
    const payment = () => fetch(BASE + "/payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req)
    });
    const first = await (await payment()).json();
    const second = await (await payment()).json();
    assert.match(first.id, /^fixture_pi_/);
    assert.equal(first.id, second.id);
    assert.equal(first.status, "succeeded");
    assert.equal(first.livemode, false);
    const state = await (await fetch(BASE + "/state")).json();
    assert.equal(state.gatewayRequests, 2);
    assert.equal(state.stripeCreateRequests, 0);
    assert.equal(Object.keys(state.accepted).length, 1);
    const invalid = await fetch(BASE + "/payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...req, amount: 200 })
    });
    assert.equal(invalid.status, 400);
    const verify = await (await fetch(BASE + "/verify?operationId=" + req.operationId)).json();
    assert.equal(verify.verified, false);
    assert.equal(verify.reason, "fixture_only");
  } finally { await gw.close(); }
});
