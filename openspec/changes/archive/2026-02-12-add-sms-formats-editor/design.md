## Context
The target repository is [zenmoney/sms-formats](https://github.com/zenmoney/sms-formats). Data is plain text and validated by strict structural rules from README.
The editor must optimize one-developer maintenance workflow with low ceremony and high confidence before PR creation.

Hard constraints:
- Frontend-only solution (no custom backend service).
- Desktop-first UX.
- Editing scope is one bank at a time for publish.

## Goals
- Fast switching: source (main/branch/open PR) and bank.
- Safe editing: structured + raw editing modes, deterministic serializer, local CI-like checks.
- Convenient regex workflow similar to regex101 mental model.
- Minimal but reliable PR publish from browser.

## Non-Goals
- Mobile-first UX.
- Multi-user collaboration.
- Deleting banks or formats.
- Renaming banks/formats.
- Supporting closed PR sources.

## UI/UX Ownership
- UI/UX visual and interaction refinement is intentionally delegated to the implementing agent.
- The implementing agent must preserve all functional requirements and acceptance criteria from this change package.
- If the execution environment provides a dedicated interface-design skill, the implementing agent should apply that skill for layout, typography, spacing, component behavior, and visual polish decisions.

## Architecture Decisions

### 1) Application architecture
- Stack: Bun, TypeScript, Vite, React.
- Routing: SPA with explicit routes for clarity and deep links.
  - `/` -> source and bank selection dashboard.
  - `/bank/:bankPath` -> bank workspace.
- State split:
  - Remote snapshot state (current source ref files from GitHub).
  - Local draft state (unsaved edits).
  - Publish state (token, fork metadata, publish progress).

Recommended libraries (minimal set):
- `react`, `react-dom`, `react-router-dom`
- `@tanstack/react-query` for remote cache/fetch lifecycle
- `zustand` for cross-page draft state
- `i18next`, `react-i18next`
- `zod` for config and API payload guards
- `@dnd-kit/core` + `@dnd-kit/sortable` for columns ordering
- Code editor: `@codemirror/*` (single editor stack for regex/test/raw)
- Regex parse support: `regexp-tree` (AST extraction used for explanation rendering)
- GitHub API: `octokit`

### 2) Repository source model (main/branch/open PR)
- Base repository is fixed via startup config (`VITE_GITHUB_OWNER`, `VITE_GITHUB_REPO`).
- Initial source: `main`.
- Source selector supports:
  - Branch by exact name (autocomplete from `/branches`).
  - Open PR by title search (from `/pulls?state=open`), selecting PR head ref.
- Quick action: `Back to main` always visible.

### 3) Bank discovery and indexing
- Load repository tree for selected source via `GET /repos/{owner}/{repo}/git/trees/{sha}?recursive=1`.
- Detect banks by `src/<bank-folder>/` where folder matches `<bank name>_<bank id?>`.
- Build in-memory index:
  - display name
  - bank folder path
  - bank id (if present)
  - format file list
  - senders presence
- Provide client-side fuzzy search with autocomplete and keyboard navigation.

### 4) File model and parsing
Canonical format file structure:
1. First line = regex.
2. Blank line.
3. `-----COLUMNS-----` marker.
4. One line of semicolon-separated columns.
5. One or more `-----EXAMPLE-----` sections separated by blank lines.

Internal model:
- `regex: string`
- `columns: string[]`
- `examples: string[]`
- `raw: string`
- `parseErrors: ValidationIssue[]`

Parser behavior:
- Strict marker detection.
- Preserve multiline examples.
- Trim examples for validation checks (match repo behavior).

Serializer behavior:
- Deterministic template output with required blank lines before markers.
- No extra sections.

### 5) Editing UX model
Each format editor page contains two synchronized work zones:
- Structured zone:
  - Regex editor.
  - Example list with tabs/selector and per-active test string panel.
  - Columns builder.
  - Explanation + Match information for active example.
- Raw zone:
  - Full raw format file text editor.

Sync actions are explicit buttons:
- `Parse raw -> structured`
- `Apply structured -> raw`

This avoids accidental destructive auto-sync and makes transformations auditable.

### 6) Regex lab behavior
- Active example is mapped to active `TEST STRING`.
- For each regex/example pair:
  - Execute JS `RegExp` test and capture groups.
  - Render highlighted group spans in test string.
  - Render match info table: full match + groups + offsets.
- Explanation panel:
  - AST-based summary generated from parsed regex tokens.
  - Not regex101-identical; must be readable and sectioned by token/group.

### 7) Columns builder
- Allowed column base names are fixed by README Column reference.
- UI supports:
  - Add column from searchable dropdown with inline description.
  - Configure argument for parameterized columns (`date#<format>`, `syncid#<accountType>`).
  - Reorder columns by drag-and-drop.
  - Direct text edit fallback for advanced cases.
- Builder always produces normalized semicolon string.

### 8) Senders editor
- `senders.txt` edited as plain multiline text.
- Helper hints:
  - one sender per line
  - empty lines allowed
  - `#`-prefixed lines are still treated as sender values

### 9) New entity creation
- Create bank flow:
  - Input: bank name (required), bank id (optional numeric).
  - Creates folder `src/<bank name>_<id-or-empty>/`.
  - Creates `senders.txt` with placeholder comment-free sample line.
  - Creates `formats/` with one template format file.
- Create format flow (within bank):
  - Input: format name (required), format id (optional numeric).
  - Creates `formats/<format name>_<id-or-empty>.txt` from template.

Template format (CI-valid by default):
```
^(.*)$

-----COLUMNS-----
comment

-----EXAMPLE-----
Sample SMS text
```

### 10) Refresh and merge strategy
Refresh action pulls latest remote state for the current source without page reload.

If no local edits:
- Replace snapshot and re-render.

If local edits exist:
1. Ask confirmation.
2. Fetch fresh snapshot.
3. Attempt per-file 3-way merge using:
   - `base` = previous remote snapshot
   - `local` = unsaved draft
   - `remote` = freshly fetched file
4. Merge result rules:
   - If `local == base` -> use `remote`
   - If `remote == base` -> keep `local`
   - Else -> mark conflict and require manual resolution in editor
5. Keep merge report visible.

### 11) Validation engine (local CI-aligned)
Validation runs on demand and before publish.

Checks:
- Required format sections exist.
- At least one example exists.
- Every example matches own regex.
- Example does not match regex of other formats in same bank.
- Capture group count equals columns count.
- Column names are allowed and parameterized forms are valid.
- `senders.txt` file exists for bank.
- Publish scope contains exactly one bank.

Output:
- Blocking errors vs non-blocking warnings.
- File-level and bank-level grouped diagnostics.

### 12) Publish workflow (frontend-only)
Because no backend is allowed, classic OAuth web flow is not selected as primary path.
Reason: token exchange endpoint requirements and browser constraints make backend-free OAuth brittle.

Selected minimal workflow:
- User works anonymously by default.
- On `Create PR` action, prompt user to provide GitHub token (fine-grained PAT preferred).
- Token is stored in memory by default (optional sessionStorage opt-in).
- Publish steps:
  1. Validate changes.
  2. Enforce one-bank change guardrail.
  3. Ensure user fork exists.
  4. Create/update branch in fork.
  5. Create one commit containing all changed files for selected bank.
  6. Open PR from `user:branch` to upstream `main`.
- PR body includes checklist summary of local validation results.

Required token capabilities:
- Repository contents write (for commit objects / file updates).
- Pull requests write.

### 13) Persistence
- Local drafts persisted in IndexedDB keyed by:
  - source ref
  - bank path
  - file path
  - remote blob sha used as base
- Crash-safe restore banner on reload.

### 14) i18n and UX
- RU as default locale, EN fallback.
- All user-facing strings live in i18n dictionaries.
- Desktop-optimized layout with minimum supported width (for example 1200px).
- On small viewports, show explicit unsupported-size notice instead of degraded mobile UI.

## Risks and Mitigations
- OAuth limitations in pure frontend: mitigated by PAT-based publish path.
- Large repository tree load time: mitigated by cached index + lazy loading format contents.
- Regex explanation complexity: provide clear tokenized explanation, not full regex101 parity.
- Merge conflicts after refresh: explicit conflict mode and manual resolution tools.

## Implementation Notes
- Keep code modular by domain:
  - `src/domain/format/`
  - `src/domain/bank/`
  - `src/domain/github/`
  - `src/features/editor/`
  - `src/features/publish/`
- Prefer pure functions for parser/serializer/validator with strong unit tests.
- Keep publish operations serial to avoid GitHub content API conflicts.
