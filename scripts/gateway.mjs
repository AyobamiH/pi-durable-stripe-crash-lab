/**
 * Separately running external-side-effect boundary for the Pi crash test.
 * Test Stripe API calls only, or a deterministic offline fixture.
 * This process does not restart when Wrangler/Pi is deliberately SIGKILLed.
 * It never loads, forwards or accepts sk_live_ credentials.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDir = process.env.LAB_EVIDENCE_DIR || path.join(root, ".evidence");
fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
const evidenceFile = path.join(evidenceDir, "gateway-state.json");
const mode = process.env.GATEWAY_MODE ?? "fixture";
const key = process.env.STRIPE_TEST_SECRET_KEY ?? "";

if (!["fixture", "stripe-test"].includes(mode)) {
  throw new Error("Only fixture or stripe-test modes are supported");
}
if (mode === "stripe-test" && (!key.startsWith("sk_test_") || key.length < 20)) {
  throw new Error("STRICT SAFETY GATE: stripe-test requires a verified sk_test_ credential");
}
if (key.startsWith("sk_live_")) {
  throw new Error("STRICT SAFETY GATE: live Stripe credentials prohibited");
}

let state = fs.existsSync(evidenceFile)
  ? JSON.parse(fs.readFileSync(evidenceFile, "utf8"))
  : { schema: 1, mode, accepted: {}, gatewayRequests: 0, stripeCreateRequests: 0 };
if (state.mode !== mode) throw new Error("Evidence mode mismatch; never reuse an evidence directory across modes");

function persist() {
  const pending = evidenceFile + ".tmp";
  const fd = fs.openSync(pending, "w", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(state, null, 2) + "\n");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(pending, evidenceFile);
  const dfd = fs.openSync(evidenceDir, "r");
  try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
}

function send(res, status, object) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(object));
}
function publicEntry(entry) {
  if (!entry) return null;
  return {
    operationId: entry.operationId, status: entry.status, id: entry.id ?? null,
    mode, livemode: false, requestId: entry.requestId ?? null
  };
}

async function createTestPayment(operationId) {
  const form = new URLSearchParams({
    amount: "100", currency: "gbp", payment_method: "pm_card_visa",
    confirm: "true", "payment_method_types[]": "card",
    "metadata[lab_operation]": operationId
  });
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + key,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": "pi-durable-safety-v1-" + crypto.createHash("sha256").update(operationId).digest("hex").slice(0, 36)
    },
    body: form.toString()
  });
  const data = await response.json();
  if (!response.ok || data.livemode !== false || data.amount !== 100 ||
      data.currency !== "gbp" || data.status !== "succeeded" || !String(data.id).startsWith("pi_")) {
    throw new Error("Stripe test payment failed or unverified: " +
      String(data.error?.code ?? data.error?.type ?? response.status));
  }
  return {
    id: data.id, status: data.status, livemode: data.livemode,
    requestId: response.headers.get("request-id")
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ready: true, mode, stripeCredentialConfigured: mode === "stripe-test" });
  }
  if (req.method === "GET" && req.url === "/state") {
    const accepted = Object.fromEntries(Object.entries(state.accepted).map(
      ([operationId, entry]) => [operationId, publicEntry(entry)]
    ));
    return send(res, 200, {
      mode, gatewayRequests: state.gatewayRequests, stripeCreateRequests: state.stripeCreateRequests,
      accepted
    });
  }
  if (req.method === "POST" && req.url === "/payment") {
    try {
      let buffer = "";
      for await (const chunk of req) {
        buffer += chunk;
        if (buffer.length > 4096) return send(res, 413, { error: "Payload too large" });
      }
      const payload = JSON.parse(buffer);
      const operationId = payload.operationId;
      if (!/^lab-[a-z0-9-]{1,70}$/.test(operationId) ||
          payload.amount !== 100 || payload.currency !== "gbp") {
        return send(res, 400, { error: "Invalid fixed test-only request" });
      }
      state.gatewayRequests += 1;
      let entry = state.accepted[operationId];
      if (entry?.status === "succeeded") {
        persist();
        return send(res, 200, publicEntry(entry));
      }
      if (entry) {
        persist();
        return send(res, 409, { error: "Prior external outcome uncertain; no blind retry" });
      }
      entry = { operationId, status: "attempt_committed", id: null };
      state.accepted[operationId] = entry;
      persist(); // record consequence intent before actual external call
      if (mode === "fixture") {
        entry.id = "fixture_pi_" + crypto.createHash("sha256").update(operationId).digest("hex").slice(0, 20);
        entry.status = "succeeded";
      } else {
        state.stripeCreateRequests++;
        persist();
        const payment = await createTestPayment(operationId);
        Object.assign(entry, payment);
      }
      persist();
      return send(res, 200, publicEntry(entry));
    } catch (error) {
      persist();
      return send(res, 502, { error: "External outcome uncertain or rejected; inspect evidence, no automatic retry" });
    }
  }
  if (req.method === "GET" && req.url?.startsWith("/verify?")) {
    const operationId = new URL(req.url, "http://127.0.0.1").searchParams.get("operationId");
    const entry = state.accepted[operationId];
    if (!entry || entry.status !== "succeeded") return send(res, 404, { error: "No confirmed effect" });
    if (mode !== "stripe-test") return send(res, 200, { verified: false, reason: "fixture_only" });
    try {
      const response = await fetch("https://api.stripe.com/v1/payment_intents/" + encodeURIComponent(entry.id), {
        headers: { authorization: "Bearer " + key }
      });
      const data = await response.json();
      const verified = response.ok && data.id === entry.id && data.livemode === false &&
        data.status === "succeeded" && data.amount === 100 && data.currency === "gbp" &&
        data.metadata?.lab_operation === operationId;
      return send(res, verified ? 200 : 409, {
        verified, mode, id: entry.id, status: data.status ?? null,
        livemode: data.livemode ?? null, metadataMatches: data.metadata?.lab_operation === operationId
      });
    } catch {
      return send(res, 502, { verified: false, error: "Stripe readback unavailable" });
    }
  }
  return send(res, 404, { error: "Unknown local test route" });
});
const PORT = 18962;
server.listen(PORT, "127.0.0.1", () => {
  console.log("PAYMENT_GATEWAY_READY " + JSON.stringify({ mode, port: PORT }));
});
process.on("SIGTERM", () => server.close());
