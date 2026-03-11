# Zustand Persist Draft Store Design

## Goal

Упростить хранение draft'ов, убрав ручной persistence lifecycle из draft-store и переведя active draft state на `zustand` `persist`, не меняя UX `undo/redo`.

## Product Decisions

- `undo/redo` остаются per-file и только in-memory.
- `zustand-travel` не используется.
- persistence отвечает только за восстановление draft content/state, но не за стек history.
- Dashboard продолжает показывать индикаторы локальных draft'ов для разных PR.
- Breaking changes во внутренней архитектуре допустимы, если они упрощают код.

## Current Problems

- persistence размазан между `useDraftStore`, `src/store/persistence.ts` и отдельным `draftHistoryByPath`;
- store вручную вызывает `saveDraft`, `deleteDraft`, `loadAllDrafts`, `restoreFromDB`;
- hydration current scope зависит от внешнего orchestration в `BankWorkspace`;
- Dashboard читает persisted drafts в обход store, потому что persistence реализован как набор CRUD-функций, а не как часть store lifecycle.

## Target Design

### Draft Store

- `useDraftStore` остаётся единственной точкой входа для active draft state.
- persistence активного draft scope переносится на `zustand` `persist`.
- persisted state хранит только serializable slice:
  - `drafts`
  - `draftScopeKey`
- transient state остаётся вне persistence:
  - per-file history (`draftHistoryByPath`)
  - derived selectors
  - hydration control flags

### Scope Model

- Persist использует один zustand storage key для всего draft-store.
- Внутри persisted slice drafts группируются по `draftScopeKey = repository + prNumber`.
- Active `drafts` остаётся runtime-представлением только текущего scope, а persisted slice хранит drafts всех PR.
- При смене PR store просто активирует нужный scope из уже hydrated persisted state.

### Dashboard Integration

- Dashboard больше не читает raw draft entries через прежний CRUD API.
- Он использует hydrated zustand-store и читает persisted scopes напрямую из store state.
- PR indicator считается только по drafts с реальными изменениями (`content !== remoteContent || isDeleted`).

### Undo / Redo

- История продолжает храниться по `filePath` в `draftHistoryByPath`.
- `persist` не сохраняет history.
- После reload draft content восстанавливается, но history начинается заново.
- UX текущих кнопок `undo/redo` остаётся прежним: стек доступен для текущего файла, пока жива сессия страницы.

## File Responsibilities

- `src/store/index.ts`
  - перевод `useDraftStore` на `persist`
  - хранение active draft scope key
  - переключение persisted scope
  - отказ от ручного save/load/delete в actions
- `src/store/persistence.ts`
  - превращается из CRUD API в storage adapter/helper layer для `persist`
  - даёт чтение persisted scopes для Dashboard
- `src/pages/BankWorkspace.tsx`
  - вместо `restoreFromDB(...)` инициирует переключение draft scope и ждёт hydration
- `src/pages/Dashboard.tsx`
  - читает persisted scopes через новый helper, а не через старый `loadAllDrafts`
- `src/store/index.test.ts`
  - покрывает persist rehydration и смену scope
- `src/pages/Dashboard.test.tsx`
  - покрывает PR indicators на основе persisted zustand blobs

## Success Criteria

1. Draft store больше не делает ручных вызовов `saveDraft/deleteDraft/loadAllDrafts/restoreFromDB`.
2. При открытии PR draft content восстанавливается через `zustand persist`.
3. При смене PR persisted drafts другого PR не теряются.
4. Dashboard по-прежнему показывает индикаторы локальных draft'ов для PR с persisted изменениями.
5. `undo/redo` UX не меняется.
