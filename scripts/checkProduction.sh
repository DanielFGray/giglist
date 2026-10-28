#!/usr/bin/env bash
set -euo pipefail

base=${1:?Usage: bash scripts/checkProduction.sh https://your-domain}
base=${base%/}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

expect_status() {
  local expected=$1 method=$2 path=$3 accept=${4:-*/*}
  local actual
  actual=$(curl --silent --show-error --max-time 15 --request "$method" --header "Accept: $accept" \
    --output "$scratch/body" --dump-header "$scratch/headers" \
    --write-out '%{http_code}' "$base$path")
  if [[ "$actual" != "$expected" ]]; then
    echo "$method $path: expected $expected, received $actual" >&2
    exit 1
  fi
}

expect_headers() {
  local expected
  for expected in \
    'Strict-Transport-Security: max-age=31536000' \
    'X-Content-Type-Options: nosniff' \
    'Referrer-Policy: strict-origin-when-cross-origin' \
    'Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()' \
    "Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-6iG6gjRLt1RJOrZKCJT5mXW5bMDTD/CnFfjQN1bpmpU='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; media-src 'self' blob: data:; worker-src 'self' blob:; connect-src 'self'; frame-src https://www.youtube-nocookie.com https://open.spotify.com https://player.vimeo.com https://www.tiktok.com https://www.instagram.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
  do
    if ! rg --ignore-case --fixed-strings --quiet "$expected" "$scratch/headers"; then
      echo "missing response header: $expected" >&2
      exit 1
    fi
  done
}

expect_status 200 GET /api/health
expect_headers
[[ $(cat "$scratch/body") == ok ]]
expect_status 200 GET /api/auth/me
[[ $(cat "$scratch/body") == null ]]

# These requests are harmless if a deployment accidentally enables the test API.
expect_status 404 GET '/api/testing/user-secrets?username=production_probe'
expect_status 404 POST /api/testing/login
expect_status 404 GET /api/does-not-exist
expect_status 404 POST /api/does-not-exist

# The static host answers an unknown path with the app page only when the request accepts HTML,
# as a browser does; a missing script or image still gets 404.
expect_status 200 GET /login text/html
expect_headers
rg --quiet 'text/html' "$scratch/headers"
rg --quiet '<div id="root"' "$scratch/body"
script=$(rg --only-matching '/assets/[^" ]+\.js' "$scratch/body" | head -n 1)
expect_status 200 GET "$script"
rg --quiet 'javascript' "$scratch/headers"
expect_status 200 GET /alphatab/alphaTab.js
rg --quiet 'javascript' "$scratch/headers"
expect_status 200 GET /alphatab/soundfont/sonivox.sf2
[[ $(head -c 4 "$scratch/body") == RIFF ]]
expect_status 404 GET /assets/does-not-exist.js
expect_status 404 GET /alphatab/does-not-exist.js
echo 'Production checks passed.'
