#!/usr/bin/env bash
# Register the deployed relay webhook using bot/.env. See ADR-0005.
# Usage: bash scripts/bot-set-webhook.sh [relay-domain]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# shellcheck disable=SC1091
set -a
source bot/.env
set +a

# Telegram reaches the public relay, not the bot host.
DOMAIN="${1:-${RECOGNITION_BOT_WEBHOOK_DOMAIN:?Set RECOGNITION_BOT_WEBHOOK_DOMAIN (the relay domain Telegram reaches) in bot/.env or pass it as the first argument — see ADR-0005}}"
WEBHOOK_PATH="/${RECOGNITION_BOT_WEBHOOK_PATH#/}"
URL="https://${DOMAIN}${WEBHOOK_PATH}"
API="https://api.telegram.org/bot${RECOGNITION_BOT_TOKEN}"

pretty() { if command -v jq >/dev/null; then jq .; else cat; fi; }

echo "Setting webhook -> ${URL}"
curl -sS "${API}/setWebhook" \
  --data-urlencode "url=${URL}" \
  --data-urlencode "secret_token=${RECOGNITION_BOT_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["guest_message","message"]' | pretty

echo "Webhook info:"
curl -sS "${API}/getWebhookInfo" | pretty
