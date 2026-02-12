# Change: Add frontend-only editor for ZenMoney sms-formats

## Why
Maintainers need a focused UI to edit `sms-formats` data (mostly `formats/*.txt`) faster and with fewer CI failures than manual text editing.
The workflow must stay browser-based and low-overhead for one developer, while still supporting GitHub PR publishing.

## What Changes
- Add a desktop-first SPA editor (Bun + TypeScript + Vite) for repository browsing and editing.
- Start from `main` by default, with branch and open-PR source switching.
- Add bank search with autocomplete and fast context switch between banks.
- Add dedicated bank workspace with format-file navigation, regex lab, columns builder, and raw file editor.
- Add support for multiple `EXAMPLE` blocks with per-example test/match/explanation context.
- Add simple `senders.txt` editor.
- Add creation flows for new bank and new format file from templates.
- Add non-destructive refresh from GitHub with local draft preservation and conflict handling.
- Add local validation aligned with repository CI rules.
- Add PR publishing flow with deferred authentication.
- Enforce publish guardrail: exactly one changed bank per PR publish action.
- Add i18n (RU/EN) using i18next.
- Delegate final UI/UX visual execution details to implementing agent; functional requirements remain mandatory.

## Impact
- Affected specs: `sms-formats-editor` (new capability)
- Affected code: full new application skeleton, GitHub API integration layer, parser/serializer, validation module, UI workflows
- Constraints:
  - No custom backend is allowed.
  - Full OAuth web flow is not reliably feasible in pure browser due token-exchange constraints; frontend-only publishing flow will use user-provided GitHub token (PAT) with minimal UX.
  - If implementation environment exposes a dedicated UI/design skill, that skill should be used for visual system and interaction design decisions.
