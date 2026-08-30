# AGENTS.md

Guidance for AI coding agents working in this repository. Also useful to humans.

## Commands

```bash
npm install
npm run dev     # Next.js dev server (turbopack) on :3000
npm run build   # production build - works without any env vars set
npm start       # serve the production build
npm run lint    # next lint (currently clean)
npm test        # jest - see the warning below
```

> **`npm test` currently fails.** Jest, jsdom and Testing Library are fully
> configured (`jest.config.js`, `jest.setup.js`) but the repository contains
> **no test files**, so jest exits 1 with "No tests found". This is a gap, not a
> broken setup — adding a test under `src/**/__tests__/` or `*.test.ts` will
> make it run. Do not "fix" this by adding `--passWithNoTests`; that hides the
> gap rather than closing it.

## Environment

| Variable | Needed for | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | Chat, embeddings, RAG | Runtime only — the build does not need it |
| `NEXT_PUBLIC_BASE_URL` | Widget embed URLs | Falls back to `VERCEL_URL` |

**The build must never require a runtime secret.** The OpenAI client is created
lazily in `src/lib/openai.ts` precisely because `next build` evaluates route
modules while collecting page data; constructing it at module scope broke
production deploys. If you add another SDK client, construct it inside a
function, not at import time.

## Architecture

A Next.js 15 App Router application that turns uploaded documents into a
retrieval-backed support assistant, then emits an embeddable widget for it.

- **`src/app/page.tsx`** — the builder UI: configure the assistant, upload docs,
  preview the chat, generate embed code. Holds `UNIVERSAL_ASSISTANT.systemPrompt`.
- **`src/lib/openai.ts`** — the only OpenAI surface. `generateResponse` for chat,
  `generateEmbeddings` for indexing. Client built on first use via `getOpenAI()`.
- **`src/lib/documents.ts`** — file ingestion and chunking. Handles PDF (via
  `pdf-parse`), TXT and MD properly; **DOCX is crude XML tag-stripping**, not a
  real parser, despite what the file list implies.
- **`src/lib/rag.ts`** — retrieval: embed the query, find relevant chunks,
  assemble context.
- **`src/lib/database.ts`** — **in-memory store**, not a database. `Map`s plus a
  hand-rolled `cosineSimilarity`. Everything is lost on restart, and nothing is
  shared between server instances. There is no Postgres or pgvector despite
  `scripts/setup-db.sql` existing.
- **`src/lib/analytics.ts`**, **`src/lib/enterprise.ts`** — dashboard and
  enterprise-panel support.
- **`src/app/api/`** — route handlers: `chat`, `upload`, `widget/chat`,
  `widget/generate`, `analytics/realtime`, `enterprise`, `debug`.
- **`public/ai-support-widget.js`** — the standalone script embedded on customer
  sites. It talks to `/api/widget/chat`.

### Invariants

- **Storage is ephemeral and per-process.** Any feature that assumes durability
  or cross-instance sharing needs a real datastore first. `scripts/setup-db.sql`
  describes a pgvector schema that the running code does not use.
- **Vector search is in-process cosine similarity** over `text-embedding-3-small`
  in `src/lib/database.ts` — not a vector database.
- **`public/ai-support-widget.js` is a public contract.** It runs on third-party
  sites; changing its API or the shape of `/api/widget/chat` breaks live embeds.
- Chat uses `gpt-4o-mini` and embeddings `text-embedding-3-small`. Both are
  referenced in `src/lib/openai.ts`.
- `package.json` sets `"private": true` (it is an app, not a published package)
  while the code is MIT licensed.

## Conventions

- TypeScript, App Router, Tailwind CSS v4. There is no shadcn/ui here despite
  older docs saying so — components under `src/components/ui/` are hand-written.
- Keep `npm run lint` clean; it is the only automated gate that currently works.
