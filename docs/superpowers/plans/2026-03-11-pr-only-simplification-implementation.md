# PR-Only Simplification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести приложение на PR-only workflow с каноническим route `/repo/:owner/:repo/pr/:prNumber`, одним draft на PR и publish-only update текущего PR.

**Architecture:** Вход в workspace идёт только через канонический PR route. `Route Init` резолвит PR snapshot и решает, открыть clean workspace, восстановить draft, показать stale-draft blocking-state или read-only режим. Draft persistence отвязывается от commit selection и хранится по ключу `repository + prNumber`, а `baseHeadSha` остаётся только полем значения для stale-проверок.

**Tech Stack:** React 19, React Router 7, Zustand, TanStack Query, Vitest, Bun, TypeScript.

---

## Chunk 1: PR-Only Navigation, Draft Scope, and Publish Flow

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/AppHeader.tsx`
- Modify: `src/domain/types.ts`
- Modify: `src/domain/bank-route.ts`
- Modify: `src/domain/bank-route.test.ts`
- Modify: `src/domain/github/client.ts`
- Modify: `src/domain/github/client.test.ts`
- Modify: `src/hooks/useGitHub.ts`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/BankWorkspace.tsx`
- Modify: `src/pages/PullRequestShortcut.tsx`
- Modify: `src/features/source-selector/SourceSelector.tsx`
- Modify: `src/features/publish-panel/PublishPanel.tsx`
- Modify: `src/features/format-editor/FormatEditor.tsx`
- Modify: `src/features/senders-editor/SendersEditor.tsx`
- Modify: `src/features/create-entity/CreateFormatModal.tsx`
- Modify: `src/store/draft-scope.ts`
- Modify: `src/store/draft-scope.test.ts`
- Modify: `src/store/index.ts`
- Modify: `src/store/index.test.ts`
- Modify: `src/store/workspace-session.ts`
- Modify: `src/store/workspace-session.test.ts`
- Modify: `src/store/persistence.ts`
- Modify: `src/lib/pull-request-navigation.ts`
- Modify: `src/lib/pull-request-navigation.test.ts`
- Modify: `src/lib/source-switch.ts`
- Modify: `src/lib/source-switch.test.ts`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/ru.json`
- Create if needed for focused coverage: `src/pages/Dashboard.test.tsx`
- Create if needed for focused coverage: `src/features/source-selector/SourceSelector.test.tsx`

- [ ] **Step 1: Rewrite route/domain tests around the new canonical route**

Update `src/domain/bank-route.test.ts` so the expected route model is:

```ts
expect(
  buildPullRequestWorkspacePath({
    repository: { owner: "velios", repo: "sms-formats" },
    prNumber: 120,
    filePath: "src/by_15382/formats/a.txt",
  })
).toBe(
  "/repo/velios/sms-formats/pr/120?file=src%2Fby_15382%2Fformats%2Fa.txt"
);
```

Also add coverage that legacy `/workspace`, `/pr/:prNumber`, `/bank/:bankKey/.../branch-or-pr/...`, and any route with `commit=` redirect to `/`.

- [ ] **Step 2: Run the route tests and confirm they fail against the old implementation**

Run: `bun run test -- src/domain/bank-route.test.ts src/lib/pull-request-navigation.test.ts`
Expected: FAIL because the current code still builds `/bank/.../branch-or-pr/...` routes and still understands `commit`.

- [ ] **Step 3: Replace branch-or-commit routing with PR-only routing**

Implement the minimal route model:

```ts
// src/domain/bank-route.ts
export interface PullRequestRouteParams {
  owner?: string;
  repo?: string;
  prNumber?: string;
}

export function buildPullRequestWorkspacePath(...) { ... }
export function parsePullRequestRouteParams(...) { ... }
```

In `src/App.tsx`:
- remove `useInitMainBranch`;
- make `/` the dashboard;
- redirect `/workspace` to `/`;
- add `/repo/:owner/:repo/pr/:prNumber/*` as the only workspace route;
- redirect every legacy route to `/`.

In `src/pages/PullRequestShortcut.tsx` and `src/lib/pull-request-navigation.ts`:
- stop opening PRs by switching source directly;
- treat the shortcut as a pure redirect helper or remove the page entirely if it becomes dead code;
- remove conflict rules that assume “other source drafts must be discarded before opening PR”.

- [ ] **Step 4: Run route tests again**

Run: `bun run test -- src/domain/bank-route.test.ts src/lib/pull-request-navigation.test.ts`
Expected: PASS

- [ ] **Step 5: Replace the generic `SourceRef` model with PR-only session data**

In `src/domain/types.ts`, `src/hooks/useGitHub.ts`, `src/store/workspace-session.ts`, and consumers:
- remove branch-first assumptions from runtime state;
- stop treating `name` and `type: "branch"` as part of the editable workspace model;
- keep `headSha` as internal snapshot state;
- model session storage around repository + PR number + `headSha` + `writable` + `readOnlyReason`;
- stop restoring the last workspace session from local storage.

Use a shape closer to:

```ts
type ActivePrSession = {
  repository: RepoRef;
  prNumber: number;
  headSha: string;
  bankPath: string;
  writable: boolean;
  readOnlyReason: "no-write-access" | null;
};
```

- [ ] **Step 6: Rewrite draft-scope tests to the new `1 PR : 1 draft` rule**

Update `src/store/draft-scope.test.ts` so the invariant is:

```ts
expect(
  makeDraftSourceKey(
    { type: "pr", prNumber: 123, name: "feature/x" },
    repository
  )
).toBe(
  makeDraftSourceKey(
    { type: "pr", prNumber: 123, name: "feature/y" },
    repository
  )
);
```

And add explicit coverage that:
- PR `123` and PR `124` are different scopes;
- branch scopes are gone or treated as unsupported legacy inputs;
- `baseHeadSha` is stored inside the draft payload, not inside the key.

- [ ] **Step 7: Run the draft/session tests and confirm they fail**

Run: `bun run test -- src/store/draft-scope.test.ts src/store/workspace-session.test.ts`
Expected: FAIL because the current implementation still accepts branch sessions and stores workspace selection for generic sources.

- [ ] **Step 8: Implement one-draft-per-PR persistence**

In `src/store/draft-scope.ts`, `src/store/persistence.ts`, and the draft store implementation:
- key drafts by `repository + prNumber`;
- persist `baseHeadSha` in the draft value;
- keep draft contents across PR switches and app restarts;
- stop clearing drafts on PR-to-PR switch;
- only delete a PR draft on explicit discard or after successful post-publish re-sync.

In `src/lib/source-switch.ts` and `src/lib/source-switch.test.ts`:
- remove discard-confirmation behavior from PR switching;
- save current draft before navigation instead of clearing it.

- [ ] **Step 9: Run the updated draft/session tests**

Run: `bun run test -- src/store/draft-scope.test.ts src/store/workspace-session.test.ts src/lib/source-switch.test.ts`
Expected: PASS

- [ ] **Step 10: Introduce the snapshot-bound PR resolver at the API boundary**

In `src/domain/github/client.ts` and `src/domain/github/client.test.ts`:
- replace the ad hoc pair `fetchPullRequestHead` + `fetchPullRequestFiles` for workspace logic with one resolver-facing shape;
- return `changedFiles` as descriptors, not `string[]`:

```ts
type PullRequestChangedFile = {
  kind: "add" | "modify" | "delete" | "rename";
  path: string;
  oldPath?: string;
};
```

- expose enough data to build a single snapshot-bound result:
  - `headSha`
  - `changedFiles`
  - `bankPath`
  - `writable`
  - `readOnlyReason`
- keep unsupported / unavailable / transient-error cases explicit in tests.

- [ ] **Step 11: Run resolver-level tests**

Run: `bun run test -- src/domain/github/client.test.ts`
Expected: FAIL first, then PASS after the resolver contract is implemented.

- [ ] **Step 12: Rewrite `useGitHub` and open-flow around resolver + canonical route**

In `src/hooks/useGitHub.ts`:
- remove `useBranches`, `usePullRequestCommits`, `useInitMainBranch`, and branch-switch helpers from the active workspace flow;
- consume the new resolver contract from `src/domain/github/client.ts`;
- make `Dashboard -> Open PR` and header PR switching navigate to the canonical route instead of switching source in-place;
- make `Route Init` the owner of initial PR open on that route.

- [ ] **Step 13: Rewrite dashboard, header, and route-init UI to PR-only**

In `src/pages/Dashboard.tsx` and `src/components/AppHeader.tsx`:
- keep only the list of open PRs and PR search;
- remove banks UI;
- remove recent PR UI;
- remove notices that block opening a different PR because another PR has drafts;
- when the user opens a PR, navigate to `/repo/:owner/:repo/pr/:prNumber`.

In `src/App.tsx` and `src/pages/BankWorkspace.tsx`:
- remove the old `workspaceBlocked = !sourceRef` boot logic;
- make `BankWorkspace` own `Route Init` for `/repo/:owner/:repo/pr/:prNumber`;
- cover all spec-required branches:
  - sync top-level repository from route;
  - invalid `owner/repo` -> redirect to default dashboard;
  - invalid `prNumber` -> redirect to synced repository dashboard;
  - `unsupported` / `unavailable` -> redirect to dashboard with notice;
  - `transient-error` -> retry state on the current route.

In `src/features/source-selector/SourceSelector.tsx`:
- remove branch mode;
- remove commit dropdown;
- keep repository switch if still required;
- show only PR selection for the current repository;
- save the current PR draft before switching to another PR.

- [ ] **Step 14: Add or update focused UI tests for dashboard/source selector/route init**

If no suitable tests exist yet, add small component tests that verify:
- dashboard renders no banks and no recent PRs;
- source selector renders no branch toggle and no commit menu;
- opening PR B does not clear draft state for PR A.
- invalid route params redirect as specified.

Run: `bun run test -- src/pages/Dashboard.test.tsx src/features/source-selector/SourceSelector.test.tsx`
Expected: PASS

- [ ] **Step 15: Rewrite draft persistence and read-only mutation guards**

In `src/store/index.ts`, `src/store/index.test.ts`, `src/store/draft-scope.ts`, and `src/store/persistence.ts`:
- move the real restore/persist/discard rules to the store layer that actually owns drafts;
- keep one draft per PR key and persist `baseHeadSha` in the value;
- stop clearing drafts during PR switches;
- delete a draft only on explicit discard or successful post-publish re-sync.

In `src/features/format-editor/FormatEditor.tsx`, `src/features/senders-editor/SendersEditor.tsx`, and `src/features/create-entity/CreateFormatModal.tsx`:
- block draft creation and draft mutation when the active session is read-only;
- keep existing draft content visible only where the spec allows it;
- do not let read-only PRs create new file drafts or mutate existing file drafts.

- [ ] **Step 16: Run store and editor guard tests**

Run: `bun run test -- src/store/index.test.ts src/store/draft-scope.test.ts src/store/workspace-session.test.ts`
Expected: PASS

Add focused tests if needed for read-only editor behavior before implementation.

- [ ] **Step 17: Rewrite workspace route init, stale handling, and publish hooks**

In `src/pages/BankWorkspace.tsx`:
- stop parsing `bankKey`, `repoSlug`, `branchOrPr`, and `commit`;
- parse only `owner`, `repo`, `prNumber`, and optional `file`;
- derive `bankPath` only from the resolver result;
- implement the exact resolution order from the spec:

```ts
if (draft && draft.baseHeadSha !== session.headSha) {
  return showStaleDraftBlockingState();
}
if (!session.writable) {
  return openReadOnlyWorkspace();
}
if (!draft) {
  return openCleanWorkspace();
}
return restoreDraftWorkspace();
```

- on focus re-check and pre-publish re-check:
  - if `headSha` changed, save the current draft under the same PR key with old `baseHeadSha` and switch to stale state;
  - if `headSha` is unchanged but `writable = false`, save current in-memory changes and move to read-only;
  - do not auto-apply stale draft contents to a new head.

- rewrite the real workspace publish path inside `BankWorkspace.tsx` helpers such as `useQuickPullRequestUpdate` / `useBankPublishAction`, not only the modal surface;
- remove create-PR behavior from the publish CTA itself, not just from `PublishPanel`;
- make publish permission come from resolver `writable`, not from a separate cached permission source.

- [ ] **Step 18: Simplify `PublishPanel` and real publish action to “update current PR only”**

In `src/features/publish-panel/PublishPanel.tsx` and the publish helpers in `src/pages/BankWorkspace.tsx`:
- delete create-PR mode, fork creation, branch creation, title editing, and create-PR copy;
- keep only update-current-PR flow;
- run publish preflight in this order:

```ts
if (resolver.headSha !== session.headSha) return stale;
if (!resolver.writable) return readOnly;
if (!localChanges.length) return noChanges;
if (localOpsOutsideBankPath) return invalidScope;
if (validationErrors.length) return validationFailed;
return canPublish;
```

- after successful publish:
  - re-run the resolver;
  - replace the session from the full resolver result;
  - clear the current PR draft only after that re-sync succeeds.

- [ ] **Step 19: Run the focused workflow tests**

Run: `bun run test -- src/pages/BankWorkspace.test.tsx src/features/publish-panel/PublishPanel.test.tsx`
Expected: PASS

If those files do not exist yet, create them first with the smallest coverage that proves:
- stale draft blocks restore when head changed;
- read-only does not auto-restore a draft;
- publish updates only the current PR and never creates a new one.
- resolver-driven publish blocks on stale before read-only.

- [ ] **Step 20: Remove leftover legacy copy and dead branch/commit behavior**

Clean only what this feature made obsolete:
- old i18n keys for branch mode, commit dropdown, recent PRs, and create-PR publish steps;
- old `PullRequestShortcut` behavior if it no longer has a purpose;
- any branch-first guards or `commit` query handling that remain reachable after the rewrite.

Do not remove unrelated code outside this flow.

- [ ] **Step 21: Run full project verification**

Run: `bun run typecheck`
Expected: PASS

Run: `bun run test`
Expected: PASS

Run: `bun run verify`
Expected: PASS

- [ ] **Step 22: Commit the implementation**

```bash
git add src/App.tsx src/components/AppHeader.tsx src/domain/types.ts src/domain/bank-route.ts src/domain/bank-route.test.ts src/domain/github/client.ts src/domain/github/client.test.ts src/hooks/useGitHub.ts src/pages/Dashboard.tsx src/pages/BankWorkspace.tsx src/pages/PullRequestShortcut.tsx src/features/source-selector/SourceSelector.tsx src/features/publish-panel/PublishPanel.tsx src/features/format-editor/FormatEditor.tsx src/features/senders-editor/SendersEditor.tsx src/features/create-entity/CreateFormatModal.tsx src/store/index.ts src/store/index.test.ts src/store/draft-scope.ts src/store/draft-scope.test.ts src/store/workspace-session.ts src/store/workspace-session.test.ts src/store/persistence.ts src/lib/pull-request-navigation.ts src/lib/pull-request-navigation.test.ts src/lib/source-switch.ts src/lib/source-switch.test.ts src/i18n/en.json src/i18n/ru.json docs/superpowers/specs/2026-03-11-pr-only-simplification-design.md docs/superpowers/plans/2026-03-11-pr-only-simplification-implementation.md
git commit -m "feat: simplify workspace to PR-only flow"
```
