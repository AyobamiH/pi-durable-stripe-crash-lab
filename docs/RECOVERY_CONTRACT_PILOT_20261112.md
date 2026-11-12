# Recovery after an uncertain external effect — reproducible pilot

**Date:** 12 November 2026 (UTC)

**Scope:** Synthetic provider, real local OS process termination, protected read-only Stripe account verification.

**Status:** Engineering tests completed; no originality, general exactly-once, live social-platform recovery or independent third-party endorsement claimed.

## Research question

When an external effect may have succeeded but its response is lost, what can a recovering agent safely do while preserving the original intent, current authorisation and a justified claim of completion?

This follows the archived Pi Durable × Stripe test-mode study on Agents 0.28.1/Pi 1.3.0. The original historical hosted runner failed its first pre-crash marker assertion; later readback of **the same operation** established recovery. The historical failure has not been rewritten or replaced with a fresh hosted-pass claim. The 12 November Pi 1.4 work validated equivalent **local fixtures**, not a new provider-backed hosted run.

## Protocol

The prior programme issue [#1](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/issues/1) recorded four control policies and ten fault boundaries before this pilot was executed. It is a research work plan, **not** a formally preregistered benchmark or proof of novelty.

The test implementation lives in [experiments/recovery-contract](../experiments/recovery-contract/README.md). Each fault/policy pair runs three times, with distinct SQLite databases for the controller and a cooperating provider. A separate read-only connection examines the provider's effect ledger; the controller's answer is never used to count provider effects.

Tests deliberately exercise actual duplicate-effect conditions in known-bad controls. Completing a test process is not scored as a successful recovery policy.

## Main results: four policies × ten cases × three repetitions

| Policy | Scenarios | Safety violations | Duplicate provider effects | Dispatches after cancellation | Confirmed-progress cases | Unresolved claims |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A — fresh attempt key | 30 | 24 | 21 | 6 | 6 | 0 |
| B — stable original key | 30 | 9 | 3 | 6 | 18 | 3 |
| C — authority + evidence ledger | 30 | 0 | 0 | 0 | 18 | 3 |
| D — hold all uncertainty | 30 | 0 | 0 | 0 | 3 | 27 |

These numbers are fixture outcomes, **not reliability rates**. The three repetitions are identical deterministic conditions with isolated state, not random samples of production incidents.

Policy A exposes the hazards of inventing a new attempt identity. Policy B prevents some duplicates under a valid retained key but does not independently enforce ongoing authority; its three duplicate effects occur under **simulated** expiry. Policy C refuses changed payloads and revoked authority, reports unavailable readback as unknown, and reconciles existing effects where the simulated provider supplies authoritative information. Policy D avoids duplicate dispatch but unnecessarily holds an otherwise provably safe absent-operation case.

An in-flight original dispatch was authorised *before* cancellation in three repetitions per policy. It subsequently committed **after** revocation. The scorer reports these late commits separately from new dispatches after revocation; it does not falsely claim the earlier in-flight request was cancelled.

The 0 observed C-policy violations establish only the properties checked against this receiver and these scenarios. No guarantee is made for non-cooperating services, unknown provider queues or unlimited retention.

## Two genuinely competing processes

Nine isolated runs launched two separate Node processes against the same durable admission SQLite database:

| Policy | Accepted admissions | Durable provider effects | Duplicates |
| --- | ---: | ---: | ---: |
| A — new key | 6 | 6 | 3 |
| B — stable key | 6 | 3 | 0 |
| C — exclusive authority admission | 3 | 3 | 0 |

A filesystem barrier held both children until admission could be compared. The unique provider key was preserved for B; C allowed only one accepted claim. This proves a local transactional race guard with a cooperating provider. It is **not** a Cloudflare multi-region concurrency proof.

## Actual process-kill webhook recovery

The webhook suite executed 15 cases, three repetitions each of normal processing, SIGKILL before downstream effect, SIGKILL after effect/before acknowledgement, invalid signature and conflicting payload. Every final receiver database recorded exactly **one measurable downstream effect per event** despite repeated deliveries.

This exercise uses separate durable inbox and receiver databases and actual killed subprocesses. The receiver's UNIQUE(event_id) contract is essential. A social provider without such a contract may not allow safe, automatic continuation.

The 15 scripted adversarial proposals (different amount, recipient, new intent, stale epoch and duplicate inflight work) were rejected. Three additional retries after authority revocation were rejected. The agent in this test was deterministic, **not** a real model.

## Historical genuine Stripe evidence — refreshed GET-only

On 12 November 2026, authorised read-only calls to the existing Stripe **test** account independently retrieved the two original GBP 1.00 PaymentIntents from 22 October. Both retained `status=succeeded`, amount 100 pence, GBP currency, and `livemode=false`, with expected lab-operation metadata. The same paginated read-only path found **zero** PaymentIntents matching Day 2's unfinished operation `lab-d2-261112-589092` in a complete creation window.

This is fresh provider readback of historical objects; it is not a fresh payment experiment. The effective Stripe API version used for the original POST was not captured, and the test did not observe real idempotency-key pruning.

## Evidence integrity and independent verification boundary

A private evidence bundle seals **864 files** from the 120 matrix cells, nine concurrency runs, 15 webhook cases, three adversarial groups and Stripe readback. The verifier opens each independently persisted provider ledger and validates **147 experiment receipts** against the declared outcomes. A copied result was deliberately modified; the verifier rejected the digest mismatch. The original bundle continued to pass.

A SHA-256 manifest proves byte integrity relative to the owner-created manifest. The provider account readback is owner-controlled. **Neither constitutes third-party certification**, and source hashes do not prove a deployed historical Cloudflare worker's exact byte provenance.

## What remains beyond this pilot

- Fresh hosted Cloudflare corrected-run Stripe test with exact deployment provenance — **not verified**; the separately attempted Day 2 run stopped at preflight and cleaned up.
- Hosted Pi 1.4 eviction/alarms and competing retry/abort operations — **not exercised here**.
- Real Stripe lost-response, expiry/retention and changed-permission scenarios — **not exercised**, pending contribution qualification and bounded authorisation.
- Real downstream social-provider fulfilment and uncontrollable external receiver behaviour — **not demonstrated**.
- External independent reproduction and substantive peer or maintainer review — **not obtained**.
- arXiv cs.SE endorsement and submission — **no confirmed acceptance**, existing draft 8270945 retained.

## Scientific judgement

These observations **confirm engineering principles already discussed in the literature**: replay behaviour alone does not establish business correctness; a stable key alone does not grant current retry authority; refusing all uncertain work can sacrifice legitimate progress. The evidence is a **repeatable engineering replication and fault-injection pilot**, not a new algorithm or a globally novel result.

A stronger future research hypothesis concerns changing provider read authority, deduplication retention and authorisation across a real multi-step episode. Before making that claim, identify a specific current adapter guarantee and a discriminating counterexample against the strongest published recovery policy.

## Source references

- Stripe [API v1 idempotent requests](https://docs.stripe.com/api/idempotent_requests): stable-key behaviour, request parameter conflicts and finite pruning guarantee.
- Cloudflare [PiHarness recovery documentation](https://developers.cloudflare.com/agents/harnesses/pi/) and [Pi 1.4 changelog](https://developers.cloudflare.com/changelog/post/2026-10-22-pi-harness-pi-1-4/).
- [RetryBench (2026)](https://arxiv.org/abs/2610.15884) separates retry permission from recovery success.
- [Where Does Exactly-Once Live?](https://arxiv.org/abs/2609.29095), related simulated service and agent recovery research.
- Archived original experiment: [case study](case-study.md), [evidence guide](evidence-guide.md), [22 October execution record](execution-20261022.md).
