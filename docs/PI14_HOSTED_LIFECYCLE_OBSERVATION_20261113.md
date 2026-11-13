# Hosted Pi 1.4 recovery: verified retry, incomplete abort

**Observation:** 13 November 2026 UTC. **Environment:** actual hosted Cloudflare Durable Object with Cloudflare Agents 0.30.1, Pi Durable 1.4.0, Wrangler 4.151.2, a deterministic faux model and one inert replay-safe tool. **No Stripe binding or payment call.**

## Scope and source

An isolated Worker, `pi14-hosted-lab-ca58b4f6`, was deployed in the account previously used by the lab, using an entirely new `Probe` Durable Object namespace. Its source is retained at `experiments/pi14-hosted-inert/worker.js` and SHA-256 is:

`754080562a6d5d2fcfa084256b0ca14aaec677e1aefba73f621f4516adf4b58b`

It was adapted explicitly from the 25 October local Pi 1.4 lifecycle probe; its original archive was left unchanged. The initial Worker version was `cec72591-7c39-40c4-b914-13cad9c89698`, though binding the later control secret may have created a subsequent version. An owner-private access token was provisioned and the only allowed operation IDs were frozen. Anonymous access was independently observed to return HTTP 401, and an authenticated request for an unapproved ID returned 403.

## The hosted retry observation

1. An authorised POST for `probe-nov13-ca58b4f6-retry` was accepted and independent status GET reported the inert tool entered once, a live pending operation and `completed=false`.
2. One controlled `/crash` request was sent. The endpoint returned an HTML HTTP 500 error; subsequent readback showed a **different instance UUID** and tool count two. The attempted `crashes` marker that was written immediately before the termination did not survive. This is a meaningful observation: **writing a marker before calling the object abort primitive is not enough to establish persisted pre-abort provenance**. The marker absence is *not* proof the crash never happened.
3. One further bounded crash was sent. A fresh GET showed a **third instance** and Pi's pending operation state `parked`, with `completed=false` and tool count two.
4. Separate one-shot POST requests to `/release` and `/retry` both returned HTTP 200; the retry reported `retried=true`.
5. Independent GETs returned `completed=true`, an **empty pending queue**, `calls=3`, and the terminal result `status=done`, `text=completed`.

This demonstrates an **actual Cloudflare-hosted** two-interruption Pi 1.4 `parked → retry → done` lifecycle, not just local Wrangler replay. It uses a deterministic faux provider; the three tool-entry counter increments are **not three external effects**.

## The separate abort operation

A second fixed ID, `probe-nov13-ca58b4f6-abort`, was accepted. The inert tool entered once and a GET found `running`, `completed=false`, and one pending operation. The intended explicit abort pathway could not be completed with verified command/readback evidence in this session. **No terminal abort result is claimed.** This remains a real experimental gap distinct from the successful retry.

## Teardown

The temporary control secret was individually deleted through Wrangler with a successful response, followed by deletion of the isolated test Worker itself. Subsequent Wrangler `deployments list` returned a not-found/nonzero response and unauthenticated GET to the public workers.dev route returned **HTTP 404**. The owner-private source control-token file was deleted. No legacy Pi 1.3/October lab Worker, Post-Once product or customer data was altered.

Owner-private files preserve the original responses, the missing crash counter, all authorised GET observations, test configuration and the deployment/cleanup diagnostics. The non-secret readback excerpts are copied to `docs/evidence/pi14-hosted-inert-20261113/`.

## Evidence and claim boundaries

- A natural alarm-only wake was **not** established: readback probes themselves can wake a Durable Object. The alarm timestamp is an observed metadata field, not evidence of autonomous execution.
- The sample includes **one** completed hosted retry path and one begun-but-unfinished abort path, not a statistically meaningful production reliability sample.
- No actual Stripe test-mode provider call occurred here, and the hosted Pi 1.3 new-payment replication remains incomplete. This does not validate irreversible external side-effect safety, credential revocation, readback unavailability, or provider idempotency-pruning behaviour.
- Crash-marker persistence was not verified and is explicitly documented as failing to survive the first object abort; the test must not claim it did.
- Source bytes and owner-private readbacks were recorded, but independently signed deployment-byte attestation and external third-party reproduction remain outstanding.

**Result:** Hosted Pi 1.4 retry lifecycle verified, restricted to an isolated inert fixture; hosted abort/unattended alarm and real external effects remain unverified.
