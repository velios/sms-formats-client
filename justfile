set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

# Деплой: push в main собирает и деплоит оба dokku-приложения через GitHub Actions
# (.github/workflows/deploy-spa.yml, deploy-bot.yml; zen-hub#45). Ручного деплоя нет.

[private]
default:
  @just --list

# Собрать production frontend (dist/)
build:
  @bun run build

# Собрать standalone Linux-бинарь бота (dist-bot/sms-formats-bot)
build-bot:
  @bun run bot:build

# Зарегистрировать Telegram webhook (читает bot/.env)
set-webhook:
  @bash ./scripts/bot-set-webhook.sh
