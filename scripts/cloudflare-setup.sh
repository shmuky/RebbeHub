#!/usr/bin/env bash
# Makes sure the R2 buckets RebbeHub keeps files in exist, creating any
# that are missing. Safe to run again and again: the manual deploy
# workflow runs it every time.
#
#   CLOUDFLARE_API_TOKEN   an API token (see docs/deploy.md for its permissions)
#   CLOUDFLARE_ACCOUNT_ID  the account's id
#
# Resources:
#   R2 bucket  rebbehub-public        files that may be served
#   R2 bucket  rebbehub-preservation  files kept but never served (no Worker binds it)
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"

# CLOUDFLARE_API_BASE only points the script at a stand-in API in tests.
API="${CLOUDFLARE_API_BASE:-https://api.cloudflare.com/client/v4}/accounts/${CLOUDFLARE_ACCOUNT_ID}"
cf() {
  local method=$1 path=$2 body=${3:-}
  local response
  if [ -n "$body" ]; then
    response=$(curl -sS -X "$method" "${API}${path}" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H 'Content-Type: application/json' --data "$body")
  else
    response=$(curl -sS -X "$method" "${API}${path}" -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}")
  fi
  if [ "$(jq -r '.success' <<<"$response")" != "true" ]; then
    echo "Cloudflare API ${method} ${path} failed: $(jq -c '.errors' <<<"$response")" >&2
    return 1
  fi
  printf '%s' "$response"
}

for bucket in rebbehub-public rebbehub-preservation; do
  if cf GET "/r2/buckets?name_contains=${bucket}" | jq -e --arg b "$bucket" '.result.buckets[] | select(.name == $b)' >/dev/null; then
    echo "R2 bucket ${bucket}: exists" >&2
  else
    cf POST /r2/buckets "$(jq -nc --arg b "$bucket" '{name: $b}')" >/dev/null
    echo "R2 bucket ${bucket}: created" >&2
  fi
done

echo "Done. Hyperdrive is set up once, in the dashboard; its id is in services/api/wrangler.toml." >&2
