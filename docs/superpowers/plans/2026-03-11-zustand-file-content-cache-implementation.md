# Zustand File Content Cache Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перевести загрузку файлов workspace на единый zustand file-content-store и добавить optimistic reuse/stale PR handling.

**Architecture:** Remote content хранится в отдельном zustand store по ключу `repo + pr + filePath`, а `draftStore` остается overlay для локальных изменений. UI всегда читает effective content из `draftStore -> file-content-store`, а background PR recheck решает, нужно ли оставить stale cached version или silently refresh workspace.

**Tech Stack:** React 19, Zustand, TypeScript, Vitest.

---

## Chunk 1: Store And Consumers

**Files:**
- Create: `src/store/file-content-store.ts`
- Create: `src/store/file-content-store.test.ts`
- Modify: `src/store/index.ts`
- Modify: `src/features/format-editor/FormatEditor.tsx`
- Modify: `src/features/senders-editor/SendersEditor.tsx`
- Modify: `src/features/validation/ValidationPanel.tsx`
- Modify: `src/features/quick-check/format-entries.ts`
- Modify: `src/features/quick-check/format-entries.test.ts`

- [ ] Step 1: Write failing tests for file-content-store cache reuse and PR invalidation.
- [ ] Step 2: Run tests to confirm RED.
- [ ] Step 3: Implement minimal zustand file-content-store with per-PR entries and batch priming.
- [ ] Step 4: Switch editor/senders/validation/quick-check reads to the new store.
- [ ] Step 5: Run focused tests to confirm GREEN.

## Chunk 2: Optimistic Workspace Behavior

**Files:**
- Modify: `src/pages/BankWorkspace.tsx`
- Modify: `src/pages/BankWorkspace.route-init.test.tsx`

- [ ] Step 1: Write failing tests for stale PR notice and auto-refresh when there are no local drafts.
- [ ] Step 2: Run tests to confirm RED.
- [ ] Step 3: Implement stale notice flow for cached content with local drafts and auto-refresh without drafts.
- [ ] Step 4: Run focused tests to confirm GREEN.
