# Execution record — 19 October 2026

## Scope and status

This record separates a running local recovery test from the unfinished real Stripe and hosted Cloudflare tests. No inference requests, real-money transactions, production deployments, or Post-Once changes were performed by this run.

The original Stripe account is connected in test mode. The Stripe connector's current operation discovery returned PaymentIntent read/search operations, but did not return create/confirm or an approval-request creation operation. That is a connector capability observation, not a claim that Stripe itself lacks those APIs.

## Real Stripe-mode invocation

The following existing command was invoked on the authorised WSL host:

```sh
GATEWAY_MODE=stripe-test npm run test:e2e
```

It executed and stopped at the program's own precondition:

```text
Error: A real Stripe test requires STRIPE_TEST_SECRET_KEY=sk_test_...
```

This occurred before the gateway or Wrangler was started and before any Stripe request. It was not a new platform refusal. The earlier credential-access refusals were not bypassed or retried through another tool. The code has not loaded private credential files or changed the live-key prohibition. Connecting Stripe in ChatGPT does not inject a credential into this local process.

**Real Stripe payment test: NOT COMPLETED.** The existing test account and historical payments are not evidence of a new payment produced by this experiment.

## Evidence hardening completed

The acceptance checker now validates exact agreement between the gateway receipt and Pi's durable provider receipt, including operation ID, provider object ID, mode, outcome and test-only status. It checks counts before and after crash, then makes three fresh checks after a duplicate submission. Real Stripe readback must match that same receipt; fixture evidence cannot be labelled provider-verified.

These checks do not execute provider actions, retrieve credentials, change tool replay policy or confer payment authority.

## Results

- Unit and evidence checks: **24 passed, zero failed**.
- TypeScript no-emit check: **passed**.
- Real local Wrangler/Pi Durable crash-and-restart run: **passed**.
- Run: `lab-22f49252ebf077`.
- Started: `2026-10-19T08:22:10.744Z`.
- Finished: `2026-10-19T08:22:35.322Z`.
- Mode: `fixture`.
- Payment-tool executions: **1**.
- Gateway requests: **1**.
- Real Stripe creation requests: **0**.
- Readback: `verified: false`, `reason: fixture_only`.
- Post-duplicate observations: matching receipts and unchanged counts.

Private run output remains under `.evidence/runs/lab-22f49252ebf077/result.json`. The full current suite output is `.evidence/acceptance-hardening-20261019.log`. These ignored files are not provider payment evidence.

## Remaining acceptance gates

1. Bind a test credential through an authorised process and independently establish the intended account, then execute and verify the new Stripe PaymentIntent.
2. Run the joined experiment on isolated hosted Cloudflare infrastructure and record the hosted crash/recovery evidence.
3. Complete any promised additional fault scenarios (including replay-safe comparison and real webhook redelivery) before advertising broader coverage.

GitHub-hosted execution was not accepted by this record: the current status lookup encountered a TLS handshake timeout. Local execution is not presented as hosted CI.

No upstream Cloudflare defect or exactly-once guarantee is claimed.
