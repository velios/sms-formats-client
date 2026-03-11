# Zustand File Content Cache Design

## Goal

Убрать повторные загрузки файлов при повторном входе в тот же PR и свести все remote file caches workspace к единому zustand storage.

## Decisions

- Единый remote file cache живет в `zustand`.
- `draftStore` остается отдельным overlay и не смешивается с remote cache.
- Ключ file cache: `repository + prNumber + filePath`.
- Каждая cache entry хранит `content`, `lastResolvedHeadSha`, `status`, `loadedAt`, `loadedFrom`.
- `FormatEditor`, `SendersEditor`, validation и quick-check читают файлы через единый file-content-store.
- Если remote content файла уже есть в cache для текущего PR и `lastResolvedHeadSha` совпадает с активной session, UI показывает файл сразу без loader.
- Если head PR меняется и локальных draft changes нет, cache PR очищается и workspace синхронизируется на новый head автоматически.
- Если head PR меняется и локальные draft changes есть, UI продолжает показывать старую cached версию, блокирует дальнейшее редактирование и показывает notice с действием discard + refresh.

## Non-Goals

- Не переносить списки PR/repositories с `react-query` в `zustand`.
- Не объединять draft persistence и remote file cache в одну сущность.
- Не добавлять долгоживущую persisted file cache между полными reload браузера.

## Implementation Shape

- Новый store: `src/store/file-content-store.ts`
- Новый hook/adaptor: тонкий слой поверх store для редакторов и batch loaders
- `prepareFormatEntries` перестает ходить напрямую в `fetchFileContent`
- Validation перестает ходить напрямую в `fetchFileContent`
- `BankWorkspace` получает локальное stale-cache notice state для already-open PR
