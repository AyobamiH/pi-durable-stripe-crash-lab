# Pi Durable × Stripe crash-recovery safety lab

Version-pinned evidence for Cloudflare PiHarness recovering around an external payment effect, using a deterministic faux model and Stripe test mode.

## Verified on 22 October 2026

| Check | Outcome |
| --- | --- |
| Genuine GBP 1.00 Stripe test payment, local Wrangler SIGKILL and Pi recovery | PASS: one tool call, one gateway call, one successful PaymentIntent |
| Genuine GBP 1.00 Stripe test payment on hosted Cloudflare Durable Objects | Recovery independently verified: new instance, interrupted unsafe tool, one payment, duplicate submission rejected |
| Crash before the external request | PASS: one interrupted tool, zero gateway requests |
| Read-only replay control | PASS: unsafe executes once; safe executes twice and completes |
| Signed Stripe webhook plus two deliberate signed HTTP replays | PASS: three deliveries, one recorded business consequence |
| Safety, receipt, credential and webhook unit tests | 35/35 pass |
| Independent Stripe connector readback | Two successful test PaymentIntents total, one per payment scenario; complete paginated-window result |
| Paid LLM inference and real-money payments | None |

The hosted runner initially failed an overly strict crash-marker assertion. Its original failure is retained. A separate readback of the **same operation and payment**, without creating a replacement payment, verified the changed instance, terminal Pi transcript, matching receipts and unchanged counters. The runner now uses that verified acceptance method. This is disclosed in the [execution record](docs/execution-20261022.md).

These are tested integration boundaries, **not an exactly-once guarantee for all failures or evidence of a Pi defect**.

## Evidence

- [Execution record and limitations](docs/execution-20261022.md)
- [Independent Stripe readback](docs/stripe-independent-readback-20261022.json)
- [Local payment and crash](docs/evidence-20261022/local-stripe.json)
- [Hosted recovery readback](docs/evidence-20261022/hosted-recovery-readback.json)
- [Webhook delivery and duplicate handling](docs/evidence-20261022/webhook.json)
- [Before-request interruption](docs/evidence-20261022/before-request.json)
- [Safe/unsafe replay comparison](docs/evidence-20261022/replay-comparison.json)

Historical fixture-only reports remain dated and unchanged.

## Pinned implementation

Node 24, agents 0.28.1, pi-durable 1.3.0, and the committed npm lockfile. These results do not claim to cover later Pi or Agents releases. The local runtime compatibility date is kept within the pinned workerd binary's supported range.

## Offline reproduction

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:e2e
LAB_SCENARIO=before-provider npm run test:e2e
node scripts/replay-e2e.mjs
```

The runner checks for occupied ports, starts its own processes, SIGKILLs only its own Wrangler process group, and restarts against the same Durable Object persistence. Raw runtime evidence is ignored under .evidence/. The replay probe has no payment capability.

GitHub Actions contains the offline checks. The hosted results are actual Cloudflare execution evidence, not a claim that GitHub's previously unavailable runner capacity was repaired.

## Stripe test execution

The gateway is fixed to GBP 1.00, pm_card_visa, a single predeclared lab operation, and the lab owner's test account. It verifies both account identity and livemode=false before creating a PaymentIntent. Live keys, another account, another operation, non-private credential files and uncertain retries fail closed.

The existing owner can use hidden terminal input:

```sh
./scripts/run-stripe-test.sh
```

Or a dedicated owner-only mode-0600 file containing exactly one STRIPE_TEST_SECRET_KEY assignment:

```sh
STRIPE_TEST_KEY_FILE=/private/path/stripe-test.env ./scripts/run-stripe-test.sh
```

The file is parsed as data; it is never sourced as shell code. Only the gateway loads the credential. The Pi/Wrangler child environment receives neither the key nor its source path. Other users must explicitly configure their own expected test account before running this owner-scoped lab.

## Hosted architecture

- Agent Worker: protected control endpoint, faux model, PiHarness and a SQLite Durable Object; no Stripe key.
- Gateway Worker: no public URL; service binding only; separate durable attempt ledger and test-only credential.
- Webhook Worker: signature verification, timestamp tolerance, fixed operation scope and durable notification deduplication; no payment API credential.

All three use dedicated lab resources. Production checkouts, Post-Once, ClawSweeper and Agent Shop resources are not modified.

Hosted configs are left with public exposure disabled after acceptance. The temporary Stripe webhook and hosted payment/signing secrets are removed during cleanup. Reproduction requires explicitly configuring a fresh operation scope, enabling the protected lab endpoints, binding test-only secrets, and registering a fresh temporary webhook. The setup scripts fail closed on a previously deleted webhook record.

## Durability boundary

The gateway records an attempt before contacting Stripe and never blindly retries an uncertain result. A succeeded operation returns the existing receipt. Stripe idempotency is a second layer; it is not the durable business ledger.

An unsafe Pi tool is reported as interrupted after recovery. The faux model does not invent a new payment operation. Application authorisation and durable operation identity remain necessary with a real model.

The signed duplicate webhook requests are deliberate test replays of the original Stripe-delivered payload, not evidence about Stripe's automatic retry scheduler.

## References

- https://developers.cloudflare.com/agents/harnesses/pi/
- https://developers.cloudflare.com/durable-objects/api/state/
- https://docs.stripe.com/api/idempotent_requests
- https://docs.stripe.com/api/payment_intents/create
- https://docs.stripe.com/webhooks
