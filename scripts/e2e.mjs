/**
 * Real PiHarness crash/recovery across a separate external payment boundary.
 * MODE=fixture (default) is offline. MODE=stripe-test requires sk_test_ secret
 * and confirms actual Stripe test payment by independent provider readback.
 *
 * No existing Post-Once or Tail Wagging runtime is restarted or touched.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { environmentForChild } from "./process-env.mjs";
import { assertMatchingReceipt, assertReadback } from "./acceptance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.env.GATEWAY_MODE ?? "fixture";
const scenario = process.env.LAB_SCENARIO ?? "after-provider";
if (!["after-provider", "before-provider"].includes(scenario) || (scenario === "before-provider" && mode !== "fixture")) throw new Error("Invalid scenario or unsafe configuration");
if (mode !== "fixture" && mode !== "stripe-test") throw new Error("Invalid test mode");
if (mode === "stripe-test" && !process.env.STRIPE_TEST_KEY_FILE && !process.env.STRIPE_TEST_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("A real Stripe test requires STRIPE_TEST_SECRET_KEY=sk_test_...");
}
if (process.env.STRIPE_TEST_SECRET_KEY?.startsWith("sk_live_")) {
  throw new Error("STRICT SAFETY GATE: live Stripe secret not permitted");
}
const id = process.env.LAB_OPERATION_ID ?? ("lab-" + crypto.randomBytes(7).toString("hex"));
if (!/^lab-[a-z0-9-]{1,70}$/.test(id)) throw new Error("Invalid run ID");
const runDir = path.join(ROOT, ".evidence", "runs", id);
fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
const gatewayBase = "http://127.0.0.1:18962";
const workerBase = "http://127.0.0.1:18961";
const stateUrl = workerBase + "/status?session=" + id;
const operationId = id;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let gateway = null;
let wrangler = null;
let gwLogs = [];
let wrLogs = [];
const startedAt = new Date().toISOString();

function start(command, args, extraEnv, kind) {
  // Only the gateway process may receive the test secret. The Pi worker and
  // Wrangler have no payment-credential authority, even in a sandbox test.
  const childEnv = environmentForChild(process.env, extraEnv, kind);
  const cp = spawn(command, args, {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: childEnv
  });
  const logs = kind === "gateway" ? gwLogs : wrLogs;
  for (const stream of [cp.stdout, cp.stderr]) {
    stream.on("data", (chunk) => {
      logs.push(String(chunk));
      if (logs.length > 120) logs.shift();
    });
  }
  return cp;
}

async function terminate(cp, signal = "SIGKILL") {
  if (!cp?.pid) return;
  try { process.kill(-cp.pid, signal); } catch {
    try { cp.kill(signal); } catch {}
  }
  await Promise.race([
    new Promise((resolve) => cp.once("exit", resolve)),
    sleep(2000)
  ]);
}

async function json(url, options) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000), ...options });
  let body;
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) {
    throw new Error("HTTP " + response.status + " " + url + ": " + JSON.stringify(body));
  }
  return body;
}

async function eventually(label, fn, predicate, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (predicate(last)) return last;
    } catch (e) { last = String(e); }
    await sleep(300);
  }
  throw new Error("Timed out: " + label + " last=" + JSON.stringify(last));
}

function startWrangler() {
  return start(
    path.join(ROOT, "node_modules/.bin/wrangler"),
    ["dev", "--config", path.join(ROOT, "wrangler.jsonc"),
      "--port", "18961", "--inspector-port", "0", "--persist-to", path.join(runDir, "wrangler"),
      ...(scenario === "before-provider" ? ["--var", "LAB_CRASH_STAGE:before-provider"] : [])],
    { NODE_ENV: "test" }, "wrangler"
  );
}

let result = {
  runId: id, startedAt, mode, scenario, upstream: "agents@0.28.1 / pi-durable@1.3.0",
  noRealPayment: mode !== "stripe-test", noRealMoney: true, evidenceSchema: 2,
  passed: false, phases: []
};

try {
  // Fixed ports are intentionally checked, not cleared: never terminate an
  // unrelated process listening on the owner's workstation.
  for (const port of [18961, 18962]) {
    try {
      const res = await fetch("http://127.0.0.1:" + port, { signal: AbortSignal.timeout(300) });
      await res.body?.cancel();
      throw new Error("Port " + port + " occupied; refusing to touch existing listener");
    } catch (e) {
      if (e.message?.includes("occupied")) throw e;
    }
  }
  gateway = start(process.execPath, [path.join(ROOT, "scripts/gateway.mjs")],
    { GATEWAY_MODE: mode, LAB_EVIDENCE_DIR: runDir, LAB_OPERATION_ID: id }, "gateway");
  const health = await eventually("gateway ready", () => json(gatewayBase + "/health"), (v) => v.ready);
  if (health.mode !== mode) throw new Error("Gateway unexpectedly switched modes");
  result.accountVerification = health.account;
  result.phases.push("gateway_ready");

  wrangler = startWrangler();
  await eventually("worker ready", () => json(stateUrl), (v) => v.phase === "not_started", 60000);
  result.phases.push("worker_ready");

  const first = await json(workerBase + "/start?session=" + id, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId })
  });
  if (first.accepted !== true) throw new Error("First payment operation not accepted: " + JSON.stringify(first));
  result.phases.push("pi_operation_admitted");
  if (scenario === "before-provider") {
    await eventually("before external request", () => json(stateUrl), v => v.phase === "before_external_request" && v.toolExecutions === 1);
    const initialGateway = await json(gatewayBase + "/state");
    if (initialGateway.gatewayRequests !== 0 || initialGateway.stripeCreateRequests !== 0) throw new Error("Provider contacted before intended boundary");
    await terminate(wrangler, "SIGKILL"); wrangler = null;
    await sleep(300);
    wrangler = startWrangler();
    await eventually("worker revived", () => json(stateUrl), v => v.toolExecutions === 1, 60000);
    const completed = await eventually("pre-request recovery", () => json(workerBase + "/result?session=" + id + "&operationId=" + id), v => v.status === "done", 60000);
    if (!String(completed.text).startsWith("interrupted or failed:")) throw new Error("Unsafe pre-request tool did not report interruption");
    const repeated = await json(workerBase + "/start?session=" + id, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operationId:id})});
    if (repeated.accepted !== false) throw new Error("Duplicate admitted");
    for(let n=0;n<3;n++){
      await sleep(150);
      const worker=await json(stateUrl), external=await json(gatewayBase+"/state");
      if(worker.toolExecutions!==1 || external.gatewayRequests!==0 || external.stripeCreateRequests!==0 || Object.keys(external.accepted).length!==0) throw new Error("Unexpected external effect");
    }
    result.toolExecutions=1;result.gatewayRequests=0;result.stripeCreateRequests=0;
    result.recoveryText=completed.text;
    result.phases.push("crashed_before_external_request","unsafe_interruption_recovered","no_payment_attempt","duplicate_operation_rejected");
    result.passed=true;
  } else {
  const before = await eventually("effect committed before tool completion",
    () => json(stateUrl),
    (v) => v.phase === "provider_accepted_waiting" && v.toolExecutions === 1,
    60000);
  const firstGateway = await json(gatewayBase + "/state");
  const receipt = firstGateway.accepted[id];
  if (!receipt || receipt.status !== "succeeded" || receipt.livemode !== false) {
    throw new Error("External effect missing or not test-only");
  }
  if (firstGateway.gatewayRequests !== 1 ||
      firstGateway.stripeCreateRequests !== (mode === "stripe-test" ? 1 : 0)) {
    throw new Error("External boundary attempt counts incorrect before crash");
  }
  assertMatchingReceipt(before, firstGateway, operationId, mode);
  result.providerId = receipt.id;
  result.phases.push("external_effect_observed_before_crash");

  await terminate(wrangler, "SIGKILL");
  wrangler = null;
  await eventually("worker port released", async () => {
    try {
      await fetch(stateUrl, { signal: AbortSignal.timeout(500) });
      return false;
    } catch {
      return true;
    }
  }, (v) => v === true, 15000);
  result.phases.push("wrangler_sigkill");

  // Same persisted Durable Object filesystem; Pi must wake and reconcile its
  // interrupted UNSAFE tool, rather than automatically sending payment again.
  wrangler = startWrangler();
  await eventually("worker revived", () => json(stateUrl), (v) => v.toolExecutions === 1, 60000);
  const completed = await eventually("Pi recovery terminal outcome", () =>
      json(workerBase + "/result?session=" + id + "&operationId=" + operationId),
    (v) => v.status === "done", 60000);
  result.phases.push("pi_recovery_completed");
  if (!String(completed.text).startsWith("interrupted or failed:")) {
    throw new Error("Unsafe-tool recovery unexpectedly reported tool success: " + JSON.stringify(completed));
  }

  const after = await json(stateUrl);
  const gatewayAfter = await json(gatewayBase + "/state");
  if (after.toolExecutions !== 1 || gatewayAfter.gatewayRequests !== 1 ||
      gatewayAfter.stripeCreateRequests !== (mode === "stripe-test" ? 1 : 0) ||
      gatewayAfter.accepted[id]?.id !== receipt.id) {
    throw new Error("FAIL: duplicated execution or mismatched provider evidence");
  }
  assertMatchingReceipt(after, gatewayAfter, operationId, mode);
  result.phases.push("no_automatic_unsafe_replay");

  const repeated = await json(workerBase + "/start?session=" + id, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ operationId })
  });
  if (repeated.accepted !== false) {
    throw new Error("Duplicate operationId was not rejected: " + JSON.stringify(repeated));
  }
  result.phases.push("duplicate_operation_id_rejected");
  // Fresh readbacks AFTER duplicate submission: a rejected admission alone is
  // not proof that no additional tool or gateway operation occurred.
  for (let observation = 0; observation < 3; observation++) {
    await sleep(150);
    assertMatchingReceipt(await json(stateUrl), await json(gatewayBase + "/state"), operationId, mode);
  }
  result.phases.push("post_duplicate_receipts_and_counts_unchanged");

  const verify = await json(gatewayBase + "/verify?operationId=" + id);
  if (mode === "stripe-test" && verify.verified !== true) {
    throw new Error("Stripe provider independent readback failed");
  }
  assertReadback(verify, receipt, mode);
  result.providerVerification = verify;
  result.phases.push(mode === "stripe-test" ? "real_stripe_provider_readback" : "offline_fixture_only");
  result.toolExecutions = after.toolExecutions;
  result.gatewayRequests = gatewayAfter.gatewayRequests;
  result.stripeCreateRequests = gatewayAfter.stripeCreateRequests;
  result.recoveryText = completed.text;
  result.passed = true;
  }
} catch (error) {
  result.error = error instanceof Error ? error.message : String(error);
  result.gatewayLogsTail = gwLogs.join("").slice(-2800);
  result.wranglerLogsTail = wrLogs.join("").slice(-4800);
} finally {
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(result, null, 2) + "\n",
    { mode: 0o600 });
  await terminate(wrangler, "SIGKILL");
  await terminate(gateway, "SIGTERM");
  console.log(JSON.stringify(result, null, 2));
}
if (!result.passed) process.exitCode = 1;
