# Read-only comparison: recovery research and Post-Once provider states

**Reviewed:** 12 November 2026. **Source coverage:** local Post-Once checkout at `7e3c9a0073a2303a1621c8f6c033a81d7d6e83b9`, which was 76 commits behind its remote main at inspection. This is a **historical conceptual comparison**, not a live Post-Once release or production-readback claim.

This review only inspected documentation. No campaigns, provider credentials, schedules, D1, cloud runners, locks, releases or social posts were altered or queried for consequential execution.

## Observed semantics at that checkout

Source: `post-once/docs/PROVIDER_PIPELINES.md` and `post-once/docs/GUARDED_PUBLICATION_RECOVERY.md`.

| Existing declared state | Meaning of recorded evidence | Safe recovery classification |
| --- | --- | --- |
| `published_verified` | Create receipt and provider readback agree | Confirmed effect for the exact frozen intent, subject to source/readback identity |
| `published_unverified` | Create returned a provider ID but account readback could not be proven | Identified effect with incomplete verification; do not equate unreadable with absent |
| `ambiguous_effect` | Transport/5xx outcome means a write may have succeeded | Preserve a no-replay hold and obtain authoritative readback before any fresh dispatch |
| `partial_effect` | One or more parts definitely published; a later part definitely rejected | Preserve the successful prefix and reject replay of the logical publication |

The historical recovery command requires matching the complete continuation chain, frozen text, author, provider ID and parent; an explicit apply transaction is bound to preview evidence. It is idempotent at the ledger level and does not itself publish.

## Research-to-product implications

The new simulation scores new-key retry, stable-key retry, authority-aware reconciliation and blanket hold separately. This maps well to the existing Post-Once distinction between effect evidence and fresh permission to dispatch. It **does not prove** the current Post-Once implementation meets the simulation's C-policy properties.

The missing proof would be a live, exact-source observation that:

1. Freezes business intent and payload once, across crash recovery and competing workers.
2. Distinguishes confirmed provider receipts, unavailable readback, definitive no-effect and ambiguous effect without conflating them.
3. Never treats an insufficient read scope as proof the operation did not happen.
4. Holds a possibly successful write after revoked authority while recording that in-flight effects may still commit.
5. Returns a durable, independently verifiable readback and leaves the original ambiguous record intact.
6. Performs **no automatic social resend** merely because a test runner or agent restarted.

## Why no runtime check was run here

The inspected local Post-Once checkout was **behind remote main**. Its documentation cannot authenticate the active installed consumer, cloud deployment, D1 migration state, live provider permissions or today's task owner. Post-Once has its own ongoing protected release and acceptance programme. Introducing a research observer into its live runner would create competing work without improving this pilot's simulated provider evidence.

**Result:** The requested Post-Once lane is satisfied as a **read-only documentation comparison** only. Live permission/effect classification remains unverified and belongs to Post-Once's separate operational owner, not this research PR.
