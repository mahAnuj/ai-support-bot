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
>   (`widget-routes.test.ts`, `owner-model-routes.test.ts`).
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
| `EMBED_TOKEN_KEY` | "Connect your own database" and "Use your own model" (encrypting builder, widget and model tokens, which carry connection strings, owner API keys and allowed sites) | `openssl rand -base64 32`; must match `^[A-Za-z0-9+/]{43}=$`. Runtime only, read on every call, never at import. Missing or invalid: both features report unavailable and token requests get 503; demo mode works, and allowed sites are kept with the demo widget in memory. Rotating it invalidates every token, saved model and persistent embed |
| `ALLOW_PRIVATE_DB_HOSTS` | Connecting to localhost/private/link-local database hosts | `1` to allow, including plain TCP to them. `NODE_ENV=development` also allows. Leave unset on public deployments |
| `ALLOW_PRIVATE_MODEL_HOSTS` | Owner model addresses on localhost/private/link-local hosts (for example a local mock) | `1` to allow, including plain `http:` to them. `NODE_ENV=development` also allows. Read on every call. Leave unset on public deployments |
| `TEST_DATABASE_URL` | Running `pg.integration.test.ts` | Optional; the suite is skipped without it |

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
  optional owner model, and model `sbm1_`), `connection.ts` (connection-string validation and host
  classification), `pg-pool.ts` (DNS/private-host check and a bounded pool
  cache), `schema.ts` (the `support_bot` DDL and `ensureSchema`),
  `migrate.ts` (idempotent copy of a demo session into Postgres), `errors.ts`
  (fixed error codes; client-safe) and `log.ts` (fingerprints and the
  retrieval log line).
- **`src/lib/storage/resolve.ts`** — **the single place routes get a store
  from.** `resolveBuilderStore(request)` reads the `x-storage-token` header (no
  header means `memoryStore`). `resolveWidget(key)` branches on the key:
  `widget-…` is memory (not found if the widget is sealed), `sbw1_…` and
  `sbw2_…` are widget tokens, anything else is not found. It also returns the
  widget's access policy (`any`, `legacy` or `exact`) and, for `sbw2_`, its
  owner model; routes only apply what it returns.
- **`scripts/support-bot-schema.sql`, `scripts/support-bot-role.sql`** — the
  human-run setup SQL and least-privilege role. `schema.test.ts` checks the
  schema file matches `SCHEMA_STATEMENTS`.
- **`src/lib/guard.ts`** — per-IP rate limits, input size caps, the legacy
  `allowed_domains` check, and `widgetOriginAllowed`/`widgetCorsHeaders`,
  which apply a widget's access policy.
- **`src/app/api/`** — route handlers: `chat`, `upload`, `widget/chat`,
  `widget/generate`, `widget/script/[key]`, `model/validate`, and
  `storage/status`, `storage/connect`, `storage/documents`.
- **`src/components/model/`** — the builder's "Use your own model" step
  (`OwnModelStep`) and the `useOwnModel` hook, which keeps the model token in
  `localStorage` and sends it as `x-model-token`.
- **`src/components/storage/`** — the builder's connect step
  (`ConnectDatabaseStep`), the storage-mode label and the
  `useStorageConnection` hook, which keeps the builder token in
  `localStorage` and sends it as `x-storage-token`.
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
the 4,200 `MAX_TOKEN_LENGTH` that applies to every other token. Re-run that
test and update these numbers if a token field or cap changes.

### Invariants

- **Two stores, one interface.** Demo data is in-memory and per-process; only
  data in a connected Postgres survives restarts. Routes get their store from
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
  token, the demo model is used.
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
  `pg-pool.ts`) use Node modules and must not be imported by client
  components; only `errors.ts` is client-safe.
- **Tokens are purpose-bound.** Builder routes (and `storage/connect`) reject
  `sbw1_`/`sbw2_` widget tokens and `sbm1_` model tokens in `x-storage-token`
  with 403 before decrypting. Widget routes reject `sbb1_` builder and `sbm1_`
  model tokens. `x-model-token` rejects builder and widget tokens.
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
  5 per minute per IP.
- **Retrieved document text is wrapped in `<documents>` and declared data**
  (`wrapDocuments` and `DOCUMENTS_RULE` in `src/lib/llm.ts`). Keep new
  prompt paths going through it.
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
