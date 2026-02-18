# AGENTS.md — sms-formats-client

## Scope
- This file defines mandatory working rules for agents in this repository.
- Priority: keep the project publish-ready, lint-clean, and free from secret leaks.

## Stack & Commands
- Install deps: `bun install`
- Tests only: `bun test`
- Full gate: `bun run verify`
- Common local commands:
  - `bun run dev`
  - `bun run build`
  - `bun run preview`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run format`
  - `bun run check:secrets`

## Commit Gate (Mandatory)
- Before every commit, run `bun run verify`.
- If `bun run verify` fails, commit is forbidden until all checks are fixed.
- Do not bypass checks with temporary disables.

## Security / No Leaks
- Never commit secrets, tokens, private keys, passwords, or `.env` values.
- Keep credentials only in local env/config outside git.
- Treat `check-secrets` inside `bun run verify` as mandatory.

## Ultracite / Biome Rules (Mandatory)
- Lint baseline is `ultracite/biome/core` from `biome.jsonc`.
- Do not add inline suppressions (`biome-ignore ...`) without explicit user approval.
- Do not relax global rules to pass checks; fix code instead.
- Prefer `bunx ultracite fix` for safe autofixes, then resolve remaining issues manually.
- Critical rule focus for this codebase:
  - `lint/complexity/noExcessiveCognitiveComplexity` must stay enabled for source code.
  - Keep functions/components small; extract helpers instead of adding suppressions.
  - Respect style/correctness rules reported by ultracite (format, unused vars, consistent type defs, etc.).

## Code Style Defaults
- TypeScript strict-first: avoid `any`, avoid non-null assertions unless unavoidable.
- Keep React components focused; move heavy branching/logic to pure helpers.
- Prefer readable, explicit code over clever/compact constructs.

## Repository Map (Agent Context)
- `src/domain` — pure logic (parser/regex/validation/github integration helpers)
- `src/features` — UI feature modules
- `src/pages` — top-level screens
- `src/store` — Zustand state and persistence
- `src/i18n` — translations (`ru`, `en`)
- `ansible` — VPS deploy automation
- `docs` — human docs and deploy notes
- `openspec` — spec history and current capability specs

## Temporary i18n Rule
- During active development, update only `src/i18n/ru.json`.
- Do not update `src/i18n/en.json` unless the user explicitly asks for it.
- This rule is temporary and remains in force until explicitly canceled by the user.

## Path Conventions (Docs & Examples)
- Do not use developer-specific absolute local paths in docs/examples (for example `/Users/...`).
- Always use project-root-relative paths (for example `docs/...`, `src/...`, `openspec/...`).
- If an absolute path is required by runtime context, explain why and prefer a relative alternative in documentation text.

## Publish Readiness Checklist
- `bun run verify` passes.
- Working tree is clean or intentionally scoped for commit.
- No secret leaks in tracked files/history checks.
- Lint/format state is canonical (no pending ultracite diagnostics).
