# syntax=docker/dockerfile:1
# SPA image (sms.zentable.ru): vite build -> nginx static server.
# Modeled on zentable-spa (zen-hub ADR 0004); no build secrets needed here.

# build stage
# --------------------
FROM oven/bun:1.3.14-alpine AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

# nginx stage
# --------------------
FROM nginx:mainline-alpine

ENV NGINX_PORT=8000
EXPOSE 8000/tcp

COPY --from=build /app/dist/ /var/www/html/

COPY nginx.conf /etc/nginx/templates/sms-formats.conf.template
