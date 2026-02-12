## 1. Foundation
- [ ] 1.1 Bootstrap Bun + Vite + TypeScript + React project skeleton.
- [ ] 1.2 Configure environment schema for fixed repository owner/name and default branch.
- [ ] 1.3 Add i18n setup (`i18next`, `react-i18next`) with RU default and EN fallback.
- [ ] 1.4 Add base layout and desktop-only guard.
- [ ] 1.5 Document chosen UI system decisions made by implementing agent (and applied UI/design skill, if available in runtime).

## 2. GitHub data access
- [ ] 2.1 Implement GitHub API client module with typed wrappers and error mapping.
- [ ] 2.2 Implement source loading: branches and open PR list.
- [ ] 2.3 Implement repository tree indexer for banks, formats, and senders.
- [ ] 2.4 Implement file content loader by ref/path with cache keys.

## 3. Navigation and context switching
- [ ] 3.1 Build source selector (branch + open PR by title search).
- [ ] 3.2 Add one-click return to `main`.
- [ ] 3.3 Build bank search with autocomplete and keyboard controls.
- [ ] 3.4 Add bank workspace page with visible bank context header.

## 4. Format editor core
- [ ] 4.1 Implement parser for format file sections (regex, columns, examples).
- [ ] 4.2 Implement deterministic serializer using required template and blank lines.
- [ ] 4.3 Build raw editor pane.
- [ ] 4.4 Build structured editor pane with explicit sync buttons:
- [ ] 4.5 `Parse raw -> structured`
- [ ] 4.6 `Apply structured -> raw`

## 5. Regex lab
- [ ] 5.1 Build regex input and active test-string panel.
- [ ] 5.2 Add multi-example selector and per-example highlighting.
- [ ] 5.3 Add match information table with group offsets/values.
- [ ] 5.4 Add regex explanation panel from parsed AST tokens.

## 6. Columns editor
- [ ] 6.1 Add allowed columns reference map with RU/EN descriptions.
- [ ] 6.2 Build add/search UI for columns.
- [ ] 6.3 Support parameterized columns (`date#...`, `syncid#...`).
- [ ] 6.4 Add drag-and-drop reorder.
- [ ] 6.5 Keep raw semicolon representation synchronized from builder output.

## 7. Additional bank assets
- [ ] 7.1 Implement simple `senders.txt` plain text editor.
- [ ] 7.2 Implement create-new-format flow from CI-valid template.
- [ ] 7.3 Implement create-new-bank flow with template files.

## 8. Local drafts and refresh
- [ ] 8.1 Persist drafts in IndexedDB keyed by source/bank/file/baseSha.
- [ ] 8.2 Implement refresh action without page reload.
- [ ] 8.3 Add confirmation dialog for refresh with unsaved edits.
- [ ] 8.4 Implement 3-way merge attempt and explicit conflict mode.

## 9. Validation and publish guards
- [ ] 9.1 Implement local validation rules aligned with repository CI.
- [ ] 9.2 Add cross-format example collision check within a bank.
- [ ] 9.3 Enforce one-bank-per-publish rule and clear preflight summary.
- [ ] 9.4 Block PR publish until all blocking validations pass.

## 10. GitHub publish flow
- [ ] 10.1 Implement deferred auth prompt (token requested only on publish).
- [ ] 10.2 Implement fork discovery/creation.
- [ ] 10.3 Implement branch creation/update in fork.
- [ ] 10.4 Implement one-commit creation for changed files in selected bank.
- [ ] 10.5 Implement PR creation to upstream `main`.
- [ ] 10.6 Show PR URL and publish log.

## 11. QA and hardening
- [ ] 11.1 Unit tests for parser/serializer/validator and merge logic.
- [ ] 11.2 Integration tests for source switch, bank switch, and publish preflight.
- [ ] 11.3 Manual smoke check on sample bank (`Альфа-Банк-ru_3`).
- [ ] 11.4 Final docs update (`README`, env example, usage steps).
