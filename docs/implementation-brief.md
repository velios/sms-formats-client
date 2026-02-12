# SMS Formats Client: Implementation Brief for Delivery Agent

## 1. Objective
Build a desktop-first SPA that edits data in `zenmoney/sms-formats` (focused on `formats/*.txt`), validates changes locally, and publishes one-bank PRs to upstream repository.

Primary source of truth for behavior:
- `openspec/changes/add-sms-formats-editor/proposal.md`
- `openspec/changes/add-sms-formats-editor/design.md`
- `openspec/changes/add-sms-formats-editor/tasks.md`
- `openspec/changes/add-sms-formats-editor/specs/sms-formats-editor/spec.md`

## 2. Non-Negotiable Constraints
- Frontend-only architecture (no custom backend service).
- Bun + TypeScript + Vite stack.
- RU/EN i18n via i18next.
- Desktop-targeted UX.
- No delete and no rename for banks/formats in this scope.
- Publish preflight must enforce exactly one changed bank.

## 3. UI/UX Authority
UI/UX execution is delegated to you as implementing agent.
You own concrete visual language, component composition, interaction micro-decisions, and ergonomics.

Rules:
- Functional behaviors from OpenSpec are mandatory.
- Visual implementation freedom is intentional.
- If your runtime has an interface-design skill available, apply it for UI decisions.

## 4. Suggested Runtime Architecture

### 4.1 Feature modules
- `src/domain/github/`: API wrappers, auth/token handling, branch/PR/repo-tree operations.
- `src/domain/format/`: parser, serializer, regex test engine, columns model.
- `src/domain/validation/`: CI-aligned checks and diagnostics model.
- `src/domain/publish/`: fork/branch/commit/PR orchestration.
- `src/features/source-selector/`
- `src/features/bank-workspace/`
- `src/features/format-editor/`
- `src/features/senders-editor/`
- `src/features/create-entity/`
- `src/features/publish-panel/`

### 4.2 Cross-cutting
- React Query for remote fetch/cache.
- Zustand (or equivalent) for draft and UI session state.
- IndexedDB persistence for crash-safe drafts.
- Zod for config and payload validation.

## 5. Critical Flows

### 5.1 Load and switch source
1. Start on `main`.
2. Allow switching by branch name.
3. Allow switching by open PR title (resolve to PR head branch).
4. Provide `Back to main` shortcut.

### 5.2 Navigate bank and edit files
1. Search bank with autocomplete.
2. Open bank workspace with explicit bank name in header.
3. Switch formats in bank quickly.
4. Edit in structured/raw modes.
5. Sync modes explicitly via action buttons.

### 5.3 Refresh without reload
1. User triggers refresh.
2. If dirty state exists, ask confirm.
3. Pull fresh remote snapshot.
4. Attempt 3-way merge per file.
5. Surface conflicts with manual resolution mode.

### 5.4 Publish PR
1. Run validation.
2. Enforce one-bank scope.
3. Request token only now.
4. Ensure fork exists.
5. Create/update branch.
6. Create one commit for that bank changes.
7. Open PR to upstream `main`.

## 6. Data contracts

### 6.1 Parsed format model
```ts
interface ParsedFormat {
  regex: string
  columns: string[]
  examples: string[]
  raw: string
  parseIssues: ValidationIssue[]
}
```

### 6.2 Validation issue
```ts
interface ValidationIssue {
  code: string
  level: 'error' | 'warning'
  filePath: string
  message: string
}
```

### 6.3 Publish preflight result
```ts
interface PublishPreflight {
  canPublish: boolean
  changedBanks: string[]
  blockingIssues: ValidationIssue[]
  warnings: ValidationIssue[]
}
```

## 7. Format Template (new file)
Use this template for new format creation:

```txt
^(.*)$

-----COLUMNS-----
comment

-----EXAMPLE-----
Sample SMS text
```

## 8. Validation parity checklist
Implement these as blocking errors before publish:
- missing regex / COLUMNS / EXAMPLE sections;
- invalid regex;
- no examples;
- own example does not match own regex;
- own example matches another format regex in same bank;
- capture group count mismatch against columns count;
- invalid column names or invalid parameterized forms;
- publish includes more than one bank.

## 9. Authentication strategy note
In frontend-only constraints, do not rely on server-side OAuth exchange.
Practical path for this project: ask user for token only at publish stage.
Do not force authentication for browsing/editing.

## 10. Definition of done
- All requirements in OpenSpec `sms-formats-editor` delta are implemented.
- Publish path creates a real PR in upstream repository through user fork.
- Validation blocks known CI failures locally.
- User can edit existing bank, create new format, create new bank, and submit PR.
- i18n RU/EN works for visible application strings.
