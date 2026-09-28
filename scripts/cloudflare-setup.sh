#!/usr/bin/env bash
# Makes sure the Cloudflare resources RebbeHub runs on exist, creating any
# that are missing, and prints the Hyperdrive id the API's wrangler.toml
# needs. Safe to run again and again: the deploy workflow runs it every time.
#
#   CLOUDFLARE_API_TOKEN   an API token (see docs/deploy.md for its permissions)
#   CLOUDFLARE_ACCOUNT_ID  the account's id
#   DATABASE_URL           Postgres (Neon), used to create the Hyperdrive config
#
# Resources:
#   R2 bucket  rebbehub-public        files that may be served
#   R2 bucket  rebbehub-preservation  files kept but never served (no Worker binds it)
#   Hyperdrive rebbehub               pooled connections to DATABASE_URL
set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"
: "${DATABASE_URL:?set DATABASE_URL}"

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

id=$(cf GET /hyperdrive/configs | jq -r '.result[] | select(.name == "rebbehub") | .id' | head -n1)
if [ -z "$id" ]; then
  # The origin, from the connection string (node parses URLs properly, with any escaping in the password).
  origin=$(node -e '
    const u = new URL(process.env.DATABASE_URL);
    console.log(JSON.stringify({
      scheme: "postgresql",
      host: u.hostname,
      port: Number(u.port || 5432),
      database: decodeURIComponent(u.pathname.slice(1)),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
    }));')
  id=$(cf POST /hyperdrive/configs "$(jq -nc --argjson origin "$origin" '{name: "rebbehub", origin: $origin}')" | jq -r '.result.id')
  echo "Hyperdrive rebbehub: created" >&2
else
  echo "Hyperdrive rebbehub: exists" >&2
fi

if [ -n "${GITHUB_ENV:-}" ]; then echo "HYPERDRIVE_ID=${id}" >> "$GITHUB_ENV"; fi
echo "$id"
