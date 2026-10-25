# AGENTS.md

Guidance for AI coding agents working in this repository. Also useful to humans.

## Commands

```bash
npm install
npm run dev     # Next.js dev server (turbopack) on :3000
npm run build   # production build - works without any env vars set
npm start       # serve the production build
npm run lint    # next lint (currently clean)
npm test        # jest - unit tests, no env or database needed

cd connector && npm ci && npm test   # reference connector server: tsc, then node --test; no network, database or key
```

> **What `npm test` covers.**
> - `src/lib/storage/__tests__/`: tokens (including an `sbw1_` fixture from
>   before `sbw2_` existed), connection-string validation, error mapping,
>   store and policy resolution, and the schema SQL.
> - `src/lib/__tests__/origins.test.ts`: allowed-site normalisation and exact
>   matching, the legacy `originAllowed` cases and the widget CORS headers.
> - `src/lib/model/__tests__/`: the model URL guard with mocked DNS
>   (`url-guard.test.ts`), the OpenAI-compatible adapter against a mock HTTP
>   server started inside the test (`openai-compatible.test.ts`), and model
>   tokens, purpose binding and the worst-case token size
>   (`model-token.test.ts`).
> - `src/app/api/widget/__tests__/`: route tests that call the exported
>   handlers of the widget chat, script and generate routes and the preview
>   chat route, with the embedding and model calls mocked
>   (`widget-routes.test.ts`, `owner-model-routes.test.ts`). In connector
>   mode, `connector-widget-routes.test.ts` also covers the upload route
>   (no embedding, no memory write), the preview and widget chat on each
>   answer path with no Groq fallback, generate (`origins_required`,
>   `connector_no_documents`, `embed_too_large`) and `sbw3_` on the script
>   and chat routes.
> - `src/lib/connector/__tests__/`: the client against a mock backend started
>   inside the test (`test/helpers/connector-mock-backend.ts`): signing,
>   status mapping, timeouts, size and shape bounds, the address guard, no
>   echo of backend bodies and one log line per call (`client.test.ts`); the
>   shared signing vectors (`signing.test.ts`); `sbc1_`/`sbw3_` tokens and the
>   worst-case embed size (`connector-token.test.ts`); purpose binding
>   (`purpose.test.ts`); and the three answer paths (`answer.test.ts`).
> - `src/app/api/connector/__tests__/connector-routes.test.ts`: connect, test
>   and documents routes, including the one-time secret, rate limits, the 8 KB
>   body cap and purpose binding.
> - `src/lib/storage/__tests__/connector-resolve.test.ts`: `sbc1_` in
>   `resolveBuilderStore` and `sbw3_` in `resolveWidget`.
> - `connector/test/` (run from `connector/`, not by jest): signing against
>   the same vector file, verification, the server against an in-memory store
>   and fake embedder, the answer model against a local mock, config, logs and
>   the signing CLI. `pg.integration.test.ts` there runs only with
>   `TEST_DATABASE_URL`.
>
> Library and route tests start with `/** @jest-environment node */` (the
> default environment is jsdom; `jest.setup.js` guards its `Element` polyfill
> so node suites can run). No test touches the network or needs a real key.
> `pg.integration.test.ts` is skipped unless `TEST_DATABASE_URL` points at a
> Postgres with pgvector, so a green run without it says nothing about the
> Postgres store. Chunking, the in-memory store on its own, the upload, storage
> and model-validate routes, and the UI have no tests. Do not add
> `--passWithNoTests` or skip failing suites to get a green run; close the gap
> with a test instead.

## Environment

| Variable | Needed for | Notes |
| --- | --- | --- |
| `GROQ_API_KEY` | Chat answers and query rewording when no owner model is attached | Runtime only — the build does not need it |
| `GROQ_MODEL` | Optional demo chat model override | Defaults to `openai/gpt-oss-20b` |
| `NEXT_PUBLIC_BASE_URL` | Widget embed URLs | Falls back to `VERCEL_URL` |
| `EMBED_TOKEN_KEY` | "Connect your own database", "Use your own model" and "Connect your backend" (encrypting builder, widget, model and connector tokens, which carry connection strings, owner API keys, backend signing secrets and allowed sites) | `openssl rand -base64 32`; must match `^[A-Za-z0-9+/]{43}=$`. Runtime only, read on every call, never at import. Missing or invalid: all three features report unavailable and token requests get 503; demo mode works, and allowed sites are kept with the demo widget in memory. Rotating it invalidates every token, saved model, backend link and persistent embed |
| `ALLOW_PRIVATE_DB_HOSTS` | Connecting to localhost/private/link-local database hosts | `1` to allow, including plain TCP to them. `NODE_ENV=development` also allows. Leave unset on public deployments |
| `ALLOW_PRIVATE_MODEL_HOSTS` | Owner model addresses on localhost/private/link-local hosts (for example a local mock) | `1` to allow, including plain `http:` to them. `NODE_ENV=development` also allows. Read on every call. Leave unset on public deployments |
| `ALLOW_PRIVATE_CONNECTOR_HOSTS` | Backend base URLs on localhost/private/link-local hosts (for example the reference server on `http://127.0.0.1:8080`) | `1` to allow, including plain `http:` to them. `NODE_ENV=development` also allows. Read on every call, so `sbc1_`/`sbw3_` tokens for such hosts are refused on a server without it. Leave unset on public deployments |
| `TEST_DATABASE_URL` | Running `pg.integration.test.ts` (app and `connector/`) | Optional; the suite is skipped without it |

Embeddings need no key: they run on the server (see `src/lib/embeddings.ts`).

**The build must never require a runtime secret.** `next build` evaluates
route modules while collecting page data; an SDK client constructed at module
scope once broke production deploys. `demoProvider()` in
`src/lib/model/provider.ts` therefore reads `GROQ_API_KEY` and `GROQ_MODEL`
only inside `complete`. If you add a client, construct it inside a function,
not at import time. The same goes for storage: no `new Pool`, DNS
lookup, key read or `BlockList` at module scope, and the storage GET routes
are `force-dynamic` so the build does not bake in build-time env.

## Architecture

A Next.js 15 App Router application that turns uploaded documents into a
retrieval-backed support assistant, then emits an embeddable widget for it.

- **`src/app/page.tsx`** — the builder UI: configure the assistant, upload docs,
  preview the chat, generate embed code. Holds `UNIVERSAL_ASSISTANT.systemPrompt`.
- **`src/lib/llm.ts`** — prompts and `generateResponse` for answers. It takes
  a `ChatProvider` from the caller and never picks one itself.
- **`src/lib/model/`** — the only way to reach a chat model.
  - `provider.ts`: the `ChatProvider` interface and the adapter registry,
    which has one entry, OpenAI-compatible. `demoProvider()` is the
    deployment's Groq account; `ownerProvider(config)` is a site owner's
    endpoint.
  - `openai-compatible.ts`: the adapter, on `node:http`/`node:https` with no
    SDK and no `fetch`. It never follows redirects, caps output at 1,024
    tokens and the response at 1 MB, times out after 30 s (10 s for
    validation), and throws only `ModelError`.
  - `url-guard.ts`: static checks on the base URL plus `guardedLookup`, which
    classifies every DNS answer and pins the socket to it.
  - `shared.ts`: client-safe limits, presets, error codes and fixed messages.
  - `resolve.ts`: `resolveBuilderModel` reads `x-model-token`, and
    `modelErrorResponse` builds the error body.
- **`src/lib/origins.ts`** — client-safe allowed-site normalisation and exact
  matching, shared by the builder field and the widget routes.
- **`src/lib/embeddings.ts`** — `generateEmbeddings` with
  `Xenova/all-MiniLM-L6-v2` via transformers.js, run in-process. The model
  (~23 MB) downloads from Hugging Face on first use into the temp directory.
  Also holds `MIN_SIMILARITY`, `STRONG_SIMILARITY` and `matchScore`.
- **`src/lib/documents.ts`** — file ingestion and chunking. Handles PDF (via
  `pdf-parse`), TXT and MD properly; **DOCX is crude XML tag-stripping**, not a
  real parser, despite what the file list implies.
- **`src/lib/rag.ts`** — retrieval: embed the query, find relevant chunks,
  assemble context. Takes a `KnowledgeStore`; it does not import a store.
- **`src/lib/storage/`** — where knowledge lives. `types.ts` defines the
  `KnowledgeStore` interface (workspaces, documents, chunk search, widgets).
  Two implementations:
  - `memory-store.ts` — `memoryStore`, a thin adapter over
    `src/lib/database.ts` (the demo store: `Map`s plus a hand-rolled
    `cosineSimilarity`, lost on restart, not shared between instances).
  - `pg-store.ts` — `createPostgresStore(connection, workspaceId)`, the user's
    own Postgres with pgvector, every query bound to one workspace.

  Supporting modules: `token.ts` (AES-256-GCM tokens: builder `sbb1_`, widget
  `sbw1_`, compressed widget `sbw2_` carrying a source, allowed sites and an
  optional owner model, and model `sbm1_`; it also defines the connector
  prefixes `sbc1_` and `sbw3_` and exports the sealer as `sealPrefixed` /
  `openPrefixed`), `connection.ts` (connection-string validation and host
  classification), `pg-pool.ts` (DNS/private-host check and a bounded pool
  cache), `schema.ts` (the `support_bot` DDL and `ensureSchema`),
  `migrate.ts` (idempotent copy of a demo session into Postgres), `errors.ts`
  (fixed error codes; client-safe) and `log.ts` (fingerprints and the
  retrieval log line).
- **`src/lib/storage/resolve.ts`** — **the single place routes get a store
  from.** `resolveBuilderStore(request)` reads the `x-storage-token` header (no
  header means `memoryStore`; `sbc1_…` gives a `kind: 'connector'` context
  with no store). `resolveWidget(key)` branches on the key: `widget-…` is
  memory (not found if the widget is sealed), `sbw1_…` and `sbw2_…` are
  widget tokens, `sbw3_…` is a connector widget (no store; the token is the
  whole record), anything else is not found. It also returns the widget's
  access policy (`any`, `legacy` or `exact`) and, for `sbw2_`/`sbw3_`, its
  owner model; routes only apply what it returns. The connector variants
  declare `store?: undefined`, so a route that calls a store method without
  branching on `kind` fails `tsc`.
- **`src/lib/connector/`** — the only way to reach an owner's backend
  (connector API v1, `docs/connector-api.md`).
  - `shared.ts` (client-safe): limits, timeouts, header names, patterns,
    types, the `connector_*` error codes with fixed messages and statuses,
    and `ConnectorError`.
  - `signing.ts`: canonical string, HMAC-SHA256 signature headers, and the
    key id, secret and nonce generators.
  - `client.ts`: the transport on `node:http`/`node:https`, reusing
    `checkModelBaseUrl` and `guardedLookup` with its own
    `ALLOW_PRIVATE_CONNECTOR_HOSTS` flag; no redirects, 1 MB responses,
    per-op timeouts, reply shape checks, and one log line per call. Also
    `buildDocumentPayload`, which checks the document limits before any call.
  - `log.ts`: `connectorLabel` (`backend=#<fingerprint>`) and the per-call
    log line.
  - `token.ts`: the `sbc1_` and `sbw3_` payloads, sealed with
    `sealPrefixed` from `src/lib/storage/token.ts`.
  - `resolve.ts`: `resolveBuilderConnector` for the connector routes, and
    `connectorErrorResponse`.
  - `answer.ts`: `answerWithConnector`, the one search-then-answer path the
    preview and widget chat routes share (backend, owner model or demo).
- **`scripts/support-bot-schema.sql`, `scripts/support-bot-role.sql`** — the
  human-run setup SQL and least-privilege role. `schema.test.ts` checks the
  schema file matches `SCHEMA_STATEMENTS`.
- **`src/lib/guard.ts`** — per-IP rate limits, input size caps, the legacy
  `allowed_domains` check, and `widgetOriginAllowed`/`widgetCorsHeaders`,
  which apply a widget's access policy.
- **`src/app/api/`** — route handlers: `chat`, `upload`, `widget/chat`,
  `widget/generate`, `widget/script/[key]`, `model/validate`,
  `storage/status`, `storage/connect`, `storage/documents`, and
  `connector/connect`, `connector/test`, `connector/documents`. `upload`,
  `chat`, `widget/generate` and `widget/chat` branch on `kind: 'connector'`.
- **`src/components/model/`** — the builder's "Use your own model" step
  (`OwnModelStep`) and the `useOwnModel` hook, which keeps the model token in
  `localStorage` and sends it as `x-model-token`.
- **`src/components/connector/`** — the builder's "Connect your backend"
  step (`ConnectBackendStep`) and the `useConnector` hook, which holds the
  secret in React state only until the owner confirms, then keeps the
  `sbc1_` token and display fields in `localStorage`
  (`ai-support-bot.connector`) and sends the token as `x-storage-token`.
- **`src/components/storage/`** — the builder's connect step
  (`ConnectDatabaseStep`), the storage-mode label and the
  `useStorageConnection` hook, which keeps the builder token in
  `localStorage` and sends it as `x-storage-token`.
- **`docs/`** — `connector-api.md` (the connector API v1 spec),
  `connector-openapi.yaml` and `connector-test-vectors.json`, the signing
  vectors that both the app's and `connector/`'s test suites load.
- **`connector/`** — the reference connector server, a separate package
  (`node:http`, TypeScript, Postgres with pgvector, `pg` and
  `@huggingface/transformers` only) with its own tests, `Dockerfile`,
  `docker-compose.yml` and README. Root jest and `tsc` ignore it. It shares
  nothing with the app except the vector file.
- **`test/helpers/connector-mock-backend.ts`** — a mock connector backend
  that verifies signatures, used by the app's connector tests.
- **`src/lib/widget-script.ts`** — the widget JavaScript that customer embeds
  load. `widget/generate` returns a one-line `<script src=".../api/widget/script/<key>">`
  and that route serves this script with the widget's settings filled in.
  It runs on other people's websites.

### Embed token size

The widget key sits in the script URL path. `sbw2_` is deflate-raw compressed
before encryption. `model-token.test.ts` seals 200 seeded worst cases: a
3,000-character connection string, 10 allowed sites of 255 characters, and a
500-character base URL, 200-character model ID and 512-character key. The
largest `sbw2_` token is 7,273 characters, and its script URL (on an
88-character host) is 7,388. `MAX_WIDGET_TOKEN_V2_LENGTH` is 7,400; generate
dry-runs the seal and refuses above 7,400 − 64 with `embed_too_large`, before
creating a widget. The largest `sbm1_` model token is 1,736 characters, under
the 4,200 `MAX_TOKEN_LENGTH` that applies to every other token except
`sbw3_`. Re-run that test and update these numbers if a token field or cap
changes.

`sbw3_` (connector widget) is also deflate-raw compressed, and carries the
widget settings as well as the backend's address, key id and secret, the
allowed sites and an optional owner model. `MAX_WIDGET_TOKEN_V3_LENGTH` is
7,800: an 88-character host plus `/api/widget/script/` (19) plus 7,800 is
7,907, inside an 8,000-character script URL. Generate seals first (the seal is
the dry run) and refuses with `embed_too_large` above 7,800, and again if the
actual `scriptUrl` is over 8,000; the seal also refuses JSON over 64 KiB.
`connector-token.test.ts` measures 200 seeded cases each, with a 500-character
base URL, 10 sites of 255 characters, a 100-character title, a 500-character
welcome message and a 500/200/512-character model unless noted
(token / script URL):

| Profile | Largest | Result |
| --- | --- | --- |
| (a) everything at maximum, random 4,000-character system prompt and 2,000-character role context | 12,265 / 12,380 | refused, `embed_too_large` |
| (b) as (a) without system prompt and role context | 5,384 / 5,499 | fits |
| (c) as (a) with repetitive English prompts at maximum length | 6,348 / 6,463 | fits |
| (d) as (a) with varied English prompts at maximum length | 8,765 / 8,880 | refused |
| (e) typical embed (short URLs, 2 sites, short title and model) with varied prompts at maximum length | 3,688 / 3,803 | fits |

So the full worst case does not fit, by design: the cap is set by the URL
budget, not by the inputs. The builder sends no `system_prompt` or
`role_context` to generate, so its embeds are in the (b) range. The largest
`sbc1_` (500-character base URL) is 852 characters, under the 4,200
`MAX_TOKEN_LENGTH`. Do not raise the `sbw3_` cap or drop the 8,000 check.

### Invariants

- **Two stores, one interface, plus a connector.** Demo data is in-memory and
  per-process; only data in a connected Postgres or on an owner's backend
  survives restarts. Routes get their knowledge source (store or connector)
  from `resolveBuilderStore` / `resolveWidget` in
  `src/lib/storage/resolve.ts`; do not add another way to pick one. No route
  reads `getInMemoryDatabase`.
- **Widget scope differs by store, on purpose.** A demo widget searches the
  chunks tagged with its knowledge base at generate time. A Postgres widget
  searches its whole workspace, including later uploads.
- **Similarity is cosine in both stores.** In memory, `cosineSimilarity`; in
  Postgres, `1 - (embedding <=> $q)` with the `>=` threshold and a
  deterministic tie-break, so both return the same passages. Do not add an
  ANN index (HNSW/IVFFlat) or change the operator without re-measuring parity
  with the memory store and the `MIN_SIMILARITY` cut-off.
- **Parameterised SQL only.** Every query is a fixed string literal with `$n`
  parameters; no template literals or concatenation in SQL. Schema and table
  names are fixed constants (`support_bot.*`), never taken from input or the
  catalog. Bulk inserts use one fixed `unnest(...)` statement.
- **Never `CREATE EXTENSION`, `DROP`, `TRUNCATE` or `ALTER` at runtime.**
  `ensureSchema` creates only missing objects, only from the connect route, and
  refuses tables with another schema version or embedding size.
- **An owner's API key is never logged, returned or stored in plaintext.** It
  exists only inside `sbm1_` and `sbw2_` tokens and in memory during a request.
  Validate returns the token, model ID and host; generate returns no model
  fields. Log model calls only as `model=#<fingerprint>` with a code.
- **No silent Groq fallback.** When an owner model is attached, every
  chat-model call goes to it. A failure is an error (preview 502, widget 503),
  never a Groq answer. With no `x-model-token` and no model in the widget
  token, the demo model is used. In connector mode the same holds for every
  path in `answerWithConnector`: when the backend's `answer` flag is set,
  only the backend writes the answer and no model on this server is called
  (a saved owner model is ignored); a failed search, `/v1/answer` or model
  call is a 502/503, never a Groq answer.
- **A connector secret is shown once and never logged or stored in
  plaintext.** It is generated by `connector/connect` and returned only in
  that response (`Cache-Control: no-store`). Otherwise it exists only inside
  `sbc1_` and `sbw3_` tokens, in server memory during a request, and in the
  builder's React state until the owner confirms. Never write it to
  `localStorage`, a log line, an error body or any other response. Log
  backends only as `backend=#<fingerprint>` via `connectorLabel`, never the
  base URL or key id.
- **Connector failures are mapped, never echoed.** `client.ts` throws only
  `ConnectorError`, whose message is the code. A non-2xx body is never read,
  and only an integer HTTP status is passed on. Responses use
  `connectorErrorMessage`/`connectorErrorResponse`.
- **Each connector call logs exactly one line**, from `runCall` in
  `client.ts`: `connector call op=<op> backend=#<fp> outcome=<code> ms=<n>`.
  Routes may add one line with the same fields; never the question, passage
  text, base URL, key id, secret, signature or a backend body, and no
  passage list or `ragResult`.
- **No copy beyond the request in connector mode.** Uploads go to
  `POST /v1/documents` as passages; this server does not embed them
  (`generateEmbeddings`/`getCachedEmbedding` are never called) and writes
  nothing to the in-memory store. Questions go to one `/v1/search` as typed,
  with no rewording and no embedding here. Generate creates no record: the
  `sbw3_` token is the widget.
- **The connector signs the API path, not the base URL's path.** A backend
  mounted under a prefix verifies `/v1/...`. Change signing only together
  with `docs/connector-test-vectors.json` and both test suites.
- **Provider errors are mapped, never echoed.** The adapter throws only
  `ModelError`, whose message is the code. Responses use `modelErrorMessage`,
  which takes only an integer HTTP status from the provider. Routes log the
  code, never the error object, on the provider path.
- **Allowed sites match by where the list is stored, not its format.** Lists
  from the builder (`sbw2_` token `o` field or memory `allowed_origins`) match
  exact origins. The legacy `allowed_domains` field keeps hostname and
  subdomain matching. The builder never writes to `allowed_domains`.
- **The connection string is never logged or returned.** Not in responses,
  logs or error bodies; log `db=<fingerprint>` instead. `ParsedConnection`
  serialises to a fingerprint label on purpose. Tokens are logged only through
  `keyLabel`.
- **Tokens are decrypted only on the server.** The browser and embed code only
  ever hold the encrypted string. `token.ts` (and `connection.ts`,
  `pg-pool.ts`, and everything in `src/lib/connector/` except `shared.ts`)
  use Node modules and must not be imported by client components; only
  `errors.ts` and `connector/shared.ts` are client-safe.
- **Tokens are purpose-bound.** Builder routes (and `storage/connect`) reject
  `sbw1_`/`sbw2_`/`sbw3_` widget tokens and `sbm1_` model tokens in
  `x-storage-token` with 403 before decrypting. `upload`, `chat` and
  `widget/generate` accept `sbb1_` and `sbc1_`; `storage/documents` refuses
  `sbc1_` with `token_wrong_purpose`. `connector/test`
  and `connector/documents` accept only `sbc1_` (403 for `sbb1_`, widget and
  model tokens), and `connector/connect` refuses widget and model tokens.
  Widget routes reject `sbb1_`, `sbc1_` and `sbm1_`. `x-model-token` rejects
  builder, connector and widget tokens.
- **Postgres errors are mapped, never echoed.** Everything from `pg` goes
  through `mapDriverError`, responses use `storageErrorResponse` with fixed
  messages, and logs use `safeErrorSummary`. `pg` error messages contain the
  user name and host.
- **The embed tag, `/api/widget/script/[key]` and `/api/widget/chat` are a
  public contract.** They run on third-party sites; changing the script URL,
  the script's globals or the chat request/response shape breaks live embeds.
  Owner-entered values go into the script through `jsLiteral`, never raw.
- **Similarity cut-offs belong to the embedding model.** `MIN_SIMILARITY` and
  `STRONG_SIMILARITY` in `src/lib/embeddings.ts` were measured for
  all-MiniLM-L6-v2. Changing the model means re-measuring them; never hard-code
  a threshold in a route.
- **`confidence` in API responses is the retrieval match score** from
  `matchScore`, and 0 when no passage was used. Never set it from the length or
  wording of the model's answer.
- **Never build a filesystem path from an uploaded filename.** Temp files are
  named from `crypto.randomUUID()` plus a checked extension.
- **IDs that grant access come from `crypto.randomUUID()`**, never
  `Math.random`. A session ID is a bearer secret for that session's documents.
- **Every API route checks `isRateLimited` first.** Chat calls spend the
  deployment's Groq quota, or the owner's provider credits when an owner
  model is attached; uploads spend server CPU. Model validation is limited to
  5 per minute per IP; connector connect to 5, connector test to 10 and
  connector documents to 30.
- **Retrieved document text is wrapped in `<documents>` and declared data**
  (`wrapDocuments` and `DOCUMENTS_RULE` in `src/lib/llm.ts`). Keep new
  prompt paths going through it. A backend that writes answers gets the
  passages as JSON; `docs/connector-api.md` requires it to treat them as
  data, which this app cannot enforce.
- **Fail loudly.** Embedding errors throw; never substitute a placeholder that
  lets a failed upload report success.
- **No claim in the UI or README without code behind it.** Fabricated metrics,
  stub "enterprise" features and an unauthenticated debug route were removed
  for this reason; `GOVERNANCE.md` lists what is actually enforced.
- `package.json` sets `"private": true` (it is an app, not a published package)
  while the code is MIT licensed.

## Conventions

- TypeScript, App Router, Tailwind CSS v4. There is no shadcn/ui here despite
  older docs saying so — components under `src/components/ui/` are hand-written.
- Keep `npm run lint` clean and `npm test` passing. There is no CI; run both,
  plus `npm run build` with no env vars, before handing work back.
