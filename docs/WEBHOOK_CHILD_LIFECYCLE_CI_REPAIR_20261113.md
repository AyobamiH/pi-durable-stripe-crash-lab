# Webhook SIGKILL test: child-process result classification and CI repair

**Source:** successor branch to the verified 12 November 2026 recovery pilot. Original release tag and earlier failed CI logs remain intact.

## What GitHub actually reported

The merged research main job [43322983354 / 131548165545](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/actions/runs/43322983354/job/131548165545) executed the original TypeScript, **35 unit tests**, both Wrangler E2Es, replay checks, 120-cell simulated recovery matrix and 9 concurrency cases successfully. It then failed in `experiments/recovery-contract/webhook-e2e.mjs` at the final repeated delivery's `assert.equal(duplicated.status, 0)` (line 85 of the tested baseline):

```
AssertionError: null !== 0
```

The historical script used `spawnSync(... timeout: 15000)` and only retained `status`, `signal` and bounded stdout/stderr. Because the assertion printed just the exit code and the child result was not persisted before it failed, **the actual reason for the null status (timeout, signal, execution failure) is not recoverable from the archived job log**. Never assume this was an application duplicate-effect error, a real provider failure or definitely a timeout. The adversarial test was skipped because this step failed.

## Root test-design defect and correction

The harness incorrectly treated one raw `status` field as sufficient evidence of normal completion; a null status is valid after a signal or timeout and needs separate classification.

The new `subprocess-receipt.mjs` captures the exit code, signal, exception code, explicit timeout flag, elapsed time, configured bound and truncated output. It uses a bounded 60-second child timeout to accommodate slower, clean CI hosts without permitting an indefinite process. Each attempt is appended to an owner-private per-scenario `child-outcomes.jsonl` **before assertion**. A child that times out fails with its `ETIMEDOUT` classification and the persisted inbox/receiver state; it is **not retried blindly or marked successful**.

An injected SIGKILL is accepted only when there is a SIGKILL signal **and no timeout/error**, so a child killed due to a process timeout cannot masquerade as a successful fault-injection control. All expected normal or rejected outcomes require matching real exit codes and no spawn error.

## Negative controls and E2E

`subprocess-receipt.test.mjs` proves:

- successful exit with code 0;
- deliberate SIGKILL with null exit code and no `ETIMEDOUT`;
- bounded timeout with explicit `ETIMEDOUT` and null exit code, rejected by the success assertion;
- ordinary nonzero exit rejected;
- unbounded timeout configuration rejected.

The GitHub workflow and the separate owner-local exact-source CI runner now run these checks before the real subprocess webhook suite. The original sender/receiver idempotency implementation and its durable business semantics are unchanged; this is a **test observability and robustness correction**.

The exact-source acceptance remains: original Pi 1.3/Harness tests, two local SIGKILL crash boundaries, safe/unsafe replay, 120-case recovery matrix, 9 real concurrent process runs, 15 receiver-effect webhook cases and 3 adversarial groups. Full GitHub CI acceptance on the corrected head must be read back; local success alone does not establish GitHub provider acceptance.

## Research and provider limits

No real Stripe payment, webhook subscription or Cloudflare hosted deployment is initiated by this change. The receiver is a cooperating SQLite stub with durable unique event IDs; it is not proof of exactly-once behaviour for an arbitrary external fulfilment provider. The original observed GitHub failure must be retained alongside any newly passing run.
