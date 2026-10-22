#!/usr/bin/env bash
# Hidden terminal input or a private test-key file; no live-mode fallback.
set -euo pipefail
umask 077

if [[ -n "${STRIPE_TEST_KEY_FILE:-}" ]]; then
  cd "$(dirname "$0")/.."
  GATEWAY_MODE=stripe-test exec node scripts/e2e.mjs
fi

if [[ -z "${STRIPE_TEST_SECRET_KEY:-}" ]]; then
  if [[ ! -t 0 ]]; then
    echo "A secure terminal is required to enter the Stripe TEST secret key." >&2
    exit 2
  fi
  IFS= read -r -s -p "Stripe TEST secret key (sk_test_...; hidden input): " STRIPE_TEST_SECRET_KEY
  printf '\n'
fi

if [[ "$STRIPE_TEST_SECRET_KEY" != sk_test_* ]] || [[ "${#STRIPE_TEST_SECRET_KEY}" -lt 20 ]]; then
  echo "Refusing operation: only a verified sk_test_ key is permitted." >&2
  exit 2
fi

export STRIPE_TEST_SECRET_KEY
trap 'unset STRIPE_TEST_SECRET_KEY' EXIT
cd "$(dirname "$0")/.."
GATEWAY_MODE=stripe-test npm run test:e2e
