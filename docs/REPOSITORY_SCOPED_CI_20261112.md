# Repository-scoped, zero-hosted-minute CI

The original GitHub Actions job for [PR #2](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/pull/2) failed before a runner was allocated and before any workflow step ran. The [failed job](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/actions/runs/43201874037/job/131127070004) contains no executable step log; that is **not** a failed TypeScript or recovery test.

## Implementation

The repository's existing `.github/workflows/fixture-recovery.yml` now targets an owner-operated ephemeral runner labelled `pi-research` instead of `ubuntu-latest`. This is one job containing the **original pinned Pi 1.3 fixture checks** and all four recovery-contract test suites:

1. Node 24 install from committed npm lockfile, static TypeScript and 35 original unit tests.
2. Original Wrangler SIGKILL/restart after-provider and before-provider fixture experiments.
3. Original read-only safe/unsafe replay control.
4. 120 synthetic-policy matrix cells, 9 two-process admission cases, 15 SIGKILL webhook cases and 3 adversarial cases.

The checkout and Node setup actions use full commit SHAs, and checkout does not persist Git credentials. The job only runs for same-repository PRs authored by `AyobamiH` or for an explicit owner main/dispatch event. No Stripe key, Cloudflare credential, provider mutation or paid model is passed into the runner; `GATEWAY_MODE=fixture` is fixed.

On the authorised owner machine, the command `bash ops/run-one-off-ci.sh` registers a **repository-scoped JIT runner** for exactly one job. It uses an existing pinned image digest in a disposable Docker container with no host mounts or Docker socket, no added Linux capabilities, no new privileges, bounded CPU/memory/PIDs and default unprivileged runner UID. The JIT configuration flows over stdin and is not stored in Git or written to a host log. After the job, GitHub removes the runner registration and Docker removes the container.

**Isolation limit:** Docker bridge allows egress for GitHub and public packages; it is not a verified LAN-ejection/firewall sandbox. Only the owner's reviewed same-repository workflow is eligible. This does not replace the global ClawSweeper CI controller, change shared fleet policy, buy hosted minutes or create another long-lived service.

## Verification and operational use

For each PR or main event, confirm the exact SHA, registered job status and available local resources; then run the one-off listener. Retrieve GitHub's actual job log and verify each step's conclusion against that SHA. Record the job ID and final status in the project closeout. A local test log or status published by the owner is **not** a replacement for an actual GitHub Actions run.

If the runner cannot start, preserve the pending job and its recorded source; don't silently switch back to paid GitHub-hosted execution. A stale or interrupted JIT session must be reconciled by runner registry and job readback before registering another runner.

This release documents a manually activated, zero-hosted-minute CI route. It does not falsely claim an always-on queue consumer, cloud availability while `web` is offline, or a maintenance-free CI platform.
