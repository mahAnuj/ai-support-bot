# Contributing

Thanks for taking a look. Issues and pull requests are welcome.

## Getting set up

Requires Node 20+.

```bash
git clone https://github.com/mahAnuj/ai-support-bot.git
cd ai-support-bot
npm install
echo "OPENAI_API_KEY=sk-your-key" > .env.local
npm run dev
```

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

`npm run build` passing **without** `OPENAI_API_KEY` is a real requirement, not
a nicety. Hosts like Vercel do not expose runtime secrets to the build step, so
constructing an SDK client at module scope breaks production deploys — that was
a real outage in this repo. Build clients lazily inside a function.

## Tests

The only tests so far cover `src/lib/storage/` (tokens, connection-string
validation, error mapping, schema SQL), in `src/lib/storage/__tests__/`. They
need no env vars or database. `pg.integration.test.ts` runs only when
`TEST_DATABASE_URL` points at a Postgres with pgvector installed; otherwise it
is skipped.

Library tests need `/** @jest-environment node */` at the top (the default is
jsdom). **Tests for the rest of the app would be a genuinely useful
contribution.** Put them in `src/**/__tests__/` or name them `*.test.ts`. Good
targets:

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
