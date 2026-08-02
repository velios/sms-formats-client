# Лимиты и стоимость запросов к GitHub API

Справочник для любой работы с сетью в этом клиенте: сколько стоит достать много файлов, какие способы существуют и где у них потолки.

Приложение — SPA без бэкенда, поэтому лимиты GitHub — жёсткое проектное ограничение, а не деталь реализации. Вопрос «сколько это стоит запросов и можно ли забатчить» уже решался трижды: синхронизация корпуса бота (ADR-0004), кэш тел файлов, сборка пакета промта (ADR-0016).

**Статус фактов.** Всё, что помечено «замер», измерено против живого `zenmoney/sms-formats` в августе 2026 — цифры корпуса с тех пор растут. Всё остальное — цитаты из документации GitHub со ссылками, перепроверяемые по ним.

---

## Способы достать тела многих файлов

### GraphQL с алиасами — единственный настоящий батч

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

Замер на 162 алиасах (все форматы `src/СберБанк-ru_4624`): запрос ~59 KB, ответ полный (162/162 непустых, `isTruncated: false`), `rateLimit.cost: 1`, `nodeCount: 0`. Весь слой по крупнейшему банку — **один запрос и одно очко лимита из 5000/час**.

Проверено дополнительно:

- `expression` принимает и имя ветки (`main:path`), и полный commit SHA (`ac2c03…:path`);
- алиасы с разными ref'ами смешиваются в одном запросе;
- `<headSha>:path` резолвится из **base**-репозитория даже для fork-PR, в том числе закрытого без мержа;
- несуществующий путь возвращает `null` — отличимо от бинарного файла (`Blob.text == null`) и от обрезанного тела (`isTruncated`);
- анонимно GraphQL **недоступен**: `POST /graphql` без токена → `403`.

Схема (первоисточник — [опубликованный SDL](https://docs.github.com/public/fpt/schema.docs.graphql)): `Repository.object(expression: String)` — «A Git revision expression suitable for rev-parse»; `Blob.text: String` — «**UTF8 text data or null if the Blob is binary**»; `Blob.isTruncated: Boolean!`.

### Git Trees — состав и blob SHA за один запрос

`GET /repos/{o}/{r}/git/trees/{tree_sha}?recursive=1`. Работает и с синтаксисом `main:src/<bank>` (поддерево банка) — 163 записи по Сберу, `truncated: false` (замер). Содержимого не отдаёт, только `path`/`sha`/`type`/`size`.

Полезен как дешёвый способ узнать blob SHA — одинаковый SHA в двух ref'ах означает, что файл не менялся, и второй запрос не нужен. За телами всё равно идти в blobs, по одному запросу на blob.

Замер по всему репозиторию: 8213 записей, `truncated: false`; 730 папок банков; крупнейший банк — 162 blob'а.

### Contents — то, чем клиент пользуется для одиночных файлов

`GET /repos/{o}/{r}/contents/{path}?ref=…`. Один файл — один запрос.

Как пакетный источник не годится: листинг каталога (`contents/src/СберБанк-ru_4624/formats?ref=main` → 161 запись, замер) отдаёт `name`/`sha`/`size`/`type` **без `content`**, только `download_url`, и тот > «Download URLs expire and are meant to be used just once».

### Tarball / zipball — из браузера закрыт

`GET /repos/{o}/{r}/tarball/{ref}` → `302` на `codeload.github.com`. Замер заголовков: у `api.github.com` `access-control-allow-origin: *`, у `codeload.github.com` — `access-control-allow-origin: https://render.githubusercontent.com`. **CORS не пускает браузерный клиент на codeload**; без прокси вариант «скачать архив ref'а одним запросом» для SPA невозможен. Плюс пришлось бы тащить весь репозиторий ради одного банка и распаковывать gzip+tar в браузере.

(ADR-0004 отвергает tarball для бота по другой причине — отсутствие git-дельты при онгоинге. В Node CORS не мешает.)

### raw.githubusercontent.com — мимо core-лимита, но пофайлово

Замер: `access-control-allow-origin: *`, `cache-control: max-age=300`, есть `ETag`, и **нет ни одного заголовка `x-ratelimit-*`** — отдача не тарифицируется core-лимитом REST API. Тарифицируется ли она чем-то другим — **в документации не найдено**, официальных чисел GitHub не публикует.

Всё ещё один запрос на файл. Кандидат на фолбэк для анонимного режима, но это неофициальный путь: поведение не гарантировано контрактом API.

---

## Rate limit

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

Замер подтверждает: анонимный `GET https://api.github.com/repos/zenmoney/sms-formats` отдаёт `x-ratelimit-limit: 60`, `x-ratelimit-resource: core`.

**Secondary rate limits** (та же страница) — важны, потому что код шлёт запросы пачкой через `Promise.all`:

> «No more than **100 concurrent requests** are allowed. This limit is shared across the REST API and GraphQL API.»

> «No more than **900 points per minute** are allowed for REST API endpoints, and no more than **2,000 points per minute** are allowed for the GraphQL API endpoint.»

Сотня параллельных `getContent` не упирается в 100 concurrent только потому, что браузер сам ограничивает число соединений на хост; полагаться на это не стоит. Best practices рекомендуют прямо обратное:

> «To avoid exceeding secondary rate limits, you should make requests **serially instead of concurrently**.»
> — [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)

### GraphQL

Первоисточник: [Rate limits and node limits for the GraphQL API](https://docs.github.com/en/graphql/overview/rate-limits-and-node-limits-for-the-graphql-api).

- Лимит — **5 000 points/час на пользователя** (10 000 для GitHub Enterprise Cloud).
- Стоимость запроса: > «Add up the number of requests needed to fulfill each unique connection in the call… **Divide the number by 100 and round the result to the nearest whole number**… The minimum point value of a call to the GraphQL API is **1**.»
  Запрос из N алиасов `object(expression:…)` не содержит ни одного connection → стоит **1 point**.
- Ограничения: > «Individual calls cannot request more than **500,000 total nodes**.» и > «If GitHub takes more than **10 seconds** to process an API request, GitHub will terminate the request.»
- **Потолок на число алиасов и на размер ответа в документации не описан.** Практические границы — 500k nodes, 10-секундный таймаут и `Blob.isTruncated`. Порог усечения `Blob.text` документация тоже не называет. Отсюда правило батчить алиасы (ADR-0016 берёт ~50): таймаут теряет весь ответ целиком, и отказ приходит на самых крупных банках.

### Что это значит по бюджету

Ориентир — банк на 162 файла, два слоя:

| Режим | Бюджет | Стоимость |
|---|---|---|
| Аноним, пофайловый REST | 60/час | 324 запроса — **невозможно** |
| Токен, пофайловый REST | 5 000/час | 324 — ~15 сборок в час |
| Токен, GraphQL | 5 000 points/час | **1–2 points** |
| Аноним, GraphQL | — | **недоступно (403)** |

Вывод, зафиксированный в ADR-0016: любая фича, которой нужны тела многих файлов, требует токена и GraphQL.

---

## Условные запросы (ETag) и 304

Ключевая цитата — [Best practices for using the REST API](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api):

> «Most endpoints return an `etag` header, and many endpoints return a `last-modified` header. You can use the values of these headers to make conditional GET requests. If the response has not changed, you will receive a `304 Not Modified` response. **Making a conditional request does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized with an `Authorization` header.**»

Два следствия:

1. Освобождение 304 от лимита оговорено **только для аутентифицированных** запросов. Для анонимного клиента документация такой гарантии не даёт — ETag не спасает анонимный режим от лимита 60/час. **В документации не найдено** явного утверждения про 304 у анонимных запросов.
2. Про conditional requests в GraphQL документация молчит — **в документации не найдено**.

CORS для условных запросов из браузера разрешён явно — [Using CORS and JSONP](https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests):

> «The REST API supports cross-origin resource sharing (CORS) for AJAX requests **from any origin**.»

В preflight-ответе разрешён `If-None-Match`, а `ETag` перечислен в `Access-Control-Expose-Headers` — то есть ETag-кэширование тел файлов из SPA технически возможно. В клиенте не реализовано: Octokit сам условных запросов не делает.

---

## Потолки эндпоинтов

- **Git Trees** ([docs](https://docs.github.com/en/rest/git/trees)): > «the limit for the tree array is **100,000 entries with a maximum size of 7 MB** when using the `recursive` parameter».
- **Git Blobs** ([docs](https://docs.github.com/en/rest/git/blobs)): поддерживает `application/vnd.github.raw+json`, blob до **100 MB**. Батчинга нет — один blob на запрос.
- **Contents** ([docs](https://docs.github.com/en/rest/repos/contents)): > «**1 MB or smaller**: All features of this endpoint are supported»; каталог — > «This API has an upper limit of **1,000 files for a directory**».
- **Tarball** (та же страница): документирован только 302-редирект; > «For private repositories, these links are temporary and **expire after five minutes**». Про codeload и его CORS в документации ничего нет — **в документации не найдено**.

---

## Кэш GitHub мешает после записи

Аутентифицированные GET GitHub отдаёт с `Cache-Control: private, max-age=60`, из-за чего браузер после публикации возвращает старое тело. Клиент обходит это cache-bust-параметром `_cb` (`cacheBustParam` в `src/domain/github/client.ts`). Это единственное место в коде, где HTTP-кэш GitHub вообще учитывается.
