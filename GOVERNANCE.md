# Governance

This app turns uploaded documents into a support assistant that can be embedded
on any website. Documents are indexed on the server; each answer is generated
by a model on Groq and spends the deployment's Groq quota. This file records what is enforced, where
the data goes, and what is still open. It describes controls; it is not a
certification.

## What a caller can and cannot do

| Can | Cannot |
| --- | --- |
| Upload TXT, MD, PDF or DOCX files up to 10 MB each | Choose where an upload is written on disk |
| Chat with the documents of a session whose ID it holds | Discover other sessions' IDs from the API |
| Create a widget from a session it holds, optionally limited to listed domains | List, export or delete other users' data |
| Send up to 20 chat requests and 10 uploads per minute per IP, per server instance | Send prompts or messages beyond the size caps |

## Controls

| Control | Where | What it prevents |
| --- | --- | --- |
| Random temp file names | `src/app/api/upload/route.ts` | The uploaded filename is never part of a path, so `../` in a name cannot write or delete outside the temp directory. |
| Unguessable IDs | `generateUUID` in `src/lib/database.ts` | Session IDs, widget keys and keys come from `crypto.randomUUID()`, not the predictable `Math.random`. |
| No debug route | removed `src/app/api/debug` | Nothing lists sessions or documents, and nothing wipes the store, without authentication. |
| Rate limits | `isRateLimited` in `src/lib/guard.ts`, called first in every route | One client cannot run unbounded requests against the Groq key or the server's CPU. |
| Input size caps | `LIMITS` in `src/lib/guard.ts` | Messages are capped at 2,000 characters and custom system prompts at 4,000. |
| Widget domain allowlist | `originAllowed` in `src/lib/guard.ts`, checked in `src/app/api/widget/chat/route.ts` | A widget with `allowed_domains` answers only pages on those domains or their subdomains. |
| Documents marked as data | `wrapDocuments` and `DOCUMENTS_RULE` in `src/lib/llm.ts` | Retrieved text is fenced in `<documents>` and the model is told not to follow instructions inside it. |
| Loud failures | `generateEmbeddings` in `src/lib/embeddings.ts`, `generateResponse` in `src/lib/llm.ts` | A failed embedding fails the upload instead of storing a zero vector and reporting success. A failed chat call returns an error instead of a canned answer that looks like a working bot. |
| Calibrated retrieval | `MIN_SIMILARITY` in `src/lib/embeddings.ts` | Passages are used only above a cut-off measured for the embedding model, so an unrelated question gets a general answer instead of loosely related passages. |
| No unbacked claims | `src/app/page.tsx`, `README.md` | Made-up analytics, a stub audit log, stub SSO and invented customer metrics were removed. |

## Where data goes

- **Stays on the server:** uploaded documents are embedded in-process with
  `all-MiniLM-L6-v2`. Their text is not sent anywhere to be indexed. The
  model's weights are downloaded once from Hugging Face; that download sends
  no user data.
- **To Groq:** every visitor question with the matching passages, to generate
  the answer (`openai/gpt-oss-20b` unless `GROQ_MODEL` says otherwise). In
  the builder's preview chat the question is also sent once more first, so the
  model can reword it for search; the widget does not do this. By default Groq
  may store the inputs and outputs of each request for up to 30 days, for
  reliability and compliance. The organisation's *Inference APIs ZDR* setting
  (Settings, Data Controls) turns that off. Enable it before real visitor
  traffic.
- **To server memory:** documents, chunks and embeddings, held in `Map`s in
  `src/lib/database.ts`. They are not written to a database and are lost when
  the server instance restarts. Different instances do not share them.
- **To the browser:** answers, the names of the source files used, and a
  retrieval match score.
- **To the server log:** request diagnostics, including filenames and the
  length of each question. The text of visitor questions is not logged.

## The retrieval match score

The API calls it `confidence`; the UI labels it a match score. It comes from
`matchScore` in `src/lib/embeddings.ts`: the best passage's cosine similarity,
placed on a 0 to 100 scale between `MIN_SIMILARITY` (0.15) and
`STRONG_SIMILARITY` (0.5). It is 0 when no passage was used. It measures how
closely a passage matches the question. It does not measure whether the answer
is correct.

The cut-offs were measured against `faq.md`. Passages that answer a question
scored 0.18 to 0.57; for unrelated questions the best passage scored under
0.10. Some answers rank below other passages, because chunks are fixed
1,000-character slices that can split an answer.

Earlier versions returned a different number from the widget route: 85 to 95
whenever the model's answer was long. Neither widget script displays the
field, but API clients could read it. That number is gone.

## Known gaps

- **Retrieval quality is measured on one document.** The cut-offs suit
  `faq.md`; other documents may need different values.
- **No authentication.** Anyone can use the builder, and a session ID is the
  only thing protecting a session's documents.
- **Rate limits are per instance.** On a platform that runs many instances, the
  effective limit is higher, and a restart resets the counts.
- **The domain allowlist relies on the browser's `Origin` header.** It stops
  other websites embedding a widget; it does not stop a script that forges the
  header. It is also opt-in: the builder UI does not set it yet, and an empty
  list allows every site.
- **Fencing documents reduces prompt injection; it does not prevent it.** A
  document written to manipulate the model can still influence answers.
- **No retention control.** Data lasts until the instance restarts, and there
  is no way to delete one session's documents on request.
- **No automated tests.** `npm test` finds no test files.

## How the controls were checked

Against `npm run build && npm start`:

- `GET /api/debug` returns 404.
- An upload named `../../../evil-test.txt` is written to
  `<tmpdir>/upload-<uuid>.txt`.
- The 21st `/api/chat` call from one IP within a minute returns 429.
- A 5,000-character system prompt returns 400.
- A chat request with an invalid Groq key returns 500 with the provider's
  error, not a canned answer.
- With `faq.md` uploaded, "What file types can I upload?" retrieves three
  passages; "What is the capital of France?" retrieves none.
- `originAllowed` accepts `shop.example.com` for `example.com` and rejects
  `example.com.evil.com`, `notexample.com` and a missing origin.
