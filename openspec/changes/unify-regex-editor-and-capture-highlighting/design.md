## Context

Current regex UX in `RegexLab` uses two separate pattern blocks:
- an editable plain input (`PlainRegexPatternInput`)
- a read-only highlighted input (`RegexPatternInput`)

This split makes visual drift possible (text metrics, cursor position, or scroll mismatch) and complicates token-level interaction.
The requested change requires one unified regex block where editing and highlighting stay aligned, plus token click behavior that highlights captured text in the active test string.

Constraints:
- Keep browser-side JavaScript regex execution behavior.
- Keep existing regex-lab workflows (examples, explanation, match info, columns mapping).
- Avoid regressions in existing validation and publish flows.

## Goals / Non-Goals

**Goals:**
- Provide a single regex editor surface for editing and highlighting.
- Guarantee highlight/text alignment during typing, selection, and horizontal scrolling.
- Map regex token clicks to capture-group highlights in the active test string.
- Keep current explanation and match-info panels synchronized with active token/group state.

**Non-Goals:**
- Rebuild the full regex parsing/explanation subsystem from scratch.
- Change repository format semantics, validation rules, or publish workflow.
- Introduce backend services for regex processing.

## Decisions

### 1) Use one editor runtime (CodeMirror 6) for pattern text and highlighting
- Decision: adopt a single editor component based on CodeMirror 6 and render token highlights via decorations in the same document model.
- Rationale: one text model eliminates overlay drift classes of bugs (font metrics, line-height, selection and scroll desync).
- Alternatives considered:
  - Keep custom dual-input/overlay approach: lower migration cost, but drift risk remains by design.
  - Monaco: too heavy for this focused single-pattern editor use case.

### 2) Introduce explicit token-to-capture mapping
- Decision: extend regex token model/metadata to resolve clicked token to capture-group index when applicable.
- Rationale: direct mapping enables deterministic click-to-highlight behavior in test string and consistent UX with match/group panel.
- Alternatives considered:
  - Infer mapping only from token text labels at runtime: brittle for nested groups and repeated tokens.
  - Highlight only full match on any click: does not satisfy requested capture-focused behavior.

### 3) Unify active-highlight state across panels
- Decision: centralize active selection state in regex-lab (`activePatternToken`, `activeCaptureGroup`) and feed it into:
  - unified regex editor (active token decoration)
  - match overlay textarea (active captured range)
  - match info panel (active row/group)
- Rationale: one shared state prevents stale or conflicting highlights between hover, click, and example-switch interactions.
- Alternatives considered:
  - Keep independent per-panel states: easier locally, but causes inconsistent cross-panel behavior.

### 4) Preserve fallback behavior for edge cases
- Decision: if clicked token has no captured value in current match, clear token-driven text highlight and avoid stale previous highlight.
- Rationale: explicit clearing is less misleading than persisting outdated highlight.
- Alternatives considered:
  - Keep previous highlight until next valid click: confusing and error-prone.

## Risks / Trade-offs

- [Bundle size increase from editor dependency] -> Mitigation: import minimal CodeMirror packages and keep editor-specific extensions scoped to regex-lab.
- [Incorrect token-to-group mapping for complex patterns] -> Mitigation: add unit tests for nested groups, non-capturing groups, optional captures, repeated values, and escaped parentheses.
- [Interaction regressions between hover and click states] -> Mitigation: define precedence rules (click selection overrides hover; clear on regex/example change) and test with integration scenarios.
- [Visual regressions in existing styles] -> Mitigation: isolate new editor styles under regex-lab class namespace and validate alignment on supported viewport/zoom combinations.

## Migration Plan

1. Add unified regex editor component and dependencies.
2. Add token-to-capture mapping helper and tests in domain layer.
3. Replace dual pattern inputs in `RegexLab` with unified component.
4. Wire click-to-capture highlighting into test-string overlay and match info panel.
5. Remove obsolete dual-input styles/code paths after verification.

Rollback:
- Revert to previous dual-input implementation in a single rollback commit if severe regressions are found during verification.

## Open Questions

- Should clicking a token outside any capturing group highlight full match or keep no token-driven highlight?
- Should token-driven selection persist when switching active example, or reset per example switch?
