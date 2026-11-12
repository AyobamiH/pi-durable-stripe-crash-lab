#!/usr/bin/env bash
# One bounded, repository-specific GitHub Actions job on the owner's machine
# in a disposable Docker container. No persistent runner service.
# No host mounts, SSH keys, provider secrets or Docker socket.
# Network access is required for GitHub/npm; egress is not LAN-restricted.
set -euo pipefail
umask 077
repo="AyobamiH/pi-durable-stripe-crash-lab"
label="pi-research"
image="sha256:758e03ab2a553cf20f71c3495515d6966f125ca7bc1d94197597c4b25067e9f9"
name="pi-research-web-$(date -u +%Y%m%dT%H%M%SZ)-$$"
if [ "$(gh api user --jq .login)" != "AyobamiH" ]; then
  echo "CI not authorised for current GitHub identity" >&2; exit 51
fi
if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "Pinned runner image is not available locally" >&2; exit 52
fi
if docker ps --format '{{.Names}}' | grep -E '^pi-research-web-' >/dev/null; then
  echo "Another pi-research worker already exists; refuse duplicate" >&2; exit 53
fi
# Repository-scoped JIT token is sent directly over stdin, never logged.
# The runner unregisters after one completed job.
gh api --method POST "repos/$repo/actions/runners/generate-jitconfig" \
  -f "name=$name" -F runner_group_id=1 -f "labels[]=$label" -f work_folder=_work \
  --jq .encoded_jit_config |
docker run --rm -i --init --name "$name" --network bridge \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 512 \
  --memory 3g --cpus 2 \
  "$image" bash -ec 'IFS= read -r cfg; test -n "$cfg"; exec ./run.sh --jitconfig "$cfg"'
