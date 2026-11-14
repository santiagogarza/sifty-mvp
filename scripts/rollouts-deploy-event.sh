#!/usr/bin/env bash
# Reports a production deploy to Cursor Rollouts so it can check the change
# against telemetry after it ships. https://cursor.com/docs/rollouts
#
#   rollouts-deploy-event.sh start            create the deployment (started)
#   rollouts-deploy-event.sh finish <status>  append completed/failed/aborted
#
# Never fails the caller: a missing key or an API error only logs a warning.
# `start` writes ROLLOUTS_DEPLOYMENT to $GITHUB_ENV for the `finish` step.
set -uo pipefail

ENVIRONMENT="${ROLLOUTS_ENVIRONMENT:-production}"
SERVICE="${ROLLOUTS_SERVICE:-sifty-app}"
API="https://api.cursor.com/factory.v1.DeploymentsService"
ACTOR="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-santiagogarza/sifty-mvp}/actions/runs/${GITHUB_RUN_ID:-local}"

warn() { echo "::warning::rollouts: $*"; exit 0; }

[ -n "${CURSOR_API_KEY:-}" ] || warn "CURSOR_API_KEY is not set; skipping deploy event"

token=$(curl -sS --max-time 20 -X POST https://api2.cursor.sh/auth/exchange_user_api_key \
  -H "Authorization: Bearer $CURSOR_API_KEY" -H "Content-Type: application/json" -d '{}' \
  | jq -r '.accessToken // empty') || true
[ -n "$token" ] || warn "could not exchange CURSOR_API_KEY for a token"

call() {
  curl -sS --max-time 20 -X POST "$API/$1" \
    -H "Authorization: Bearer $token" -H "Content-Type: application/json" \
    -H "Connect-Protocol-Version: 1" -d "$2"
}

case "${1:-}" in
  start)
    # Idempotent bootstrap: "already exists" responses are expected after the first run.
    call CreateEnvironment "{\"environmentId\":\"$ENVIRONMENT\",\"environment\":{\"displayName\":\"$ENVIRONMENT\"}}" >/dev/null || true
    call CreateService "{\"serviceId\":\"$SERVICE\",\"service\":{\"displayName\":\"$SERVICE\"}}" >/dev/null || true

    body=$(jq -nc --arg src "https://github.com/${GITHUB_REPOSITORY:-santiagogarza/sifty-mvp}" \
      --arg env "environments/$ENVIRONMENT" --arg svc "services/$SERVICE" \
      --arg ver "${GITHUB_SHA:?}" --arg actor "$ACTOR" \
      '{deployment:{deploySourceUri:$src,environment:$env,service:$svc,deployVersion:$ver},event:{started:{},actor:$actor}}')
    response=$(call CreateDeployment "$body") || warn "CreateDeployment request failed"
    name=$(printf '%s' "$response" | jq -r '.deployment.name // empty' 2>/dev/null)
    [ -n "$name" ] || warn "CreateDeployment returned no deployment: $response"
    echo "rollouts: started $name for ${GITHUB_SHA:0:7}"
    if [ -n "${GITHUB_ENV:-}" ]; then echo "ROLLOUTS_DEPLOYMENT=$name" >> "$GITHUB_ENV"; fi
    ;;
  finish)
    [ -n "${ROLLOUTS_DEPLOYMENT:-}" ] || warn "no deployment was started; skipping finish"
    case "${2:-}" in
      success) event='{"completed":{"succeeded":{}}}' ;;
      cancelled) event='{"aborted":{}}' ;;
      *) event='{"completed":{"failed":{"message":"production smoke check failed"}}}' ;;
    esac
    body=$(jq -nc --arg name "$ROLLOUTS_DEPLOYMENT" --argjson ev "$event" --arg actor "$ACTOR" \
      '{name:$name,event:($ev + {actor:$actor})}')
    call AppendDeploymentEvent "$body" >/dev/null || warn "AppendDeploymentEvent request failed"
    echo "rollouts: ${2:-failure} for $ROLLOUTS_DEPLOYMENT"
    ;;
  *)
    warn "usage: $0 start | finish <success|failure|cancelled>"
    ;;
esac
