# Разработка

Полная проверка — `bun run verify`, production-сборка — `bun run build`. Для отдельного теста сначала выполните `bun run content:build`, затем `bun test --isolate <путь>`: изоляция предотвращает утечки моков.

## Контент

| Источник | Поддержка |
| --- | --- |
| [cookbook.md](../src/content/cookbook.md) | Снимок внешнего справочника; обновляется вручную |
| [format-rules.md](../src/content/format-rules.md) | Правила формата и отличия редактора от upstream |
| [regex-snippets.toml](../src/content/regex-snippets.toml) | Самостоятельный каталог; `pattern` — литеральная строка TOML, обратные слэши сохраняются дословно |

[Пайплайн](../scripts/build-content.ts) проверяет сниппеты и генерирует HTML, каталог и исходники для AI-промпта. `*.generated.*` пересоздаются хуками запуска, сборки и проверок; вручную их не редактируют. Причины выбора источников — [ADR-0009](adr/0009-build-time-content-pipeline-cookbook-and-snippets.md).

## Кеширование

Библиотеки, общий код, workspace и AI-диалоги разделены. Изменение зависимости может менять хеши импортирующих chunks.

Cookbook и сниппеты обычно меняются вместе и выпускаются одним JSON. Правила формата и каждый перевод — отдельными JSON. Их хешированные адреса находятся в некешируемом HTML, поэтому правки данных сохраняют JS-хеши. Переводы загружаются перед запуском, справочные данные — при открытии workspace.

JS/CSS/JSON кешируются на год с `immutable`. При деплое сохраняйте старые assets для открытых вкладок.

## Бот

```bash
cp bot/.env.example bot/.env
bun run bot:dev
```

`RECOGNITION_BOT_DRY_RUN=1` отключает отправку в Telegram; `RECOGNITION_BOT_OFFLINE=1` использует подготовленный checkout без обновления сети. Локальная проверка — `bun run bot:roundtrip`. Синхронизация корпуса описана в [ADR-0004](adr/0004-corpus-sync-git-clone-pr-refs-etag-ttl.md).

Workflows публикуют образы SPA/бота в GHCR и развёртывают их в Dokku после проверок. Инфраструктура — [zen-hub](https://github.com/velios/zen-hub).
