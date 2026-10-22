#!/usr/bin/env node
// Offline archive checks only: no provider calls or payment capability.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;
const eq = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
const ok = (value, label) => { assert.ok(value, label); checks++; };
const read = name => JSON.parse(readFileSync(path.join(root, name), "utf8"));
const evidence = name => read("docs/evidence-20261022/" + name + ".json");

try {
  const manifest = read("docs/evidence-manifest.json");
  eq(manifest.schemaVersion, 1, "manifest schema");
  eq(manifest.evidenceSourceCommit, "ef235c267da51867b042a43e0cc8323781c19991", "baseline");
  ok(Array.isArray(manifest.files) && manifest.files.length > 0, "nonempty file manifest");
  const paths = new Set();
  for (const item of manifest.files) {
    ok(typeof item.path === "string" && !path.isAbsolute(item.path) &&
      !item.path.split(/[\\/]/).includes(".."), "relative archive path");
    ok(!paths.has(item.path), "unique manifest path"); paths.add(item.path);
    const bytes = readFileSync(path.join(root, item.path));
    eq(bytes.length, item.bytes, item.path + ": byte count");
    eq(createHash("sha256").update(bytes).digest("hex"), item.sha256, item.path + ": SHA-256");
  }
  for (const required of [
    "docs/evidence-20261022/local-stripe.json",
    "docs/evidence-20261022/hosted-initial-assertion-failed.json",
    "docs/evidence-20261022/hosted-recovery-readback.json",
    "docs/evidence-20261022/webhook.json",
    "docs/stripe-independent-readback-20261022.json",
    "src/worker.ts", "src/hosted-gateway.ts", "src/hosted-webhook.ts", "package-lock.json"
  ]) ok(paths.has(required), "required manifest member: " + required);

  const local = evidence("local-stripe");
  const initial = evidence("hosted-initial-assertion-failed");
  const hosted = evidence("hosted-recovery-readback");
  const stripe = read("docs/stripe-independent-readback-20261022.json");
  eq(local.passed, true, "local result");
  eq(local.mode, "stripe-test", "local provider mode");
  eq(local.noRealMoney, true, "test money only");
  eq([local.toolExecutions, local.gatewayRequests, local.stripeCreateRequests], [1, 1, 1], "local counters");
  eq(local.providerVerification.verified, true, "local provider readback flag");
  eq(initial.passed, false, "original hosted failure retained");
  eq(hosted.passed, true, "later readback result");
  eq(hosted.noNewPayment, true, "readback declared no new payment");
  eq(hosted.runId, initial.runId, "same hosted operation");
  eq(hosted.providerId, initial.providerId, "same hosted payment");
  eq(hosted.before, initial.before, "same pre-crash observation");
  eq(initial.before.phase, "provider_accepted_waiting", "crash boundary");
  ok(initial.crashResponse.includes("Intentional Pi laboratory crash after provider acceptance"), "recorded abort response");
  ok(hosted.before.instanceId !== hosted.after.instanceId, "replacement instance");
  eq(hosted.terminal.status, "done", "terminal status");
  ok(hosted.terminal.text.includes("Tool stripe_test_payment was interrupted"), "unsafe interruption");
  eq(hosted.duplicate.accepted, false, "duplicate admission rejected");
  eq([hosted.after.toolExecutions, hosted.gatewayAfter.gatewayRequests, hosted.gatewayAfter.stripeCreateRequests], [1, 1, 1], "hosted counters");
  eq(hosted.after.providerReceipt.id, hosted.providerId, "agent receipt");
  eq(hosted.gatewayAfter.accepted[hosted.runId].id, hosted.providerId, "gateway receipt");

  for (const [kind, run] of [["local", local], ["hosted", hosted]]) {
    const provider = stripe[kind];
    eq(provider.id, run.providerId, kind + ": provider ID");
    eq([provider.status, provider.amount, provider.amount_received, provider.currency, provider.livemode],
      ["succeeded", 100, 100, "gbp", false], kind + ": provider payment shape");
    eq(provider.metadata.lab_operation, run.runId, kind + ": provider operation");
  }
  eq(stripe.completeListForRunWindow.has_more, false, "complete exported page");
  eq(stripe.completeListForRunWindow.livemode, false, "exported list mode");
  eq(stripe.completeListForRunWindow.payments.map(p => p.id).sort(),
    [local.providerId, hosted.providerId].sort(), "two expected provider objects");
  eq(stripe.events.has_more, false, "complete exported events");
  eq(stripe.events.events.map(e => e.paymentIntentId).sort(),
    [local.providerId, hosted.providerId].sort(), "matching success events");

  const before = evidence("before-request");
  eq([before.passed, before.mode, before.toolExecutions, before.gatewayRequests, before.stripeCreateRequests],
    [true, "fixture", 1, 0, 0], "before-request fixture");
  const replay = evidence("replay-comparison");
  eq(replay.passed, true, "replay control");
  eq(replay.results.map(r => [r.replay, r.calls, r.outcome, r.externalPaymentRequests, r.passed]),
    [["unsafe", 1, "interrupted", 0, true], ["safe", 2, "completed", 0, true]], "safe/unsafe control");

  const webhook = evidence("webhook");
  eq(webhook.runId, hosted.runId, "webhook operation");
  eq(webhook.passed, true, "webhook result");
  eq(webhook.invalidSignatureRejected, true, "invalid signature rejected");
  eq([webhook.originalStripeDelivery.deliveries, webhook.afterSignedTestReplays.deliveries], [1, 3], "delivery counts");
  for (const state of [webhook.originalStripeDelivery, webhook.afterSignedTestReplays]) {
    eq(state.paymentIntentId, hosted.providerId, "webhook payment");
    eq(state.businessConsequences, 1, "stored marker only; not downstream fulfilment");
    eq(state.eventIds, [stripe.events.events.find(e => e.paymentIntentId === hosted.providerId).id], "webhook event");
  }
  ok(webhook.duplicateSource.includes("not Stripe retry scheduling"), "duplicate origin disclosed");
  eq(evidence("hosted-preflight-failed").passed, false, "preflight failure retained");
  eq(evidence("hosted-preflight-diagnostic").stripeCreateRequests, 0, "failed preflight created no payment");
  eq(evidence("final-fixture").passed, true, "final fixture");

  const cleanup = evidence("cleanup");
  eq(cleanup.endpointDeleted, true, "temporary endpoint deleted");
  eq(cleanup.endpointId, webhook.endpointId, "same temporary endpoint");
  eq(cleanup.removedSecrets.slice().sort(), ["STRIPE_TEST_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"], "hosted secrets removed");
  for (const config of ["agent", "gateway", "webhook"]) {
    const configFile = read("wrangler.hosted-" + config + ".jsonc");
    eq(configFile.workers_dev, false, config + ": public workers.dev disabled");
  }
  const lock = read("package-lock.json").packages;
  eq(lock["node_modules/agents"].version, "0.28.1", "Agents version");
  eq(lock["node_modules/@earendil-works/pi-durable"].version, "1.3.0", "Pi Durable version");
  eq(lock["node_modules/@earendil-works/pi-ai"].version, "1.3.0", "Pi AI version");
  eq(lock["node_modules/wrangler"].version, "4.151.1", "Wrangler version");

  console.log(JSON.stringify({
    passed: true, validation: "offline archive integrity and cross-file consistency",
    evidenceSourceCommit: manifest.evidenceSourceCommit, filesChecked: paths.size, checks,
    providerRequestsMade: 0, independentThirdPartyAudit: false,
    qualifications: [
      "Hosted original assertion failure retained; same-operation readback passed.",
      "Webhook businessConsequences is a stored marker, not measured downstream fulfilment.",
      "Hashes and consistency do not authenticate provider history."
    ]
  }, null, 2));
} catch (error) {
  console.error("Evidence validation failed: " + error.message);
  process.exitCode = 1;
}
