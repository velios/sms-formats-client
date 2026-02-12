# Prompt for Implementation Agent

You are implementing a desktop-first frontend tool for editing and publishing data in `zenmoney/sms-formats`.

## Mission
Build the full feature set from the approved spec package below using `bun + typescript + vite`.

## Mandatory documents (read in this exact order)
1. `openspec/changes/archive/2026-02-12-add-sms-formats-editor/proposal.md`
2. `openspec/changes/archive/2026-02-12-add-sms-formats-editor/design.md`
3. `openspec/changes/archive/2026-02-12-add-sms-formats-editor/tasks.md`
4. `openspec/specs/sms-formats-editor/spec.md`
5. `docs/implementation-brief.md`

## Hard constraints
- Frontend-only architecture. No custom backend service.
- Default source: `main` branch.
- Must support switching to branch or open PR head by PR title search.
- Must support fast bank search with autocomplete.
- Must support editing:
  - existing bank formats
  - `senders.txt` (simple text editing)
  - creating new format from template
  - creating new bank from template
- No delete and no rename for banks/formats.
- Must support refresh from GitHub without page reload.
- If local changes exist on refresh, request confirmation, preserve local drafts, and attempt merge.
- Must enforce one-bank-per-publish rule.
- Must validate locally against CI-like rules before PR.
- Must request GitHub auth only at publish stage.
- RU/EN i18n required via i18next.
- Desktop-first only (mobile UX is not required).

## Regex workspace requirements
- Regex/test area should be similar in usability to regex101 workflow.
- `EXAMPLE` maps to test strings; multiple examples must be supported.
- Explanation and match info must update based on active example.
- Exact regex101 parity is not required.

## Auth/publish requirements
- Anonymous editing by default.
- At PR publish step: ask for GitHub credentials/token and create PR via user fork.
- Publish flow: validate -> enforce one-bank scope -> fork/branch -> commit -> PR.

## UI/UX delegation
UI/UX visual system is delegated to you.
You may choose layout, design language, and interaction details freely, as long as functional requirements are fully preserved.
If your runtime provides a dedicated UI/design skill, use it for interface design and interaction quality.

## Execution expectations
- Implement end-to-end, not partial.
- Keep architecture modular as proposed in design/brief.
- Add tests for parser/serializer/validator and critical flows.
- Keep implementation consistent with OpenSpec requirements and scenarios.
- Before finishing, run relevant checks and report what was and was not run.
