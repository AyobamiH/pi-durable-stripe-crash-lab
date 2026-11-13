#!/usr/bin/env bash
# One repo-scoped owner-operated ephemeral GitHub Actions job.
# No persistent listener, host mounts, SSH agent, Docker socket or provider keys.
# Usage: ops/run-github-ephemeral-registration.sh EXACT_SHA RUN_ID JOB_ID
set -euo pipefail
umask 077
sha="$1"
run_id="$2"
job_id="$3"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid source commit SHA" >&2; exit 61; }
[[ "$run_id" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid Actions run identifier" >&2; exit 62; }
[[ "$job_id" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid Actions job identifier" >&2; exit 63; }
repo=AyobamiH/pi-durable-stripe-crash-lab
image=sha256:758e03ab2a553cf20f71c3495515d6966f125ca7bc1d94197597c4b25067e9f9
base="$HOME/.local/state/pi-durable-exact-source-ci/github-actions"
mkdir -p "$base"; chmod 700 "$base"
exec 9>"$base/registration-exclusive.lock"
flock -n 9 || { echo "An Actions research registration is already active" >&2; exit 64; }
test "$(gh api user --jq .login)" = AyobamiH
run=$(gh api "repos/$repo/actions/runs/$run_id")
job=$(gh api "repos/$repo/actions/jobs/$job_id")
node -e '
  const r=JSON.parse(process.argv[1]),j=JSON.parse(process.argv[2]),sha=process.argv[3],jobId=Number(process.argv[4]);
  if(r.head_sha!==sha||r.status!=="queued"||!["pull_request","push","workflow_dispatch"].includes(r.event)
     ||j.id!==jobId||j.run_id!==r.id||j.name!=="fixture-recovery"||j.status!=="queued"
     ||JSON.stringify(j.labels)!==JSON.stringify(["pi-research"]))process.exit(72);
  console.log(JSON.stringify({source:sha,run:r.id,job:j.id,status:j.status,labels:j.labels}));
' "$run" "$job" "$sha" "$job_id"
test "$(gh api "repos/$repo/actions/runners" --jq .total_count)" = 0 || { echo "Active or stale research runner exists" >&2; exit 65; }
test -z "$(docker ps -a --filter name=pi-research --format '{{.Names}}')" || { echo "Owned container exists" >&2; exit 66; }
docker image inspect "$image" >/dev/null
name="pi-research-reg-$(date -u +%Y%m%dT%H%M%SZ)-$job_id"
log="$base/$job_id-$sha.runner.log"
test ! -e "$log" || { echo "Registration attempt already recorded" >&2; exit 67; }
echo "BEGIN_GITHUB_EPHEMERAL run=$run_id job=$job_id sha=$sha at=$(date -u +%FT%TZ)" | tee "$log"
# Token flows directly over stdin. No token or credential is written to disk.
gh api -X POST "repos/$repo/actions/runners/registration-token" --jq .token |
docker run --rm --init -i --name "$name" --network bridge \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 3g --cpus 2 \
  "$image" bash -ec '
     set -euo pipefail
     IFS= read -r token
     test -n "$token"
     ./config.sh --unattended --ephemeral \
       --url https://github.com/AyobamiH/pi-durable-stripe-crash-lab \
       --token "$token" --name pi-research-web-ephemeral \
       --labels pi-research --work _work --disableupdate
     unset token
     exec ./run.sh
  ' >> "$log" 2>&1
echo "GITHUB_RUNNER_EXIT code=0 at=$(date -u +%FT%TZ)" | tee -a "$log"
