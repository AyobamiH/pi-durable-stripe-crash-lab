# Pi 1.4 hosted automatic-alarm and abort acceptance experiment

This **two-operation, zero-provider-effect** experiment extends the independently observed 13 November 2026 hosted Pi 1.4 parked-to-retry fixture. It deliberately tests two previously unverified boundaries: unattended alarm-driven safe replay and explicit tool-cooperative abort.

The source uses Agents 0.30.1 and Pi Durable 1.4.0 with a deterministic faux model and a single inert tool. It does **not** connect Stripe, write a social provider, contact any LLM API, or charge money.

## Stronger witness design

Two newly named Durable Object classes are deployed to one completely new Worker:

- `Probe` runs the Pi harness and replay-safe, inert tool. For the automatic case its first invocation writes to **a separate Witness DO**, then terminates the Probe DO.
- `Witness` durably stores tool-entry, pre-crash, completion and abort events. A client can query Witness **without touching Probe**, preventing a GET-driven Probe restart from masquerading as an alarm-driven continuation.

Before the independent witness records the second tool-entry and completion, `/status` and `/result` for the automatic case return HTTP 425 **without invoking Probe**.

The second operation's cooperative tool checks its abort signal and never records a successful completion on an aborted run. The experiment issues **one** explicit abort command and does not retry it after an uncertain response.

## Controls and method

The source includes an intentionally non-deployable `wrangler.template.jsonc`. Before any hosted run, an owner must create a fresh Worker name, two unique allowed operation IDs and a 0600 bearer token in an owner-private directory. Deployment uses a dedicated new SQLite-backed DO namespace and Workers dev endpoint, protected by the bearer token and exact operation allowlist.

`run-client.mjs preflight` checks anonymous HTTP 401, out-of-scope HTTP 403 and premature status HTTP 425, plus empty independent witness ledgers.

`run-client.mjs execute` performs the following only once:

1. Start the auto operation; **poll Witness only**, never Probe, until its second-entry/completion record or the bounded deadline. Then verify Probe pending = empty and final result = done.
2. Start the abort operation, confirm its tool entry through Witness, send one explicit abort, and independently read Witness and Probe to establish terminal abort or report an **uncertain/incomplete** result.

All original responses, including failures, are retained privately before assertion. The deployment must be removed and its secret deleted, with the public endpoint returning HTTP 404. Read-only post-delete verification is required. The harness does not own or modify the original October/November Workers.

## Acceptance boundaries

A real alarm-only wake requires the independent witness to observe the second tool entry in a different Probe instance **before any external Probe GET after start**. A re-run through a status GET does not qualify.

A verified abort requires a successful explicit abort response, a durable witness result, empty pending state and a settled terminal session; a timed-out abort must remain unverified. Under these fixtures no external consequential effects are possible.

The experiment is still *one bounded case*, not proof of exactly-once external effects, and does not establish the correctness of Stripe's idempotency cache, provider permissions or production delivery guarantees.

See the dated execution record and redacted evidence folder added only **after** actual hosted execution and independent readback.
