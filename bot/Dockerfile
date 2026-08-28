# syntax=docker/dockerfile:1
# Recognition-bot image (zenmoneysmsbot.zentable.ru). Build context is the
# repo root: docker build -f bot/Dockerfile .
#
# The bot shells out to the git CLI to clone/fetch the corpus (ADR-0004),
# so the runtime stage carries git + ca-certificates. The corpus checkout
# lives under /data (dokku storage mount) and survives redeploys.

# build stage
# --------------------
FROM oven/bun:1.3.14-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun build bot/server.ts --compile --target=bun-linux-x64 --outfile=/out/sms-formats-bot

# runtime stage
# --------------------
FROM debian:stable-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /out/sms-formats-bot /usr/local/bin/sms-formats-bot

ENV RECOGNITION_BOT_PORT=8080
ENV RECOGNITION_BOT_CHECKOUT_DIR=/data/main-checkout
EXPOSE 8080/tcp

CMD ["sms-formats-bot"]
