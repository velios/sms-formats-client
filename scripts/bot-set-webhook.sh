#!/usr/bin/env bash
# Register the Telegram webhook for the Recognition Bot, reading secrets from
# bot/.env. Run after the bot is deployed and Caddy serves the domain over HTTPS.
#
# Usage: bash scripts/bot-set-webhook.sh [domain]
#   domain defaults to $RECOGNITION_BOT_WEBHOOK_DOMAIN from bot/.env
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# shellcheck disable=SC1091
set -a
source bot/.env
set +a

# The webhook URL must point at the relay domain, never the bot host's own
# (Telegram-blocked) domain: pointing it at the host yields silent "Connection
# timed out" deliveries (ADR-0005). So read RECOGNITION_BOT_WEBHOOK_DOMAIN (the
# public relay domain Telegram can reach), distinct from RECOGNITION_BOT_DOMAIN
# (the bot host's own domain, used only by the host's Caddy). No fallback to the
# host domain — that conflation is exactly what broke delivery once.
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
