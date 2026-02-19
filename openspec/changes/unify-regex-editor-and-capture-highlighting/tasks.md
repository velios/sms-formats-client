## 1. Unified Regex Editor Foundation

- [ ] 1.1 Select and add a single-editor dependency for regex pattern editing/highlighting (CodeMirror-based).
- [ ] 1.2 Implement `UnifiedRegexPatternEditor` with one text model and token decoration support.
- [ ] 1.3 Expose selection and horizontal-scroll callbacks needed by regex-lab state.

## 2. Token-to-Capture Mapping

- [ ] 2.1 Extend regex token metadata to resolve clicked token to capture-group index where applicable.
- [ ] 2.2 Implement helper logic to compute active capture group from clicked token and current pattern.
- [ ] 2.3 Add domain unit tests for mapping edge cases (nested groups, non-capturing groups, optional/unmatched captures, repeated values).

## 3. Regex Lab Integration

- [ ] 3.1 Replace dual regex inputs in `RegexLab` with the unified regex editor component.
- [ ] 3.2 Wire token click events to captured-text highlighting in `MatchOverlayTextarea`.
- [ ] 3.3 Synchronize active token/group state across regex editor, explanation panel, and match info panel.
- [ ] 3.4 Handle invalid regex and unmatched-group states without stale highlight artifacts.

## 4. UI, i18n, and Accessibility

- [ ] 4.1 Update regex-lab styles so pattern text and highlighting stay aligned at supported viewport and zoom.
- [ ] 4.2 Add keyboard and focus behavior for token activation and active-group visibility.
- [ ] 4.3 Update Russian i18n strings for unified editor and token-click highlight messaging.

## 5. Verification

- [ ] 5.1 Add/update component tests for unified editor rendering and token activation behavior.
- [ ] 5.2 Add integration tests for click-token-to-captured-text flow on active examples.
- [ ] 5.3 Run `bun run verify` and resolve any lint/test/type regressions.
