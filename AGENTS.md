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
| `GROQ_API_KEY` | Chat answers and query rewording | Runtime only — the build does not need it |
| `GROQ_MODEL` | Optional chat model override | Defaults to `llama-3.1-8b-instant` |
| `NEXT_PUBLIC_BASE_URL` | Widget embed URLs | Falls back to `VERCEL_URL` |

Embeddings need no key: they run on the server (see `src/lib/embeddings.ts`).

**The build must never require a runtime secret.** The chat client is created
lazily in `src/lib/llm.ts` precisely because `next build` evaluates route
modules while collecting page data; constructing it at module scope broke
production deploys. If you add another SDK client, construct it inside a
function, not at import time.

## Architecture

A Next.js 15 App Router application that turns uploaded documents into a
retrieval-backed support assistant, then emits an embeddable widget for it.

- **`src/app/page.tsx`** — the builder UI: configure the assistant, upload docs,
  preview the chat, generate embed code. Holds `UNIVERSAL_ASSISTANT.systemPrompt`.
- **`src/lib/llm.ts`** — the only chat-model surface. Groq through the OpenAI
  SDK (Groq's API is OpenAI-compatible). `generateResponse` for answers;
  client built on first use via `getChatClient()`.
- **`src/lib/embeddings.ts`** — `generateEmbeddings` with
  `Xenova/all-MiniLM-L6-v2` via transformers.js, run in-process. The model
  (~23 MB) downloads from Hugging Face on first use into the temp directory.
  Also holds `MIN_SIMILARITY`, `STRONG_SIMILARITY` and `matchScore`.
- **`src/lib/documents.ts`** — file ingestion and chunking. Handles PDF (via
  `pdf-parse`), TXT and MD properly; **DOCX is crude XML tag-stripping**, not a
  real parser, despite what the file list implies.
- **`src/lib/rag.ts`** — retrieval: embed the query, find relevant chunks,
  assemble context.
- **`src/lib/database.ts`** — **in-memory store**, not a database. `Map`s plus a
  hand-rolled `cosineSimilarity`. Everything is lost on restart, and nothing is
  shared between server instances. There is no Postgres or pgvector despite
  `scripts/setup-db.sql` existing.
- **`src/lib/guard.ts`** — per-IP rate limits, input size caps and the
  per-widget `allowed_domains` origin check used by every API route.
- **`src/app/api/`** — route handlers: `chat`, `upload`, `widget/chat`,
  `widget/generate`.
- **`public/ai-support-widget.js`** — the standalone script embedded on customer
  sites. It talks to `/api/widget/chat`.

### Invariants

- **Storage is ephemeral and per-process.** Any feature that assumes durability
  or cross-instance sharing needs a real datastore first. `scripts/setup-db.sql`
  describes a pgvector schema that the running code does not use.
- **Vector search is in-process cosine similarity** in `src/lib/database.ts` —
  not a vector database.
- **`public/ai-support-widget.js` is a public contract.** It runs on third-party
  sites; changing its API or the shape of `/api/widget/chat` breaks live embeds.
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
  deployment's Groq quota; uploads spend server CPU.
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
- Keep `npm run lint` clean; it is the only automated gate that currently works.
