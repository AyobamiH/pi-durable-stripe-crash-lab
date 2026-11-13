# Hosted Pi 1.4 inert lifecycle — source and evidence

This folder preserves the **exact worker source** (SHA-256 `754080562a6d5d2fcfa084256b0ca14aaec677e1aefba73f621f4516adf4b58b`) and pinned dependencies used for one real Cloudflare-hosted observation on **13 November 2026**.

The source adapts the original 25 October local Pi 1.4 test. It uses Agents 0.30.1, Pi Durable 1.4.0 and a **deterministic model substitute**. Its single tool is inert and replay-safe. There is no Stripe provider call, payment method, paid inference or customer data.

## Offline checks

From this source tree:

```sh
node experiments/pi14-hosted-inert/verify-evidence.mjs
```

The verifier checks the redacted readback manifest and source/package-lock SHA-256 hashes, the two distinct observed Durable Object instances, the `parked` transition, terminal retry completion, the absence of a proven abort terminal result and documented Worker/secret teardown. No Cloudflare credentials or network requests are used for this verification.

## Live reproduction

The template `wrangler.template.jsonc` is **not a deployable production configuration**: `workers_dev=false`, the Worker name contains a mandatory replacement marker, and allowed operation IDs must be changed to fresh test-only IDs. A separate owner must authorise a new isolated Worker, temporary bearer secret, bounded operation and deletion before enabling the public test endpoint. Never replay old operation IDs or reuse the original Durable Object namespace.

An authenticated GET of `/status?id=...` reports the instance, tool-entry count, pending/parked work and alarm metadata. Only the owner-controlled environment may call `/start`, `/crash`, `/release`, `/retry` or `/abort`. A missing pre-abort marker must **not** be interpreted as a clean failed-to-crash event; require independent instance and state readbacks.

## Observed results

The retry operation started, endured two hosted DO terminations, reached `parked`, then explicitly released/retried and independently completed as `done`, with three tool entries and an empty pending queue. The separate abort operation started and remained `running` on its last verified status; a terminal abort was **not established**.

The isolated Worker and its ephemeral secret were deleted after testing. The workers.dev URL returned HTTP 404 and the local token file was deleted. Owner-private original transport and control receipts were not published.

Read the [bounded full report](../../docs/PI14_HOSTED_LIFECYCLE_OBSERVATION_20261113.md) and [redacted evidence](../../docs/evidence/pi14-hosted-inert-20261113/manifest.json). This is **author-observed hosted lifecycle proof**, not an independent third-party attestation, not unattended alarm-only wake proof and not a real-provider exactly-once guarantee.
