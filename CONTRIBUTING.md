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
npm run build   # must succeed with NO env vars set
```

`npm run build` passing **without** `OPENAI_API_KEY` is a real requirement, not
a nicety. Hosts like Vercel do not expose runtime secrets to the build step, so
constructing an SDK client at module scope breaks production deploys — that was
a real outage in this repo. Build clients lazily inside a function.

## Tests

There are none yet. Jest, jsdom and Testing Library are configured and ready,
but no test files exist, so `npm test` exits 1 with "No tests found".

**Adding the first test would be a genuinely useful contribution.** Put it in
`src/**/__tests__/` or name it `*.test.ts`. Good first targets:

- `src/lib/documents.ts` — chunking behaviour on a known input
- `src/lib/database.ts` — `cosineSimilarity` against hand-computed vectors
- `src/lib/rag.ts` — retrieval ordering with a stubbed embedder

Please don't paper over the failure with `--passWithNoTests`.

## What makes a change easy to merge

- **One concern per pull request.**
- **Say what you observed** — the steps you took and what actually happened.
- **Don't claim capabilities the code doesn't have.** This README previously
  advertised Supabase, pgvector and shadcn/ui, none of which are used; that
  cost more trust than the missing features would have.

## Things worth knowing before you change something

- **Storage is in-memory** (`src/lib/database.ts` — plain `Map`s). Data does not
  survive a restart and is not shared between instances. `scripts/setup-db.sql`
  describes a pgvector schema the code does not currently use. Wiring up a real
  datastore is a welcome contribution, but it is a real change, not a config flip.
- **Vector search is in-process cosine similarity**, not a vector database.
- **`public/ai-support-widget.js` runs on other people's websites.** Treat it and
  the `/api/widget/chat` request shape as a public API — a breaking change there
  breaks live embeds.
- **DOCX handling is crude XML tag-stripping**, not a real parser. Swapping in
  something like mammoth would be a good improvement.

## Reporting bugs

Include the exact steps, the file type involved if it is an ingestion issue, and
the full error from both the browser console and the server log.
