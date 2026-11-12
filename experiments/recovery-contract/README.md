# Recovery contracts: a reproducible engineering pilot

This is a **deterministic simulated-provider study**, not a Stripe failure trial or a new general exactly-once algorithm. It builds on the original [Pi Durable × Stripe crash lab](../../docs/case-study.md) without modifying its version-pinned archived results.

## What it measures

Four policies are compared across ten predeclared fault cases and three repetitions (120 cells):

| Policy | Rule | Intended diagnostic |
| --- | --- | --- |
| A — new key | Issue a fresh attempt key after uncertainty | Known-bad duplicate risk |
| B — stable key | Repeat with the original key | Provider dedupe within a bounded simulated retention guarantee |
| C — authority ledger | Preserve intent, frozen payload, current authorisation, admission lock and independent provider readback | Safety *and* justified progress under cooperating receiver assumptions |
| D — hold | Do not attempt uncertain operations | Zero duplicates can conceal lost progress |

The simulated provider and controller persist in **different SQLite files**, with WAL, durable commits and independently reopened readback. For concurrency, two **separate Node processes** compete at a filesystem barrier. The webhook E2E kills a worker with **SIGKILL** before or after a receiver commit, then starts a new process and reads separate inbox and downstream ledgers. Adversarial tests substitute scripted erroneous agent proposals; no LLM inference occurs.

**Ten cases:** clean; committed response lost; uncommitted response lost; changed attempt ID; concurrent recovery; changed payload; cancellation before retry; in-flight commit after cancellation; unavailable readback; *simulated* expired idempotency key.

## Reproduce from an isolated checkout

Requires Node 24 with built-in `node:sqlite`. No npm install, credentials, Cloudflare account, Stripe account, deployment or network calls are needed for these four suites.

From the repository root, choose four fresh ignored evidence directories:

```sh
node experiments/recovery-contract/run.mjs --output .evidence/recovery/your-matrix
node experiments/recovery-contract/concurrency-e2e.mjs --output .evidence/recovery/your-concurrent
node experiments/recovery-contract/webhook-e2e.mjs --output .evidence/recovery/your-webhook
node experiments/recovery-contract/adversarial-e2e.mjs --output .evidence/recovery/your-adversarial
```

All scripts fail closed if their output directory already exists. Their dataset summaries and original SQLite databases remain within ignored `.evidence`, not production paths.

The optional `stripe-readback.mjs` tool performs **GET-only** account-authorised observation of the two 22 October Stripe test PaymentIntents and the separately abandoned 12 November operation. It is deliberately excluded from offline reproduction; using it requires the owner's valid 0600 test-only credential file and creates no new payment.

## Evidence and controls

The private receipt bundle on the owner machine is sealed with source and artifact hashes and verified by reopening the provider ledgers; see `evidence-bundle.mjs`. One copied result was deliberately corrupted, and the verifier rejected it. The pristine original still passed.

The pilot's observed scores (30 cases per policy) must not be called production error rates. The authority-aware policy produces **0 simulated duplicates, 0 new dispatches after cancellation, and 18 confirmed-progress results** under these exact fixtures. The hold policy also has 0 duplicates but only 3 confirmed-progress results. A new-key recovery duplicates effects and violates cancellation boundaries; the stable-key policy fails under the simulated retention-expiry and revocation cases.

The concurrency E2E includes 9 cases with two real processes each. The webhook E2E includes 15 cases (normal, kill before effect, kill after effect before acknowledgement, invalid signature, changed payload), with three repetitions each. The downstream receiver enforces UNIQUE(event_id); without a cooperating receiver this result does **not** establish exactly-once external fulfilment.

## Limits and falsification

- Provider retention expiry is injected by logical ticks. A 24-hour timer, actual Stripe pruning or live provider contract boundary has **not** been observed.
- The receiver's idempotency and authoritative lookup are assumptions, not features guaranteed by every social API.
- Revocation protects *new dispatch*. An in-flight request authorised before revocation may still commit afterwards; the tests report these separately.
- No real hosted Cloudflare eviction, permanent operator crash or session migration is measured by this simulator. The separate pinned Pi 1.3/Pi 1.4 E2E results carry those limited harness claims.
- This deterministic fixture isolates policy correctness from model behaviour. It is neither a model benchmark nor a demonstration of a new recovery mechanism.
- An independent inspector can rerun this experiment, but the owner-controlled records are not third-party verification.

The earlier proposed "breakthrough" remains **unqualified**. A real-provider comparison with the strongest existing recovery policy and a meaningful counterexample is required before a novelty claim or expansion of provider-effect tests.
