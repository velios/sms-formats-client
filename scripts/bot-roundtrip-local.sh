#!/usr/bin/env bash
# Offline Telegram round-trip on fixtures. Boots the webhook server in dry-run
# (replies are printed, never sent to Telegram) and POSTs crafted guest_message
# updates, proving the whole pipeline: secret-token check, unguessable path,
# SMS extraction, recognition through @/domain/format, and grouped rendering.
#
# Usage: bash scripts/bot-roundtrip-local.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PORT=8787
SECRET="local-roundtrip-secret"
WEBHOOK_PATH="/tg/local-roundtrip-path"
URL="http://127.0.0.1:${PORT}${WEBHOOK_PATH}"
LOG="$(mktemp)"

RECOGNITION_BOT_TOKEN="dry-run-dummy-token" \
RECOGNITION_BOT_WEBHOOK_SECRET="$SECRET" \
RECOGNITION_BOT_WEBHOOK_PATH="$WEBHOOK_PATH" \
RECOGNITION_BOT_PORT="$PORT" \
RECOGNITION_BOT_DRY_RUN=1 \
  bun bot/server.ts >"$LOG" 2>&1 &
SERVER_PID=$!
cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -f "$LOG"
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

echo "== 3. Reply-to SMS, correct secret -> grouped recognition =="
code="$(reply_update | post "$SECRET" "$URL")"
[ "$code" = "200" ] || fail "expected 200, got $code"
sleep 0.2
grep -q "^main:$" "$LOG" || fail "missing 'main:' header"
grep -q "^- sberbank/12$" "$LOG" || fail "missing sberbank/12"
grep -q "^PR #45$" "$LOG" || fail "missing 'PR #45' header"
grep -q "^- tinkoff/24$" "$LOG" || fail "missing tinkoff/24"
echo "ok -> rendered reply:"
sed -n '/^main:$/,/tinkoff\/24/p' "$LOG" | sed 's/^/    /'

echo "== 4. Empty call (mention only) -> usage hint =="
empty_update | post "$SECRET" "$URL" >/dev/null
sleep 0.2
grep -q "Пришлите SMS" "$LOG" || fail "missing usage hint"
echo "ok -> usage hint printed"

echo ""
echo "All offline round-trip checks passed."
