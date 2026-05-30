#!/usr/bin/env bash
# Register the Telegram webhook for the Recognition Bot, reading secrets from
# bot/.env. Run after the bot is deployed and Caddy serves the domain over HTTPS.
#
# Usage: bash scripts/bot-set-webhook.sh [domain]
#   domain defaults to zenmoneysmsbot.zentable.ru
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# shellcheck disable=SC1091
set -a
source bot/.env
set +a

DOMAIN="${1:-zenmoneysmsbot.zentable.ru}"
WEBHOOK_PATH="/${RECOGNITION_BOT_WEBHOOK_PATH#/}"
URL="https://${DOMAIN}${WEBHOOK_PATH}"
API="https://api.telegram.org/bot${RECOGNITION_BOT_TOKEN}"

pretty() { if command -v jq >/dev/null; then jq .; else cat; fi; }

echo "Setting webhook -> ${URL}"
curl -sS "${API}/setWebhook" \
  --data-urlencode "url=${URL}" \
  --data-urlencode "secret_token=${RECOGNITION_BOT_WEBHOOK_SECRET}" \
  --data-urlencode 'allowed_updates=["guest_message"]' | pretty

echo "Webhook info:"
curl -sS "${API}/getWebhookInfo" | pretty
