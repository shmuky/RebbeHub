# The Backup workflow's way into R2 (.github/workflows/backup.yml): put,
# list ("key size" a line) and forget, through Cloudflare's REST API when
# VIA=rest, else through R2's S3 endpoint.
api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$BUCKET/objects"

put() {
  if [ "$VIA" = rest ]; then
    curl -fsS --retry 4 --retry-all-errors -X PUT -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H 'Content-Type: application/octet-stream' --data-binary "@$1" "$api/$2" > /dev/null
  else
    aws s3 cp "$1" "s3://$BUCKET/$2" --endpoint-url "$R2_ENDPOINT" --only-show-errors
  fi
}

list() {
  if [ "$VIA" = rest ]; then
    curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api?prefix=$1&per_page=1000" | jq -r '.result[] | "\(.key) \(.size)"'
  else
    aws s3 ls "s3://$BUCKET/$1" --recursive --endpoint-url "$R2_ENDPOINT" | awk '{print $4, $3}'
  fi
}

forget() {
  if [ "$VIA" = rest ]; then
    curl -fsS -X DELETE -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$api/$1" > /dev/null
  else
    aws s3 rm "s3://$BUCKET/$1" --endpoint-url "$R2_ENDPOINT" --only-show-errors
  fi
}
