# Repository-scoped, zero-hosted-minute CI

The original GitHub Actions job for [PR #2](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/pull/2) failed before a runner was allocated and before any workflow step ran. The [failed job](https://github.com/AyobamiH/pi-durable-stripe-crash-lab/actions/runs/43201874037/job/131127070004) contains no executable step log; that is **not** a failed TypeScript or recovery test.

## Implementation

The repository's existing `.github/workflows/fixture-recovery.yml` now targets an owner-operated ephemeral runner labelled `pi-research` instead of `ubuntu-latest`. The workflow contains the **original pinned Pi 1.3 fixture checks** and all four recovery-contract test suites. The JIT advertised only the custom pi-research label, not the default Linux/X64/self-hosted labels; the workflow selector matches that repository-specific label.

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


## Observed GitHub Actions blocker (12 November 2026)

The JIT runner initially registered and connected, but GitHub invalidated its session before executing a step. The broker reported TaskAgentSessionExpiredException: Runner session is invalid and Registration ... was not found. The runner registry became empty and the workflow job remained queued with zero executed steps. A second registration-token route stopped before issuing a token because GitHub's API TLS handshake timed out.

These are remote admission observations, not failing source tests. The JIT script remains diagnostic only; it is **not currently accepted as a working CI executor**. Do not repeatedly register runners or describe a queued job as passed.

## Verified exact-source local fallback

Run the pinned container without relying on GitHub's runner registration service:

~~~sh
bash ops/run-local-exact-source-ci.sh FULL_40_CHARACTER_SHA agent/pi-research-days3-6-20261112
~~~

The command checks the owner's exact remote branch HEAD, acquires a single-run lock, clones public source at that SHA and runs the same source test commands in the pinned unprivileged Docker image. It writes a private exit-code receipt and SHA-256 log under ~/.local/state/pi-durable-exact-source-ci. There are no host mounts, Docker socket, GitHub token, Stripe credentials or production actions inside the test container. Docker bridge allows network egress to public GitHub/npm; this is not a sandbox for arbitrary hostile source.

A private execution of this recipe passed against signed commit 5eb655a4a57b00964ac19b4d06c0eb277a92b26b: lockfile installation, TypeScript, all 35 original unit tests, both Wrangler crash E2Es, replay comparison, 120 recovery matrix cells, nine concurrent runs, 15 SIGKILL webhook cases and three adversarial groups. Its log SHA-256 is 1619f4388944bdd1b7e3ddddccc1b3b2b164aa46a0bfc0e03357c6778b3abbc0.

**Evidence separation:** an owner-local success must use its own local CI status context. It neither alters the queued fixture-recovery GitHub Actions result nor proves GitHub provider acceptance. A later source revision must be re-tested at its exact SHA.


## Working GitHub Actions registration-token route (13 November)

The earlier JIT workflow produced invalidated sessions. The subsequent **repository-scoped, ephemeral registration-token** route successfully assigned and executed the 12 November merged-main job, including the original Pi 1.3 and new recovery suites. That CI job uncovered a real **test-harness observability defect** in the webhook child result at line 85; it did not complete the entire suite.

Use the new owner-scoped command for one already-queued exact job:

    bash ops/run-github-ephemeral-registration.sh FULL_SIGNED_SHA EXISTING_RUN_ID EXISTING_JOB_ID

The script confirms the exact GitHub run SHA, one queued fixture-recovery job, custom pi-research label, owner identity, no existing research runner/container, and the pinned runner image before requesting a registration token. It transfers the short-lived token directly through a pipe into an unprivileged, disposable container; no host secrets, Docker socket or machine directories are mounted. Job results must be independently retrieved from the GitHub Actions API. Unlike the owner-local CI script, this route produces genuine GitHub workflow steps.

It is intentionally one-shot and does not run when the owning machine is disconnected. Do not start multiple listeners for one job or use the legacy JIT route merely to obtain a green status. If the provider invalidates a registration or networking fails, retain the actual job state and stop.
