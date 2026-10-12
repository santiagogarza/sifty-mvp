#!/usr/bin/env bash
# Probe a deployed Sifty: public pages render and /api/health is green.
# Usage: scripts/smoke-deployment.sh https://sifty-app.vercel.app
# Exit 1 if any hard probe fails. Used by the `smoke` CI job after a
# production deployment. For a Vercel-Authentication-protected preview, set
# SMOKE_BYPASS_SECRET to the project's protection-bypass secret.
set -euo pipefail

base="${1:?base url}"
case "$base" in
  https://*|http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "refusing non-https base url: $base"; exit 2 ;;
esac
extra=()
if [[ -n "${SMOKE_BYPASS_SECRET:-}" ]]; then
  extra=(-H "x-vercel-protection-bypass: ${SMOKE_BYPASS_SECRET}")
fi
fail=0

# probe PATH EXPECTED_CODE [MUST_CONTAIN] [soft]
# soft: report but do not fail (for pages that are not on production yet).
probe() {
  local path="$1" expect="$2" must_contain="${3:-}" soft="${4:-}"
  local code body
  body=$(mktemp)
  code=$(curl -sS -L -o "$body" -w '%{http_code}' --max-time 30 "${extra[@]}" "$base$path" 2>/dev/null || true)
  code="${code:-000}"
  if [[ "$code" != "$expect" ]]; then
    if [[ "$soft" == "soft" ]]; then
      echo "warn $path -> $code (expected $expect; soft probe)"
    else
      echo "FAIL $path -> $code (expected $expect)"; head -c 400 "$body"; echo; fail=1
    fi
  elif [[ -n "$must_contain" ]] && ! grep -q -- "$must_contain" "$body"; then
    echo "FAIL $path -> $code but body lacks '$must_contain'"; head -c 400 "$body"; echo; fail=1
  else
    echo "ok   $path -> $code"
  fi
  rm -f "$body"
}

probe /            200 "Sifty"
probe /pricing     200 "Sifty"
probe /sign-up     200 "Sifty"
probe /sign-in     200 "Sifty"
probe /api/health  200 '"ok":true'

echo "--- /api/health"
curl -sS --max-time 30 "${extra[@]}" "$base/api/health" || true
echo
echo "--- security headers on /"
curl -sSI --max-time 30 "${extra[@]}" "$base/" | grep -iE '^(strict-transport-security|x-content-type-options|x-frame-options|referrer-policy|permissions-policy):' || true

exit $fail
