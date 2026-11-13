#!/usr/bin/env bash
# One owner-local CI job on a PUBLIC exact source commit; no GitHub-hosted minutes.
# No host mounts, Docker socket, cloud/provider keys, paid models or production changes.
# Usage: ops/run-local-exact-source-ci.sh FULL_SHA OWNER_BRANCH
set -euo pipefail
umask 077
sha="$1"
branch="$2"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid exact SHA" >&2; exit 61; }
[[ "$branch" =~ ^(main|agent/[a-z0-9][a-z0-9-]{2,80})$ ]] || { echo "Invalid owner branch" >&2; exit 62; }
repo=AyobamiH/pi-durable-stripe-crash-lab
image=sha256:758e03ab2a553cf20f71c3495515d6966f125ca7bc1d94197597c4b25067e9f9
base="$HOME/.local/state/pi-durable-exact-source-ci"
mkdir -p "$base"; chmod 700 "$base"
exec 9>"$base/ci-exclusive.lock"
flock -n 9 || { echo "Another research CI job owns the lock" >&2; exit 63; }
remote_sha=$(git ls-remote "https://github.com/$repo.git" "refs/heads/$branch" | awk '{print $1}')
test "$remote_sha" = "$sha" || { echo "Remote branch moved or SHA mismatch" >&2; exit 64; }
docker image inspect "$image" >/dev/null
short=$(printf '%.11s' "$sha")
name="pi-research-exact-$short"
test -z "$(docker ps -a --filter name="$name" --format '{{.Names}}')" || { echo "Owned container exists" >&2; exit 65; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
log="$base/$stamp-$sha.log"
receipt="$base/$stamp-$sha.receipt.json"
test ! -e "$log" && test ! -e "$receipt"
printf 'SOURCE=%s BRANCH=%s START=%s\n' "$sha" "$branch" "$(date -u +%FT%TZ)" | tee "$log"
set +e
docker run --rm --init --name "$name" --network bridge \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 --memory 3g --cpus 2 \
  --env EXPECTED_SHA="$sha" --env VERIFIED_BRANCH="$branch" \
  --env GATEWAY_MODE=fixture --env STRIPE_TEST_SECRET_KEY= --env STRIPE_TEST_KEY_FILE= --env NODE_ENV=test \
  "$image" bash -ec '
    set -euo pipefail
    git clone --quiet --depth 1 --single-branch --branch "$VERIFIED_BRANCH" \
      https://github.com/AyobamiH/pi-durable-stripe-crash-lab.git /home/runner/research
    cd /home/runner/research
    test "$(git rev-parse HEAD)" = "$EXPECTED_SHA"
    echo "CI_VERIFIED_SHA=$EXPECTED_SHA"
    echo "CI_PHASE install"; npm ci --ignore-scripts --no-audit --no-fund
    echo "CI_PHASE typecheck"; npm run typecheck
    echo "CI_PHASE unit"; npm test
    echo "CI_PHASE after_provider"; npm run test:e2e
    echo "CI_PHASE before_provider"; LAB_SCENARIO=before-provider npm run test:e2e
    echo "CI_PHASE replay"; node scripts/replay-e2e.mjs
    echo "CI_PHASE matrix"; node experiments/recovery-contract/run.mjs --output .evidence/recovery/ci-matrix
    echo "CI_PHASE concurrency"; node experiments/recovery-contract/concurrency-e2e.mjs --output .evidence/recovery/ci-concurrency
    echo "CI_PHASE subprocess_lifecycle"; node --test experiments/recovery-contract/subprocess-receipt.test.mjs
    echo "CI_PHASE webhook"; node experiments/recovery-contract/webhook-e2e.mjs --output .evidence/recovery/ci-webhook
    echo "CI_PHASE adversarial"; node experiments/recovery-contract/adversarial-e2e.mjs --output .evidence/recovery/ci-adversarial
    node --input-type=module -e '\''
      import assert from "node:assert/strict"; import fs from "node:fs";
      const pre=".evidence/recovery/";
      const get=n=>JSON.parse(fs.readFileSync(pre+n+"/summary.json","utf8"));
      const m=get("ci-matrix"),c=get("ci-concurrency"),w=get("ci-webhook"),a=get("ci-adversarial");
      assert.deepEqual([m.runCount,c.runs,w.cases,a.repetitions],[120,9,15,3]);
      assert.equal(m.counts["C-authority-ledger"].unsafe,0);
      console.log("CI_VERIFIED_MATRIX 120/9/15/3");
    '\''
    echo "CI_PHASE hosted_pi14_evidence"; node experiments/pi14-hosted-inert/verify-evidence.mjs
    echo "EXACT_SOURCE_LOCAL_CI_PASSED"
  ' >> "$log" 2>&1
code=$?
set -e
sum=$(sha256sum "$log" | awk '{print $1}')
python3 - "$receipt" "$sha" "$branch" "$code" "$sum" <<'PY'
import json,os,sys,datetime
out,sha,branch,code,digest=sys.argv[1:]
with open(out,"x") as f:
 json.dump({"utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"repository":"AyobamiH/pi-durable-stripe-crash-lab","sha":sha,"branch":branch,"mode":"owner-local-isolated-Docker-NOT-GitHub-Actions","noProviderWrites":True,"exitCode":int(code),"passed":int(code)==0,"logSha256":digest},f,indent=2)
 f.write("\n")
os.chmod(out,0o600)
PY
echo "CI_EXIT=$code LOG=$log RECEIPT=$receipt"
exit "$code"
