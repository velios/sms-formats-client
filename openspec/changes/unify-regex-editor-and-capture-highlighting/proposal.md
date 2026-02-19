## Why

Current regex workflow uses separate editable and highlighted pattern blocks, which creates visual drift and makes token-level reasoning harder.
We need a unified regex editor where text and syntax highlighting stay aligned, plus direct mapping from clicked regex blocks to captured text in the test string.

## What Changes

- Replace the two-block regex input (editable + highlight-only) with one integrated editor surface that keeps text and highlight in sync.
- Add strict visual sync behavior for pattern text and highlight layers (same content model, selection, scroll, and rendering metrics).
- Add interaction: clicking a regex token/block highlights the related captured fragment(s) in the active test string.
- Support integration of a proven editor/highlighting component if it provides better alignment stability than current custom overlay approach.
- Preserve current regex-lab flows (regex editing, explanation panel, examples, groups/columns) while upgrading interaction behavior.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `sms-formats-editor`: refine Regex Workspace requirements to mandate a single unified regex editor view, guaranteed highlight/text alignment, and click-to-capture highlighting from regex tokens to test-string segments.

## Impact

- Affected specs: `sms-formats-editor` (delta update).
- Affected code: `/src/features/regex-lab/RegexLab.tsx`, related regex token/match mapping logic in `/src/domain/format`, and regex-lab UI styles.
- Affected UX contracts: regex input rendering model, token selection behavior, and cross-panel highlighting between regex pattern and test string.
- Dependencies: may introduce an editor/highlight library if selected solution improves stability and maintainability over custom implementation.
