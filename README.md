# Zenmoney SMS Formats Editor

Desktop-first web app for editing and publishing bank SMS formats.

Main data repository: [https://github.com/zenmoney/sms-formats](https://github.com/zenmoney/sms-formats)

## What It Does
- Edit bank format files and `senders.txt`
- Validate formats locally before publish
- Create PR to `zenmoney/sms-formats` via GitHub API
- Work without backend (browser + GitHub only)

## Quick Start (Local)
```bash
bun install
cp .env.example .env
bun run dev
```

Open: [http://localhost:5173](http://localhost:5173)

## Local Dev & Debug
```bash
bun run test:watch   # tests during development
bun run typecheck    # TypeScript checks
bun run lint         # ultracite/biome checks
bun run verify       # full gate: typecheck + tests + secrets + lint
```

## Minimal Env Notes
- Defaults already target `zenmoney/sms-formats`.
- If needed, adjust `VITE_GITHUB_OWNER`, `VITE_GITHUB_REPO`, `VITE_DEFAULT_BRANCH` in `.env`.

## Publish
- Open Publish panel in the app.
- Provide GitHub PAT with `Contents (RW)` and `Pull Requests (RW)`.
- Run `bun run verify` before creating PR.
