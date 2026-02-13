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
- `VITE_GITHUB_SOURCE_REPO` defines upstream source (`owner/repo`) used to discover forks for repository switching.
- `VITE_GITHUB_DEFAULT_SOURCE_REPO` defines which repository is selected by default when app opens (can be fork or upstream).
- Keep `VITE_DEFAULT_BRANCH` aligned with the default branch for these repositories.

## Publish
- Open Publish panel in the app.
- Provide GitHub PAT with `Contents (RW)` and `Pull Requests (RW)`.
- Run `bun run verify` before creating PR.
