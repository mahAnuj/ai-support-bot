# Governance

This app turns uploaded documents into a support assistant that can be embedded
on any website. Every answer spends the deployment's OpenAI key, and every
uploaded document is sent to OpenAI. This file records what is enforced, where
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
| Rate limits | `isRateLimited` in `src/lib/guard.ts`, called first in every route | One client cannot run unbounded requests against the OpenAI key. |
| Input size caps | `LIMITS` in `src/lib/guard.ts` | Messages are capped at 2,000 characters and custom system prompts at 4,000. |
| Widget domain allowlist | `originAllowed` in `src/lib/guard.ts`, checked in `src/app/api/widget/chat/route.ts` | A widget with `allowed_domains` answers only pages on those domains or their subdomains. |
| Documents marked as data | `wrapDocuments` and `DOCUMENTS_RULE` in `src/lib/openai.ts` | Retrieved text is fenced in `<documents>` and the model is told not to follow instructions inside it. |
| Loud embedding failures | `generateEmbeddings` in `src/lib/openai.ts` | A failed embedding fails the upload instead of storing a zero vector and reporting success. |
| No unbacked claims | `src/app/page.tsx`, `README.md` | Made-up analytics, a stub audit log, stub SSO and invented customer metrics were removed. |

## Where data goes

- **To OpenAI:** every uploaded document, in chunks, to create embeddings
  (`text-embedding-3-small`); and every visitor question with the matching
  chunks, to generate the answer (`gpt-4o-mini`). OpenAI's API data policy
  applies to what it receives.
- **To server memory:** documents, chunks and embeddings, held in `Map`s in
  `src/lib/database.ts`. They are not written to a database and are lost when
  the server instance restarts. Different instances do not share them.
- **To the browser:** answers, the names of the source files used, and a
  retrieval match score.
- **To the server log:** request diagnostics, including filenames and the
  length of each question. The text of visitor questions is not logged.

## The retrieval match score

The UI and API call it `confidence`. It is the average cosine similarity of the
retrieved chunks to the question, raised by 5 to 10 points when several chunks
match and floored at 40 when any match. It measures how closely the passages
match the question. It does not measure whether the answer is correct. The
field name is kept because `public/ai-support-widget.js` reads it on live sites.

## Known gaps

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

Against `npm run build && npm start` with a fake `OPENAI_API_KEY`:

- `GET /api/debug` returns 404.
- An upload named `../../../evil-test.txt` is written to
  `<tmpdir>/upload-<uuid>.txt`.
- The 21st `/api/chat` call from one IP within a minute returns 429.
- A 5,000-character system prompt returns 400.
- An upload with an invalid OpenAI key returns 500 instead of reporting success.
- `originAllowed` accepts `shop.example.com` for `example.com` and rejects
  `example.com.evil.com`, `notexample.com` and a missing origin.
