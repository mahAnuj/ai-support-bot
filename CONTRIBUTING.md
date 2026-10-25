# Contributing

Thanks for taking a look. Issues and pull requests are welcome.

## Getting set up

Requires Node 20+.

```bash
git clone https://github.com/mahAnuj/ai-support-bot.git
cd ai-support-bot
npm install
echo "GROQ_API_KEY=your_groq_key" > .env.local
npm run dev
```

`GROQ_API_KEY` (free tier at console.groq.com) is the only variable the demo
needs. `EMBED_TOKEN_KEY` is only needed for "Connect your own database" and
"Use your own model", and `ALLOW_PRIVATE_MODEL_HOSTS` only for pointing your
own model at a localhost or private host from a production build; see
`.env.example` for what each one does.

Open http://localhost:3000. Upload a document, ask a question, and you should
see answers cite the file you uploaded.

The build itself needs no secrets — `npm run build` succeeds with no environment
at all, and it must stay that way (see below).

## Before you open a pull request

```bash
npm run lint    # must be clean
npm test        # must pass; needs no env vars or database
npm run build   # must succeed with NO env vars set
```

`npm run build` passing **without** `GROQ_API_KEY` or any other runtime secret
is a real requirement, not a nicety. Hosts like Vercel do not expose runtime
secrets to the build step, so constructing an SDK client at module scope breaks
production deploys — that was a real outage in this repo. The demo chat client,
`demoProvider()` in `src/lib/model/provider.ts`, reads its env only when it is
called; build any new client lazily inside a function the same way.

## Tests

`npm test` covers:

- `src/lib/storage/__tests__/`: tokens, connection-string validation, error
  mapping, store and policy resolution, and the schema SQL.
- `src/lib/__tests__/origins.test.ts`: allowed-site normalisation and matching,
  and the widget CORS headers.
- `src/lib/model/__tests__/`: the model URL guard, the OpenAI-compatible
  adapter against a mock HTTP server, and model tokens.
- `src/app/api/widget/__tests__/`: route tests for the widget chat, script and
  generate routes and the preview chat route, with embedding and model calls
  mocked.

None of them touch the network or need env vars, a real key or a database.
`pg.integration.test.ts` runs only when `TEST_DATABASE_URL` points at a
Postgres with pgvector installed; otherwise it is skipped.

Library and route tests need `/** @jest-environment node */` at the top (the
default is jsdom). **Tests for the untested parts would be a genuinely useful
contribution:** chunking, the in-memory store, the upload, storage and
model-validate routes, and the UI. Put them in `src/**/__tests__/` or name them
`*.test.ts`. Good targets:

- `src/lib/documents.ts` — chunking behaviour on a known input
- `src/lib/database.ts` — `cosineSimilarity` against hand-computed vectors
- `src/lib/rag.ts` — retrieval ordering with a stubbed embedder

Please don't get a green run with `--passWithNoTests` or by skipping a failing suite.

## What makes a change easy to merge

- **One concern per pull request.**
- **Say what you observed** — the steps you took and what actually happened.
- **Don't claim capabilities the code doesn't have.** This README previously
  advertised Supabase, pgvector and shadcn/ui, none of which are used; that
  cost more trust than the missing features would have.

## Things worth knowing before you change something

- **There are two stores behind one interface** (`KnowledgeStore` in
  `src/lib/storage/`). The demo store is in memory (`src/lib/database.ts`,
  plain `Map`s): data does not survive a restart and is not shared between
  instances. Users can connect their own Postgres with pgvector instead; see
  the README's "Connect your own database" and `scripts/support-bot-*.sql`.
  Routes get their store from `src/lib/storage/resolve.ts`. SQL there is fixed
  strings with `$n` parameters only, and connection strings and tokens are never
  logged; read the invariants in `AGENTS.md` before changing it.
- **Vector search is cosine similarity**: in-process for the demo, pgvector's
  `<=>` (exact scan, no ANN index) for Postgres. Both must return the same
  passages.
- **`src/lib/widget-script.ts` runs on other people's websites.** It is served by
  `/api/widget/script/[key]`. Treat it, its globals and the `/api/widget/chat`
  request shape as a public API — a breaking change there breaks live embeds.
- **DOCX handling is crude XML tag-stripping**, not a real parser. Swapping in
  something like mammoth would be a good improvement.

## Reporting bugs

Include the exact steps, the file type involved if it is an ingestion issue, and
the full error from both the browser console and the server log.
