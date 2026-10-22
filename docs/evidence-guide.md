# Evidence guide: what can be verified

Date: 22 October 2026 · Author: [ayobamih](https://github.com/AyobamiH)

Read the [case study](case-study.md) for the argument. This guide separates exported observations, source checks and fresh reproduction.

## Evidence identity

The original execution/source snapshot is commit [ef235c267da51867b042a43e0cc8323781c19991](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/commit/ef235c267da51867b042a43e0cc8323781c19991). GitHub recorded its signature as verified. Commit signatures attribute a snapshot; they do not attest to Stripe or Cloudflare outcomes.

[evidence-manifest.json](evidence-manifest.json) records SHA-256 hashes for the selected original execution records, source, configuration and dependency files. The manifest is versioned with this publication. Historical evidence files have not been edited to improve their results.

Run from the repository root with Node 24:

```sh
node scripts/verify-evidence.mjs
```

No dependencies, secrets or network access are required. A pass means that the selected files match the manifest and the checked relationships agree. It does not contact either provider, recreate the historical run, or establish independent third-party verification.

## Claim-to-evidence map

| Claim | Fields to inspect | Primary evidence | Limit |
| --- | --- | --- | --- |
| Local payment used the Stripe test API | mode, providerVerification, providerId, toolExecutions, gatewayRequests, stripeCreateRequests | [local-stripe.json](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/evidence-20261022/local-stripe.json) | The JSON is the runner's exported summary |
| Hosted payment preceded the deliberate reset | before.phase, before.providerReceipt, crashResponse | [hosted-initial-assertion-failed.json](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/evidence-20261022/hosted-initial-assertion-failed.json) | passed remains false because the original assertion failed |
| A new instance recovered the same operation | before.instanceId != after.instanceId; terminal.text; matching providerId | [hosted-recovery-readback.json](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/evidence-20261022/hosted-recovery-readback.json) | Instrumented reset; not a naturally occurring outage |
| Duplicate application admission was rejected | duplicate.accepted=false; gatewayAfter counters remain one | [hosted recovery](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/evidence-20261022/hosted-recovery-readback.json) | Same operation ID; arbitrary new operations are outside the test |
| Both payments succeeded at Stripe | local/hosted id, status, amount, amount_received, currency, livemode, metadata | [Stripe readback](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/stripe-independent-readback-20261022.json) | Owner-account readback through a separate access path; not a public provider attestation |
| The queried window returned only the two expected objects | completeListForRunWindow.payments and has_more=false | [Stripe readback](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/stripe-independent-readback-20261022.json) | Observation at checkedAt; no assertion about future objects |
| Before-request failure sent no payment request | gatewayRequests=0; stripeCreateRequests=0 | [before-request.json](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/evidence-20261022/before-request.json) | Fixture scenario |
| Replay policy behaved differently | unsafe calls=1/outcome=interrupted; safe calls=2/outcome=completed | [replay-comparison.json](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/evidence-20261022/replay-comparison.json) | Read-only fixture; no safely replayed payment was attempted |
| Webhook record converged after repeated deliveries | deliveries 1→3; same PaymentIntent; one event ID | [webhook.json](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/evidence-20261022/webhook.json) | Two duplicates were signed by the runner; downstream fulfilment was not implemented |
| Lab cleanup completed | endpointDeleted; removedSecrets; disabledPublicEndpoints | [cleanup.json](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/docs/evidence-20261022/cleanup.json) | Recorded cleanup observation; not continuous monitoring |

## Three levels of verification

### 1. Public inspection

Anyone can compare the immutable JSON, source, lockfile and manifest. Review the crash injection in [worker.ts](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/src/worker.ts), payment admission in [hosted-gateway.ts](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/src/hosted-gateway.ts), and assertions in [hosted-recovery-readback.mjs](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/blob/ef235c267da51867b042a43e0cc8323781c19991/scripts/hosted-recovery-readback.mjs).

The original hosted failure and later readback must refer to the same run and PaymentIntent. A reader should reject a success claim that replaces the failed run with an unrelated payment.

### 2. Account-authorised readback

An authorised reader of the originating Stripe test account can retrieve:

- Local PaymentIntent: `pi_3UTReLGbPfXt7ec50W8SyVvv`.
- Hosted PaymentIntent: `pi_3UTRr4GbPfXt7ec50z2eLbbo`.
- Local success event: `evt_3UTReLGbPfXt7ec50WNlAhtK`.
- Hosted success event: `evt_3UTRr4GbPfXt7ec502cWTQe3`.

Compare status=succeeded, amount=100, amount_received=100, currency=gbp, livemode=false and the matching lab_operation metadata. The original complete-list query used created.gte=1792697247 and limit=100; the saved result was complete at its recorded checkedAt. A query made later can legitimately include newer payments.

Do not publish API keys, webhook signing secrets or PaymentIntent client secrets. Public IDs alone do not give account access. The redacted export is an operator-authored representation of provider readback, not a cryptographically signed Stripe statement.

### 3. Fresh reproduction

Offline controls can run on a clean checkout using the README commands. A new Stripe/cloud reproduction needs the reviewer's own isolated configuration, expected account, fresh operation IDs, test credentials and deployment resources. The archived configuration intentionally rejects other accounts and scopes.

The hosted endpoints are disabled and credentials removed. There is no claim of a continuously available demo or a fresh third-party reproduction. A useful reproduction report should include the commit, lockfile, runtime, compatibility dates, scenario, operation IDs, outcome, failures and redacted provider readback.

## Known qualifications

- The real-provider sample size is two payment scenarios, one local and one hosted. It is not a statistical reliability estimate.
- Hosted success is a same-operation recovery readback after an assertion failure. The corrected full runner has not been rerun end to end on a new payment.
- The three repeated hosted assertions are present in the runner, but their intermediate snapshots were not exported individually.
- The webhook field businessConsequences is set to one as a stored marker. It cannot establish that an external business action ran only once.
- Lost-response and concurrent-admission checks are mocked unit tests. They are not real Stripe outage trials.
- The hosted success event's pending_webhooks=1 is account-wide metadata. It does not identify the pending endpoint; the lab receiver recorded its original delivery.
- The gateway's stripeCreateRequests is an application attempt counter, incremented before fetch. Provider object readback supplies separate corroboration; the counter alone is not a Stripe request log.
- The final source snapshot includes the corrected hosted runner. The preserved failed execution used its earlier marker assertion. Deployment version IDs are in the execution record; an immutable build provenance attestation mapping every deployed byte was not captured.
- Results cover the pinned Agents 0.28.1/Pi 1.3.0 baseline. Current documentation may describe later versions.
- “Independent” means separate readback from the execution harness. The owner and AI assistant conducted both; no external auditor or maintainer endorsement is claimed.

## Useful review feedback

A reproduction, a counterexample with an exact failure boundary, or a correction to the claimed evidence strength is more valuable than an unqualified success badge. File a focused issue in this repository with a commit and redacted evidence. Do not disclose credentials or other account data.

## Publication validation

[Publication validation](publication-validation-20261022.json) records the new offline checks, TypeScript check and unit-test rerun. Negative controls confirm that the archive checker rejects both changed bytes and a mismatched payment ID even when its file hash is updated. This validation created no new payment or hosted recovery run.
