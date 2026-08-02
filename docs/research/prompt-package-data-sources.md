# Откуда клиент берёт main-, PR- и черновиковые версии файлов банка

Research по issue [#14](https://github.com/velios/sms-formats-client/issues/14), родительская карта [#11](https://github.com/velios/sms-formats-client/issues/11).

Вопрос: чем наполнить три независимых слоя AI-пакета (версия в `main`, версия в head-ref открытого PR, браузерный черновик), сколько это стоит запросов и что придётся дописать.

Все числа по стоимости — либо из документации GitHub (ссылки в разделе «Rate limit»), либо измерены против живого `zenmoney/sms-formats` (помечено «замер»).

---

## Короткий ответ

| Слой | Состав файлов | Тела файлов | Запросов сейчас | Запросов оптимально |
|---|---|---|---|---|
| `main` | выводится локально из head-ref + `changedFiles` PR | **нет ничего** | 1 (tree) + N (contents) | **1** (GraphQL) |
| head-ref PR (Source) | **есть локально**, без сети | частично в кэше, лениво | N − cached (contents, по файлу) | **1** (GraphQL) |
| черновик | **есть локально** | **есть локально** | 0 | 0 |

Полный пакет по банку **p90 (23 файла)**: сейчас ≈ 24–47 REST-запросов, на GraphQL — **2**.
Полный пакет по **СберБанку (162 файла)**: сейчас ≈ 163–325 REST-запросов, на GraphQL — **2**.

Анонимный REST-лимит — 60 запросов в час (замер: `x-ratelimit-limit: 60`). Пакет по Сберу пофайловым REST анонимно **невозможен в принципе**; пакет p90 съедает половину-целое часовое окно. Это ключевое ограничение, из него растёт большинство открытых вопросов.

---

## Слой 3: черновик — полностью локально, 0 запросов

`src/store/index.ts`, `useDraftStore`.

- `drafts: Map<string, DraftEntry>`; `DraftEntry` держит **и** `content` (черновик), **и** `remoteContent` (тело по head-ref на момент создания черновика), плюс `baseSha`, `baseHeadSha`, `isDeleted`, `timestamp`.
- Скоуп черновиков — `pr:<N>` в связке с репозиторием (`src/store/draft-scope.ts`, `makeDraftSourceKey`). Скоупы для не-PR источников выбрасывают `Unsupported legacy draft scope` — то есть черновики существуют **только** в PR-воркспейсе.
- Персистенция — IndexedDB через `idb-keyval` (`src/store/persistence.ts`, ключ `sms-formats-draft-store`); в сторедж уходят только записи с реальными изменениями (`hasPersistedDraftChanges`).
- Готовая выборка для пакета уже есть: `BankInventory.formatContentsForValidation` — `Map<path, content>` по живым (не удалённым) форматам банка с локальными изменениями (`src/features/bank-inventory/core.ts:255`).

**Что дописать:** ничего для форматов. Для `senders.txt` `formatContentsForValidation` его не включает (по построению только format-файлы) — тело черновика senders надо брать напрямую из `draftStore.getDraft(sendersPath)`.

**Побочная выгода:** `DraftEntry.remoteContent` — это бесплатная копия слоя head-ref для всех изменённых файлов. Для файла с черновиком слой 2 доступен без сети.

---

## Слой 2: head-ref открытого PR (Source ref)

### Состав файлов — известен без сети

При входе в workspace `BankWorkspace.tsx:2186` делает **один** `fetchRepoTree(resolution.headSha)` → `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1`, и результат раскладывается `indexBanksFromTree` в `useSourceStore.banks` (`BankWorkspace.tsx:2217-2218`).

`BankInfo` (`src/domain/github/client.ts:1447`) даёт по каждому банку: `folderPath`, `formatFiles: string[]` (все `src/<bank>/formats/*.txt`), `hasSenders`. Это состав банка **по head SHA PR**, а не по main.

Поверх этого `useBankInventory` (`src/features/bank-inventory/`) строит `BankInventory` с уже готовыми выборками: `formatFiles`, `liveFormatPaths`, `visibleDeletedFormatFiles`, `unsupportedFiles`, `changedFormatPaths`. Перечислить состав пакета можно **полностью офлайн**.

Замер: рекурсивное дерево всего репозитория — 8213 записей, `truncated: false`; 730 папок банков; крупнейший банк `src/СберБанк-ru_4624` — 162 blob'а.

### Тела файлов — ленивый кэш, покрытие непредсказуемо

`src/store/file-content-store.ts`, `useFileContentStore`:

- ключ `"{owner}/{repo}:pr:{N}:{path}"`, свежесть проверяется по `lastResolvedHeadSha === headSha`;
- транспорт — `fetchFileContent` → `octokit.repos.getContent` (`client.ts:1422`), **один HTTP-запрос на файл**, base64 → UTF-8;
- есть дедупликация параллельных запросов (`inFlightRequests`), пакетный хелпер `primeFileContents` = `Promise.all` пофайловых запросов (не пакетный по сети);
- **не персистится** — живёт до перезагрузки страницы; `invalidatePullRequestFileContents` чистит кэш при смене head SHA.

Кто наполняет кэш:
- `editor` — открытый в редакторе файл (`useWorkspaceFileContent`);
- `quick-check` / пересечения — `prepareFormatEntries` (`src/features/quick-check/format-entries.ts:108`) тянет `inventory.liveFormatPaths`, то есть **весь банк**. После нажатия «Посчитать пересечения» кэш тёплый на весь банк;
- `search-index` — по одному файлу при поиске по примерам (`BankWorkspace.tsx:427`);
- `prefetch` — один файл при синхронизации с обновлённым head (`BankWorkspace.tsx:2471`).

**Что дописать:** гарантию полноты. Сейчас «все тела банка по head-ref» доступны только как побочный эффект пересечений. Для пакета нужен явный загрузчик всего банка на ref — и желательно не пофайловый (см. «Пакетные способы»).

---

## Слой 1: `main` — не загружается вообще

Прямая находка: **ни одна строка кода не читает `origin/main`.**

- `config.defaultBranch` (`src/config.ts:64`) используется только в `pulls.create({base})` (`client.ts:1692`) и в ссылке на cookbook на github.com (`CookbookModal.tsx:7`) и подписи в шапке (`WorkspaceHeaderBar.tsx:215`);
- `fetchBranchSha` (`client.ts:1342`) экспортируется из `src/domain/github/index.ts` и **нигде не вызывается**;
- дерево в `useSourceStore.tree` — всегда по `headSha` PR.

### Состав файлов банка в main выводится локально

`resolvePullRequestWorkspace` (`client.ts:1232`) уже пагинирует `pulls.listFiles` и кладёт `changedFiles: {kind: add|modify|delete|rename, path, oldPath}` в `WorkspaceSession` (localStorage, ключ `sms-formats-workspace-session`) и в `sourceChanges` инвентаря.

Отсюда состав main = (состав head-ref) − (`kind: "add"`) + (`kind: "delete"`), с учётом `oldPath` для переименований. Сети не нужно.

### Тела — нужен новый код

Нечего переиспользовать: `fetchFileContent(path, ref)` умеет любой ref, но вызывается только с `sourceRef.sha`. Для main нужен либо `ref: config.defaultBranch`, либо явно резолвнутый SHA.

**Тонкость про «версию в main».** Есть два кандидата и они не совпадают:
- `WorkspaceSession.baseSha` — `pulls.get → base.sha`, **уже лежит в localStorage бесплатно**, но это база PR, а не текущий tip `main`;
- текущий `main` — требует резолва (или `expression: "main:path"` в GraphQL, что резолвится на стороне GitHub бесплатно).

Выбор — продуктовое решение (см. открытые вопросы).

---

## Пакетные способы получить тела многих файлов

### GraphQL с алиасами — победитель (замер)

Один POST на `https://api.github.com/graphql`:

```graphql
query {
  repository(owner: "zenmoney", name: "sms-formats") {
    f0: object(expression: "main:src/<bank>/formats/a.txt") { ... on Blob { text isTruncated byteSize } }
    f1: object(expression: "<headSha>:src/<bank>/formats/b.txt") { ... on Blob { text isTruncated byteSize } }
    # ...
  }
  rateLimit { cost nodeCount remaining }
}
```

Замер на реальном СберБанке — **162 алиаса в одном запросе**: запрос ~59 KB, ответ полный (162/162 непустых, `isTruncated: false`), `rateLimit.cost: 1`, `nodeCount: 0`. То есть весь слой по крупнейшему банку — **один запрос и одно очко лимита из 5000/час**.

Проверено дополнительно:
- `expression` принимает и имя ветки (`main:path`), и полный commit SHA (`ac2c03…:path`);
- несуществующий путь возвращает `null` — это ровно тот сигнал «файла в этом слое нет», который нужен легенде пакета из решения #1 карты;
- анонимно GraphQL **недоступен**: `POST /graphql` без токена → `403` (замер).

### Git Trees API — состав и blob SHA за один запрос

`GET /repos/{o}/{r}/git/trees/{tree_sha}?recursive=1`. Замер: работает и с синтаксисом `main:src/<bank>` (поддерево банка) — 163 записи по Сберу, `truncated: false`. Содержимого не отдаёт, только `path`/`sha`/`type`/`size`. Приложение уже использует этот эндпоинт (`fetchRepoTree`).

Полезно как дешёвый способ узнать blob SHA (для дедупликации между слоями: одинаковый SHA = файл не менялся), но за телами всё равно надо идти в blobs — по одному запросу на blob.

### Contents API — то, что используется сейчас

`GET /repos/{o}/{r}/contents/{path}?ref=…`. Один файл = один запрос.

Каталог: замер `contents/src/СберБанк-ru_4624/formats?ref=main` → массив из 161 записи с `name/sha/size/type`, **без `content`**. Как пакетный источник тел не годится.

### Tarball / zipball — из браузера нельзя

`GET /repos/{o}/{r}/tarball/{ref}` → `302` на `codeload.github.com`. Замер заголовков: у `api.github.com` `access-control-allow-origin: *`, а у `codeload.github.com` — `access-control-allow-origin: https://render.githubusercontent.com`. **CORS не пускает браузерный клиент на codeload**, значит вариант «скачать архив ref'а одним запросом» для SPA закрыт (без прокси). Плюс пришлось бы тащить весь репозиторий ради одного банка и распаковывать gzip+tar в браузере.

### raw.githubusercontent.com — обходит core-лимит, но пофайлово

Замер: `access-control-allow-origin: *`, `cache-control: max-age=300`, есть `ETag`, и **нет ни одного заголовка `x-ratelimit-*`** — то есть отдача не тарифицируется core-лимитом REST API. Всё ещё один запрос на файл, но 162 запроса к raw дешевле по лимиту, чем 162 к API. Кандидат на фолбэк для анонимного режима (с оговорками — раздел ниже).

### git clone — недоступен (для сравнения)

ADR-0004 (`docs/adr/0004-corpus-sync-git-clone-pr-refs-etag-ttl.md`) решает похожую задачу для recognition-бота через полный `git clone` + `refs/pull/<N>/head`, потому что git-протокол идёт по отдельным лимитам. В браузере этот путь закрыт; ADR полезен как разбор альтернатив (там же tarball отвергнут — но по другой причине, из-за отсутствия дельты).

---

## Rate limit

Числа взяты из документации GitHub; замеры против живого API приведены отдельно, где они подтверждают документацию.

### REST

Первоисточник: [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

| Способ авторизации | Primary rate limit |
|---|---|
| Аноним (по IP) | **60 запросов/час** |
| Персональный токен (PAT) | **5 000 запросов/час** |
| GitHub App (installation token) | 5 000/час (+50/час за каждый репозиторий сверх 20) |
| OAuth app | 5 000/час на приложение |
| `GITHUB_TOKEN` в Actions | 1 000/час на репозиторий |

> «Unauthenticated requests are associated with the originating IP address, not with the user or application that made the request. The primary rate limit for unauthenticated requests is **60 requests per hour**.»

> «All of these requests count towards your personal rate limit of **5,000 requests per hour**.»

Замер подтверждает: анонимный `GET https://api.github.com/repos/zenmoney/sms-formats` отдаёт `x-ratelimit-limit: 60`, `x-ratelimit-resource: core`.

**Secondary rate limits** (та же страница) — важны, потому что текущий код шлёт запросы пачкой через `Promise.all`:

> «No more than **100 concurrent requests** are allowed. This limit is shared across the REST API and GraphQL API.»

> «No more than **900 points per minute** are allowed for REST API endpoints, and no more than **2,000 points per minute** are allowed for the GraphQL API endpoint.»

162 параллельных `getContent` не упираются в 100 concurrent только потому, что браузер сам ограничивает число соединений на хост; полагаться на это не стоит. В best practices прямо рекомендуют обратное текущему коду:

> «To avoid exceeding secondary rate limits, you should make requests **serially instead of concurrently**.»
> — [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)

### GraphQL

Первоисточник: [Rate limits and node limits for the GraphQL API](https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api).

- Лимит — **5 000 points/час на пользователя** (10 000 для GitHub Enterprise Cloud).
- Стоимость запроса: > «Add up the number of requests needed to fulfill each unique connection in the call… **Divide the number by 100 and round the result to the nearest whole number**… The minimum point value of a call to the GraphQL API is **1**.»
  Запрос из N алиасов `object(expression:…)` не содержит ни одного connection → стоит **1 point**. Замер на 162 алиасах это подтверждает: `rateLimit.cost: 1`, `nodeCount: 0`.
- Ограничения: > «Individual calls cannot request more than **500,000 total nodes**.» и > «If GitHub takes more than **10 seconds** to process an API request, GitHub will terminate the request.»
- **Лимит на число алиасов и на размер ответа в документации не описан.** Практические границы — 500k nodes, 10-секундный таймаут и `Blob.isTruncated`. Порог усечения `Blob.text` документация тоже не называет.
- GraphQL требует аутентификации: анонимный `POST /graphql` → `403` (замер).

Схема (первоисточник — [опубликованный SDL](https://docs.github.com/public/fpt/schema.docs.graphql)):
`Repository.object(expression: String)` — «A Git revision expression suitable for rev-parse»; `Blob.text: String` — «**UTF8 text data or null if the Blob is binary**»; `Blob.isTruncated: Boolean!`.

### Условные запросы (ETag) и 304

Ключевая цитата — [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api):

> «Most endpoints return an `etag` header, and many endpoints return a `last-modified` header. You can use the values of these headers to make conditional GET requests. If the response has not changed, you will receive a `304 Not Modified` response. **Making a conditional request does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized with an `Authorization` header.**»

Два следствия для нас:

1. Освобождение 304 от лимита оговорено **только для аутентифицированных** запросов. Для анонимного клиента документация такой гарантии не даёт — значит, ETag не спасает анонимный режим от лимита 60/час. **В документации не найдено** явного утверждения про 304 у анонимных запросов.
2. Про conditional requests в GraphQL документация молчит — **в документации не найдено**.

CORS для условных запросов из браузера разрешён явно — [Using CORS and JSONP](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests):

> «The REST API supports cross-origin resource sharing (CORS) for AJAX requests **from any origin**.»

В preflight-ответе разрешён `If-None-Match`, а `ETag` перечислен в `Access-Control-Expose-Headers` — то есть ETag-кэширование тел файлов из SPA технически возможно, просто не реализовано.

### Ограничения эндпоинтов, важные для пакетной выдачи

- **Git Trees** ([docs](https://docs.github.com/en/rest/git/trees)): > «the limit for the tree array is **100,000 entries with a maximum size of 7 MB** when using the `recursive` parameter». Наши 8 213 записей на весь репозиторий — далеко от лимита (`truncated: false`, замер). Содержимого не отдаёт.
- **Git Blobs** ([docs](https://docs.github.com/en/rest/git/blobs)): поддерживает `application/vnd.github.raw+json`, blob до **100 MB**. Батчинга нет — один blob на запрос.
- **Contents** ([docs](https://docs.github.com/en/rest/repos/contents)): > «**1 MB or smaller**: All features of this endpoint are supported»; каталог — > «This API has an upper limit of **1,000 files for a directory**»; тела в листинге каталога не приходят, только `download_url`, и > «Download URLs expire and are meant to be used just once».
- **Tarball** (та же страница): документирован только 302-редирект; > «For private repositories, these links are temporary and **expire after five minutes**». Про codeload и его CORS в документации ничего нет — **в документации не найдено**; замер показывает, что из браузера архив недоступен (см. выше).
- **raw.githubusercontent.com**: тарифицируется ли core-лимитом — **в документации не найдено**, официальных чисел GitHub не публикует. Замер: `x-ratelimit-*` в ответах отсутствуют.

### Что это значит для фичи

| Режим | Бюджет | Пакет p90 (23 файла) | Пакет по Сберу (162) |
|---|---|---|---|
| Аноним, пофайловый REST | 60/час | ~46 запросов — 1 пакет в час, впритык | 324 запроса — **невозможно** |
| Токен, пофайловый REST | 5 000/час | ~46 — 100+ пакетов в час | 324 — ~15 пакетов в час |
| Токен, GraphQL | 5 000 points/час | **1–2 points** | **1–2 points** |
| Аноним, GraphQL | — | **недоступно (403)** | **недоступно (403)** |

---

## Что уже кэшируется в приложении

| Что | Где | Механизм | Живёт |
|---|---|---|---|
| Открытые PR | `useOpenPRs` (`src/hooks/useGitHub.ts`) | React Query, `staleTime` 10 мин, `gcTime` 30 мин | вкладка |
| Список форков-репозиториев | `useAvailableSourceRepos` | React Query, те же тайминги | вкладка |
| Тела файлов по head-ref | `useFileContentStore` | свой zustand-кэш + дедуп in-flight, ключ `repo:pr:path`, свежесть по `headSha` | до перезагрузки страницы |
| Черновики | `useDraftStore` | zustand `persist` → IndexedDB | между сессиями |
| Воркспейс-сессия (headSha, baseSha, changedFiles) | `workspace-session.ts` | localStorage | между сессиями |
| Право на approve | `client.ts` | localStorage | до смены токена |

**React Query не покрывает тела файлов вообще** — только два запроса верхнего уровня.

**ETag / условные запросы не используются нигде.** Octokit сам их не делает. Единственное упоминание HTTP-кэша в коде — комментарий `client.ts:840-843`: GitHub отдаёт аутентифицированные GET с `Cache-Control: private, max-age=60`, из-за чего браузер после публикации возвращает старое тело, и код обходит это cache-bust-параметром `_cb` (`cacheBustParam`). То есть сейчас кэш GitHub скорее мешают, чем используют.

---

## Стоимость сборки пакета

Допущения: банк уже открыт в workspace (дерево head-ref загружено, состав известен), кэш тел пустой (пользователь не жал «Посчитать пересечения»).

| Сценарий | main | head-ref | черновик | Итого |
|---|---|---|---|---|
| p90, 23 файла, пофайловый REST | 23 | 23 | 0 | **46** |
| Сбер, 162 файла, пофайловый REST | 162 | 162 | 0 | **324** |
| p90, GraphQL | 1 | 1 | 0 | **2** |
| Сбер, GraphQL | 1 | 1 | 0 | **2** |
| Сбер, GraphQL одним запросом на оба слоя | — | — | 0 | **1** (алиасы обоих ref'ов в одном query, замер подтверждает смешивание ref'ов) |

Экономия сверх этого: файлы с черновиком не требуют запроса за head-ref-версией (есть `remoteContent`); файлы, не тронутые PR (`changedFiles` не содержит путь), имеют одинаковое тело в main и head-ref — второй слой по ним запрашивать не нужно, а по легенде пакета (решение #1 карты) он и не должен появляться.

С этой оптимизацией слой `main` по Сберу — 162 файла, слой head-ref — только `changedFiles` банка (обычно единицы). Даже пофайловым REST это ≈162 + единицы, но всё равно за пределами анонимного лимита.

---

## Что нужно дописать (список работ)

1. **Резолв `main`-ref.** Решить, что такое «версия в main» (tip `main` или `WorkspaceSession.baseSha`), и провести это в новый загрузчик.
2. **Пакетный загрузчик тел на ref.** Новая функция в `src/domain/github` — GraphQL-запрос с алиасами, принимающий `Array<{ref, path}>` и возвращающий `Map<{ref,path}, string | null>`. Требует токена.
3. **Фолбэк без токена.** Либо пофайловый REST/raw, либо отключение фичи. Решается вопросом 1 из открытых.
4. **Батчинг по размеру.** 162 алиаса прошли; на всякий случай разбивать запрос по числу алиасов или по суммарному `byteSize` (порог подобрать, документированного лимита на число алиасов не нашлось — см. цитаты).
5. **Состав пакета из инвентаря.** Функция «пути банка в слое main» = `inventory.formatFiles` минус `source: "added"` плюс `source: "deleted"`; сети не требует, но сейчас такой выборки в `BankInventory` нет (по ADR-0014 новые выборки заводятся только с названным потребителем — потребитель появится).
6. **Тело `senders.txt` черновика** — отдельно от `formatContentsForValidation`.
7. **Кэш слоя main.** Ключ по `{repo, ref, path}` — текущий `file-content-store` жёстко завязан на `prNumber` в ключе (`buildFileContentCacheKey`) и не умеет хранить не-PR-версии. Либо расширить ключ, либо не кэшировать main вовсе (пакет собирается редко).

---

## Открытые вопросы к человеку

1. **Требовать ли токен для фичи?** GraphQL анонимно не работает (403, замер), анонимный REST — 60/час, чего не хватает даже на один пакет по крупному банку. Варианты: (а) кнопка активна только с токеном; (б) без токена — пофайловый REST с честным предупреждением и отказом на больших банках; (в) без токена — `raw.githubusercontent.com` (не тарифицируется core-лимитом, но это неофициальный путь и поведение не гарантировано контрактом API).
2. **Что такое «версия в main»** — текущий tip `origin/main` (свежо, но может уехать от базы PR и породить «изменения», которых автор PR не делал) или `base.sha` PR (стабильно, бесплатно, уже в localStorage, но может отставать от main на недели)?
3. **Нужно ли включать в пакет неизменённые файлы дважды?** По легенде из решения #1 «отсутствие версии в слое = файл в этом слое не менялся». Значит для файла, не входящего в `changedFiles` PR, блок head-ref не выводится — и запрос за ним не нужен. Подтвердить это как правило: оно превращает слой head-ref из «весь банк» в «единицы файлов» и снимает половину стоимости.
4. **Fork-PR.** Сейчас тела head-ref тянутся из **base**-репозитория по head SHA (`fetchFileContent(path, headSha, repository)`), что работает благодаря `refs/pull/N/head`. Для GraphQL предполагается то же самое (`repository(owner: base…) { object(expression: "<headSha>:path") }`). Не проверено на реальном fork-PR — подтвердить перед реализацией.
5. **`unsupported`-файлы банка** (не `formats/*.txt` и не `senders.txt`, попавшие в PR). В инвентаре они есть (`unsupportedFiles`), в редакторе — read-only. Входят ли их тела в пакет?
6. **Свежесть на момент сборки.** `file-content-store` не персистится и инвалидируется по `headSha`, но между открытием workspace и нажатием кнопки head мог уехать. Перечитывать ли `pulls.get` перед сборкой (+1 запрос), или полагаться на существующий механизм stale-сессии?
7. **Читать ли из кэша или всегда заново?** Тёплый кэш после «Посчитать пересечения» покрывает весь банк по head-ref бесплатно. Смешивать источники (кэш + GraphQL за остальным) или всегда делать один чистый запрос ради предсказуемости?
