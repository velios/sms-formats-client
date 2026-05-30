#!/usr/bin/env bash
# Offline Telegram round-trip on fixtures. Boots the webhook server in dry-run
# (replies are printed, never sent to Telegram) and POSTs crafted guest_message
# updates, proving the whole pipeline: secret-token check, unguessable path,
# SMS extraction, recognition through @/domain/format, and grouped rendering.
#
# Stays offline by pre-seeding a tiny local git checkout and pointing the bot at
# it via RECOGNITION_BOT_CHECKOUT_DIR: the bot reads it from disk instead of
# cloning, exercising the same disk-read path a restart takes (ADR-0004).
#
# Usage: bash scripts/bot-roundtrip-local.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PORT=8787
SECRET="local-roundtrip-secret"
WEBHOOK_PATH="/tg/local-roundtrip-path"
URL="http://127.0.0.1:${PORT}${WEBHOOK_PATH}"
LOG="$(mktemp)"
CHECKOUT="$(mktemp -d)"

# Seed a fixture main checkout: one Sberbank format whose regex recognizes the
# demo SMS below. A real commit so `git rev-parse HEAD` yields a permalink SHA.
mkdir -p "$CHECKOUT/src/sberbank/formats"
printf '%s\n\n-----COLUMNS-----\nsum\n\n-----EXAMPLE-----\nPokupka 1 RUB. Karta *1. Dostupno 1 RUB\n' \
  '^Pokupka \d+ RUB\. Karta \*\d+\. Dostupno \d+ RUB$' \
  >"$CHECKOUT/src/sberbank/formats/12.txt"
git -C "$CHECKOUT" init -q
git -C "$CHECKOUT" -c user.email=ci@example.com -c user.name=ci add -A
git -C "$CHECKOUT" -c user.email=ci@example.com -c user.name=ci commit -qm fixture

RECOGNITION_BOT_TOKEN="dry-run-dummy-token" \
RECOGNITION_BOT_WEBHOOK_SECRET="$SECRET" \
RECOGNITION_BOT_WEBHOOK_PATH="$WEBHOOK_PATH" \
RECOGNITION_BOT_PORT="$PORT" \
RECOGNITION_BOT_DRY_RUN=1 \
RECOGNITION_BOT_SOURCE_REPO="zenmoney/sms-formats" \
RECOGNITION_BOT_CHECKOUT_DIR="$CHECKOUT" \
  bun bot/server.ts >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -f "$LOG"
  rm -rf "$CHECKOUT"
}
trap cleanup EXIT

# Wait for the server to start listening.
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/"; then break; fi
  sleep 0.1
done

reply_update() {
  cat <<JSON
{"update_id":1,"guest_message":{"message_id":10,"date":1700000000,
"chat":{"id":1,"type":"private"},"from":{"id":2,"is_bot":false,"first_name":"Tester"},
"guest_query_id":"q1","text":"@zenmoneysms_bot",
"entities":[{"type":"mention","offset":0,"length":16}],
"reply_to_message":{"message_id":9,"date":1699999999,
"chat":{"id":1,"type":"private"},"from":{"id":3,"is_bot":false,"first_name":"Bank"},
"text":"Pokupka 1000 RUB. Karta *1234. Dostupno 5000 RUB"}}}
JSON
}

empty_update() {
  cat <<JSON
{"update_id":2,"guest_message":{"message_id":11,"date":1700000001,
"chat":{"id":1,"type":"private"},"from":{"id":2,"is_bot":false,"first_name":"Tester"},
"guest_query_id":"q2","text":"@zenmoneysms_bot",
"entities":[{"type":"mention","offset":0,"length":16}]}}
JSON
}

post() {
  curl -s -o /dev/null -w "%{http_code}" -X POST "$2" \
    -H "Content-Type: application/json" \
    -H "X-Telegram-Bot-Api-Secret-Token: $1" \
    --data-binary @-
}

fail() { echo "FAIL: $1"; exit 1; }

echo "== 1. Wrong secret token -> 401 =="
code="$(reply_update | post "wrong-secret" "$URL")"
[ "$code" = "401" ] || fail "expected 401, got $code"
echo "ok ($code)"

echo "== 2. Wrong path -> 404 =="
code="$(reply_update | post "$SECRET" "http://127.0.0.1:${PORT}/tg/nope")"
[ "$code" = "404" ] || fail "expected 404, got $code"
echo "ok ($code)"

echo "== 3. Reply-to SMS, correct secret -> recognition with file link =="
code="$(reply_update | post "$SECRET" "$URL")"
[ "$code" = "200" ] || fail "expected 200, got $code"
sleep 0.2
grep -q "^main:$" "$LOG" || fail "missing 'main:' header"
grep -q 'href="https://github.com/zenmoney/sms-formats/blob/[0-9a-f]\{7,\}/src/sberbank/formats/12.txt">sberbank/12</a>' "$LOG" \
  || fail "missing sberbank/12 file link at the checked-out SHA"
echo "ok -> rendered reply:"
sed -n '/^main:$/,/sberbank\/12/p' "$LOG" | sed 's/^/    /'

echo "== 4. Empty call (mention only) -> usage hint =="
empty_update | post "$SECRET" "$URL" >/dev/null
sleep 0.2
grep -q "Пришлите SMS" "$LOG" || fail "missing usage hint"
echo "ok -> usage hint printed"

echo ""
echo "All offline round-trip checks passed."
