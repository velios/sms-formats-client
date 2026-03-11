# Zustand Persist Draft Store Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести draft persistence/rehydration на `zustand persist`, не меняя UX `undo/redo`.

**Architecture:** Draft persistence хранится в одном zustand persisted slice, где drafts сгруппированы по PR scope. Active `drafts` остаётся runtime-представлением текущего scope, а per-file history остаётся transient in-memory. Dashboard читает hydrated persisted scopes прямо из store, без отдельного persistence CRUD API.

**Tech Stack:** React 19, Zustand 5, idb-keyval, Vitest, TypeScript.

---

## Chunk 1: Persist Infrastructure For Active Draft Scope

**Files:**
- Modify: `src/store/index.ts`
- Modify: `src/store/index.test.ts`
- Modify: `src/store/persistence.ts`

- [ ] **Step 1: Write the failing persist tests**

Add tests in `src/store/index.test.ts` for:
- rehydrate текущего draft scope без `restoreFromDB`;
- переключение на другой scope без потери persisted данных первого scope;
- `discardAll()` очищает persisted storage текущего scope.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/store/index.test.ts`
Expected: FAIL because store still depends on manual `restoreFromDB` and manual persistence CRUD.

- [ ] **Step 3: Implement persist storage adapter**

In `src/store/persistence.ts`:
- replace raw draft CRUD helpers with:
  - async storage adapter for zustand persist;
  - helper to read all persisted draft scopes for Dashboard.
- keep storage format explicit and serializable.

- [ ] **Step 4: Implement draft-store persist migration**

In `src/store/index.ts`:
- wrap `useDraftStore` with `persist`;
- add current `draftScopeKey` and scope-switch action;
- remove `restoreFromDB` and per-action save/delete calls;
- keep transient per-file history outside persisted slice;
- keep existing public draft actions and per-file undo/redo semantics.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- src/store/index.test.ts`
Expected: PASS

## Chunk 2: UI Integration And Dashboard Indicators

**Files:**
- Modify: `src/pages/BankWorkspace.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Dashboard.test.tsx`

- [ ] **Step 1: Write/adjust failing integration tests**

Update tests so they assert:
- `BankWorkspace` no longer relies on `restoreFromDB`;
- Dashboard reads persisted PR indicators from the new helper;
- current PR with in-memory changes still overrides persisted indicator state correctly.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/pages/Dashboard.test.tsx`
Expected: FAIL because Dashboard still mocks `loadAllDrafts` and workspace init still assumes manual restore.

- [ ] **Step 3: Implement UI integration**

In `src/pages/BankWorkspace.tsx`:
- switch draft scope before opening ready workspace;
- wait for scope hydration instead of calling `restoreFromDB`.

In `src/pages/Dashboard.tsx`:
- replace `loadAllDrafts()` with persisted scope summary helper;
- preserve current indicator behavior for active PR with in-memory changes.

- [ ] **Step 4: Run targeted verification**

Run: `bun run test -- src/pages/Dashboard.test.tsx src/store/index.test.ts`
Expected: PASS

- [ ] **Step 5: Run broader regression verification**

Run: `bun run test -- src/pages/BankWorkspace.test.tsx src/pages/Dashboard.test.tsx src/store/index.test.ts`
Expected: PASS
