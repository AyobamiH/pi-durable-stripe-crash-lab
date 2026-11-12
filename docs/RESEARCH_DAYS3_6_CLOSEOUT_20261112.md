# Days 3–6 engineering closeout — 12 November 2026

Canonical work programme: [GitHub issue #1](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/issues/1). This checkpoint is tied to the actual tests, rather than a claim that six calendar days elapsed.

## Evidence-backed completion

| Workstream | Outcome |
| --- | --- |
| Provider uncertainty protocol | Four policies × 10 faults × 3 repetitions, **120** fixture cases; independent provider SQLite reads |
| New-key known-bad control | **24/30** modelled scenarios unsafe; **21** duplicates total; duplicates and revoked dispatches correctly detected |
| Original-key control | **9/30** unsafe; including *simulated* expired cache and withdrawn authority |
| Authority-aware control | **0/30** unsafe inside cooperating simulation; **18/30** confirmed-progress and three explicitly unresolved cases |
| Hold-only control | No duplicates, but **27/30** unresolved outcomes and only three confirmed-progress cases |
| Actual competing workers | **9** two-process runs with a synchronisation barrier and independently opened durable receiver |
| Downstream webhook effects | **15** SIGKILL/redelivery/control cases, each ended with one independently observed downstream effect |
| Adversarial changed-intent proposals | **15/15** denied, plus **3/3** retries after revocation denied |
| Real historical Stripe | Two original GBP 1.00 test-mode PaymentIntents still succeeded in fresh GET-only readback; aborted Day 2 scope had zero matching intents in complete paginated window |
| Integrity verification | Sealed owner-private **864-file** bundle; 147 independently reopened SQLite ledgers; corruption negative control failed as intended |
| Clean-room reproduction | All four suites reproduced from copied source with no third-party packages, credentials or network |
| Post-Once translation | Read-only conceptual comparison completed against a local **outdated** checkout; no runtime/production acceptance claimed |

## Explicit limits

- Retention-time expiry was injected synthetically. Stripe's actual key pruning behaviour was **not observed**.
- The real-provider lost-response and permission-revocation experiment remains conditional on research qualification and its exact account/operation approval.
- A real hosted Cloudflare Pi 1.4 eviction/competing operator test has **not** been run; the earlier Day 2 hosted Pi 1.3 attempt stopped at preflight with cleanup.
- The original historical deployment byte-level provenance and effective original Stripe POST API revision remain incomplete.
- Real social-provider writes and real downstream fulfilment are not part of these test results.
- arXiv's existing draft 8270945 remains under the cs.SE endorsement gate absent a fresh signed-in status observation; Outlook search surfaced original requests but no confirmation.
- Cloudflare/awesome-agents upstream publication is unverified. Do not invent a discussion ID, independent maintainer sign-off or external reproduction.
- The original extended 18 October chat-writing prompt and full direct conversation URL remain unrecovered.

## Publishable position

The outcome is a **reproducible engineering validation**, not an academic discovery or benchmark of real models. The central lesson is that stopping an unsafe tool replay is not equivalent to proving an authorised business outcome. A stable idempotency key has a documented finite scope and does not grant fresh permission after cancellation. Conversely, holding all uncertain operations protects safety at the cost of leaving resolvable work incomplete.

Publish the result with source and an independently runnable harness. Maintain the first Pi 1.3 paper and the Pi 1.4 lifecycle article as separate prior baselines. Do not modify the first article to make the new result appear to have been part of October's run.

## Future experiment admission

The retained originality gate from `Recovery_Contract_Experiment_Plan.md` remains **NO-GO** for a broad claimed breakthrough until a specific existing adapter guarantee, differentiating real-provider boundary, strongest-policy comparison, independent scoring and replication route are established. A carefully labelled replication can still be worthwhile without asserting novelty, but must receive its own bounded provider-effects authority and test budget.

## Artefact pointers

- Code: `experiments/recovery-contract/`
- Technical analysis: `docs/RECOVERY_CONTRACT_PILOT_20261112.md`
- Public redacted receipt: `docs/RESEARCH_RECOVERY_EVIDENCE_SUMMARY_20261112.json`
- Product translation: `docs/POST_ONCE_READONLY_COMPARISON_20261112.md`
- Private raw bundle (owner host only): `.evidence/recovery/research-days3-6-sealed-v1/`
- Private bundle SHA-256: `672eb91ba58940c98bf96a40f6e47ee54f476917d02578bdee6a66f6b8e3e0fe`
- Immutable prior published release: `research-2026-10-22` at commit `74a4521da15f4bec16e207e91323b426ef02b32d`

## Delivery status

**Implemented and tested:** all fixture matrix, OS-process concurrency, SIGKILL webhook recovery, adversarial controls, redacted evidence summary and archive-integrity controls.

**Not yet proven:** fresh hosted provider pass, real retention expiry, genuine provider authority changes, current Post-Once production validation, independent reproduction, external endorsement and arXiv submission. These are not silently treated as completed simply because the six-day pilot code exists.
