# Pi Durable × Stripe crash-recovery safety lab

Minimal, reproducible test of **Cloudflare PiHarness / Pi Durable** when an unsafe agent tool has already made an external payment-like side effect.

**Status — 18 October 2026**
- **PASS:** Actual PiHarness + Pi Durable + SQLite Durable Object crash/restart, deterministic faux model, isolated external fixture gateway
- **PASS:** Gateway safety unit tests 3/3
- **PENDING:** Genuine Stripe test-mode payment and provider readback — the connected account exposes live mode only and no test credential is installed
- **NONE:** LLM charges, real Stripe payment, production deployment, Post-Once runtime changes, Tail Wagging checkout changes

## Why

Durable execution does not guarantee exactly-once payment effects. The agent can crash after a provider accepts a consequential request but before its tool returns. The Pi replay policy "unsafe" prevents automatic replay. The separately running payment adapter maintains a durable operation identity, persists consequence intent before the external request and refuses retries when the provider outcome is uncertain.

The test crashes **after the external adapter confirms success and before Pi commits a tool result**.

## Pinned implementation

- Node 24; agents 0.28.1; pi-durable 1.3.0; Wrangler 4; pi-ai pinned by package-lock
- Cloudflare upstream code inspected at https://github.com/cloudflare/agents/tree/7dd51c518c51
- The actual Pi Durable PiHarness from agents/harness/pi is tested here — not the separate experimental chat-recovery Pi Core fixture

## Offline, no model, no Stripe credential

    npm ci --ignore-scripts
    npm run typecheck
    npm test
    npm run test:e2e

A locally bound payment gateway (127.0.0.1:18962) runs outside Wrangler (127.0.0.1:18961). The test refuses occupied ports, creates a unique Durable Object and private .evidence/runs directory, SIGKILLs only its own Wrangler process and restarts it against the same SQLite persistence.

Assertions:
- Provider-like external effect confirmed while Pi tool is still blocked
- Crash SIGKILL then wake and actual Pi Durable recovery
- Pi reports an interrupted unsafe tool
- One tool execution, one gateway request and no automatic replay
- Duplicate operation ID not accepted
- Offline mode explicitly reports fixture_only rather than Stripe readback

## Genuine Stripe TEST payment (no real money)

Requires a test-only secret key beginning with sk_test_. Live keys are hard-blocked.

Never put a secret in the repository. In the private machine shell:

    cd /path/to/experiment
    read -rs -p "Stripe TEST-only secret: " STRIPE_TEST_SECRET_KEY
    echo
    export STRIPE_TEST_SECRET_KEY
    GATEWAY_MODE=stripe-test npm run test:e2e
    unset STRIPE_TEST_SECRET_KEY

In test mode, the gateway makes one GBP 1.00 PaymentIntent with payment_method pm_card_visa and confirm=true against the real Stripe test API. It uses a stable operation-derived Stripe idempotency key. A successful response must have livemode=false and status=succeeded.

After the crash and recovery, it reads the PaymentIntent directly from Stripe and checks ID, amount, currency, status, livemode and operation metadata. This test proves only the exact scoped outcome and adapter/API-call count, not Stripe-wide global uniqueness or all possible failure interleavings.

The Stripe test-mode step has NOT run yet; no Stripe object exists from these tests.

## Safety boundaries

- Entire test runs in a new workspace, with no changes to user production credentials, timers, applications or customer checkout.
- The adapter stores an attempt before Stripe calls. If the adapter crashes after Stripe accepts but before recording its response, it retains an uncertain attempt and refuses resubmission until independent reconciliation.
- Stripe idempotency keys expire; business idempotency requires its own durable ledger.
- Pi's unsafe interruption is passed back to the model; applications must still require renewed approval and reconcile unknown external outcomes. This lab's faux model deliberately cannot create a new payment on recovery.
- Does not test real webhook delivery, customer authentication, approval controls, API-key rotation, deletes, actual financial settlement or hosted deployment.
- A passing test is **not** evidence that Cloudflare contains a bug.

## Results and contribution

Initial fixture run on 18 October 2026: PASS; Pi signalled that the unsafe tool was interrupted and might have partially run; toolExecutions=1, gatewayRequests=1, Stripe create requests=0.

Further results belong in local ignored .evidence/runs. Do not publish credentials or unreviewed raw logs.

Cloudflare upstream currently requests issues and discussions and is not accepting unsolicited external PRs. If a real distinct defect appears, create a minimal report with exact versions, reproduction and logs rather than filing duplicates.

## References

- https://developers.cloudflare.com/agents/harnesses/pi/
- https://github.com/cloudflare/agents
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/testing
- https://docs.stripe.com/api/payment_intents/create
