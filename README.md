# ai-support-bot

**An embeddable support assistant that answers from your own documents — built so you can see, and choose, where your data goes.**

Upload your documents, preview the assistant, and paste one `<script>` tag into your site. What sets it apart is not the RAG — it is the control around it:

- **Your documents can stay on your server.** With the [signed connector API](docs/connector-api.md) (OpenAPI spec, shared test vectors and a [reference server](connector/README.md)), this app reaches a backend you run over signed requests and holds no database credentials at all.
- **Local embeddings.** Indexing runs on the server with an open-source model, so no document text goes to a third party just to be searched.
- **Bring your own model or database.** Point it at any OpenAI-compatible model, or your own Postgres with pgvector, through encrypted, scope-separated tokens.
- **Guarded by default.** The server refuses to call localhost or private-network addresses for model, database or backend URLs (unless the operator opts in); widgets answer only on the sites you list; per-IP rate limits and size caps bound abuse and spend.
- **Your database, set up safely in one click.** Connect with your admin login and the app creates its own limited login that can reach only its own tables, then keeps only that one. See [One-click setup](#one-click-setup-recommended).
- **Change it after it's live, with the same embed code.** Title, welcome message, colours, suggested questions, allowed sites, the model and your own instructions are edited in the builder and reach your site on the next page load. See [Change an assistant after it's live](#-change-an-assistant-after-its-live).
- **See what visitors asked, in your own database.** An optional conversation log keeps each question and answer for 1 to 730 days (90 by default), with a notice to visitors while it is on, so you can check answers and find what your documents are missing. See [Conversation log](#-conversation-log).
- **Answers written for visitors.** Visitors never see source file names or match scores, are never asked to upload anything, and see honest waiting messages while an answer is on its way.
- **Honest about what it protects.** [GOVERNANCE.md](GOVERNANCE.md) lists what is enforced, where data goes, and what is still open. It describes controls; it is not a certification.

About 810 tests across the app and the connector. About 40 of them need a disposable Postgres (`TEST_DATABASE_URL`); the rest need no database, network or API keys. MIT licensed.

## ✨ What It Does

### 🎯 **The builder**
- **Custom Configuration**: Set display name, welcome message, colors, and positioning
- **Your Documents**: Upload business documents (PDF, TXT, MD, DOCX) for the assistant to answer from
- **Live Preview**: See exactly how your assistant will look and behave
- **One-line embed**: Generate embeddable JavaScript code for your website
- **Your bots**: One bot per site, each with its own database and settings, all listed in the builder; open any of them without the connection string
- **Your assistants**: Edit an assistant that is already on your site, including your own instructions ("never quote prices"), without new embed code
- **Automation keys**: Let a script or CI job keep the documents in sync, with per-key expiry and an activity log
- **One-click database setup**: The app creates a limited database login for itself, and shows which login it is using
- **Conversation log** (optional): Questions and answers from your widget, kept in your database, with each answer's match score, filterable to unanswered or low-match answers, and downloadable as CSV
- **Fair use on the shared model**: Each bot gets 200 questions a day on the shared demo model (configurable); bots on their own model have no limit
- **Daily stats**: Questions per day, answered from documents, "don't know" answers, failures, and the mean and lowest match score, as numbers only in your database
- **Professional UI**: Clean, mobile-responsive design that works on any website

### 📚 **Intelligent Document Processing**
- **Chunking**: Splits each document into fixed-size passages of about 1,000 characters
- **Local Embeddings**: Passages are embedded on the server with an open-source model (`all-MiniLM-L6-v2`), so indexing needs no API key and sends no document text to a third party
- **Source Attribution** (builder preview only): Shows which documents were used in each response
- **Retrieval Match Score** (builder preview only): Shows how closely the retrieved passages match the question (a similarity score, not a probability that the answer is correct)

### 🌐 **On Your Website**
- **Embeddable Widget**: Copy-paste JavaScript code to add to any website
- **Customizable Appearance**: Match your brand colors and positioning preferences
- **Mobile Optimized**: Works seamlessly on desktop, tablet, and mobile devices
- **Allowed sites**: List up to 10 exact sites (such as `https://example.com`) and the widget refuses to answer anywhere else in a browser
- **Your own model (optional)**: Answer with your own OpenAI-compatible model and API key instead of the shared demo model on Groq. See [Use your own model](#-use-your-own-model)
- **Your own backend (optional)**: Keep documents on a server you run, which this app reaches with signed requests, so the app holds no database credentials. See [Connect your backend](#connect-your-backend)
- **Answers for visitors**: Source file names and match scores never reach the widget. The widget is told it is talking to a visitor, so it never asks them for documents and says "I don't have that information" when the documents are silent
- **Waiting messages**: While an answer is on its way the widget moves from "Looking through the documents" to "Writing an answer", and explains a slow first answer instead of sitting silent
- **Bounded by default**: Per-IP rate limits and input size caps. See [GOVERNANCE.md](GOVERNANCE.md) for what is and is not protected

## 🚀 Quick Start

```bash
# Clone and setup
git clone https://github.com/mahAnuj/ai-support-bot.git
cd ai-support-bot
npm install

# Set your Groq API key (free tier at console.groq.com)
echo "GROQ_API_KEY=your_groq_key" > .env.local

# Start the builder
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) and start building your AI assistant. No documents to hand? Click **Try it with sample documents** to load three short policies from a fictional bike shop (`public/samples/`) and ask about them.

## Four ways to run it

| | Where documents are kept | Who writes the answers | What you run |
| --- | --- | --- | --- |
| **1. Demo** | This deployment's server memory, lost on restart | The demo model on Groq | Nothing |
| **2. Your own database or model key** | Your Postgres with pgvector, or server memory | Groq, or your own OpenAI-compatible model | No server: a database and/or a model API key |
| **3. Your own backend** | Your server, which implements the [connector API](docs/connector-api.md) (for example the reference server in [`connector/`](connector/README.md)) | Your backend, if it offers answering; otherwise your own model or the demo model, through this app | A connector server |
| **4. Fully self-hosted** | Any of the above | Any of the above | This whole app, on a server you control |

1. **Demo.** Upload documents in the builder and generate an embed. Nothing to
   set up beyond the deployment's `GROQ_API_KEY`.
2. **Your own database or model key, no server needed.** Paste a Postgres
   connection string ([Connect your own database](#-connect-your-own-database))
   and/or an OpenAI-compatible model key ([Use your own model](#-use-your-own-model)).
   The credentials travel inside encrypted tokens in your browser and your
   embed code; this deployment decrypts them on each request. Needs
   `EMBED_TOKEN_KEY` on the deployment.
3. **Your own backend.** Run a small server of your own and connect it
   ([Connect your backend](#connect-your-backend)). This app then sends it
   your documents and visitors' questions over signed requests. The tokens
   carry your backend's address, a key id and a signing secret that you can
   revoke on your server, and no database credentials (a model key only if you
   also attach your own model). Needs `EMBED_TOKEN_KEY` on the deployment.
4. **Fully self-hosted.** Run this app yourself so that nothing passes through
   someone else's deployment. There is no packaged image or deploy button for
   the app; it is a standard Next.js server:

   ```bash
   git clone https://github.com/mahAnuj/ai-support-bot.git
   cd ai-support-bot
   npm ci
   npm run build          # needs no env vars
   # set the runtime variables below (GROQ_API_KEY, NEXT_PUBLIC_BASE_URL, EMBED_TOKEN_KEY, ...)
   npm start              # next start, port 3000 by default
   ```

   Put it behind a reverse proxy with TLS, and set `NEXT_PUBLIC_BASE_URL` to
   its public `https://` address so embed codes point at it. Use Node 20 or
   later. The demo store lives in each instance's memory and is not shared, and
   rate limits are counted per instance, so start with one instance. Answers
   still come from Groq (`GROQ_API_KEY`) unless you attach your own model or
   your backend writes them. The server downloads the embedding model from
   Hugging Face the first time it embeds (demo and own-database modes; with a
   backend connected it embeds nothing). You can also deploy it to your own
   Vercel account; see [Deployment](#-deployment).

## 🎥 Demo Features

### **🎨 Live Configuration**
- Real-time preview as you customize
- See exactly what customers will experience
- Instant updates when you change settings

### **📄 Smart Document Processing**
- Drag & drop PDF, DOCX, TXT, MD files
- Automatic chunking and indexing
- Progress indicators and success confirmation

### **🚀 One-line embed**
- Generate JavaScript embed code
- Copy-paste integration for any website
- Complete implementation guide included

## 🎪 How It Works

1. **Test the AI**: Try sample questions to see baseline performance
2. **Upload Documents**: Add your business knowledge (PDFs, docs, text files)
3. **Configure Assistant**: Customize name, welcome message, colors, and position
4. **Live Preview**: See real-time improvements in the chat interface
5. **Embed**: Generate and copy embeddable code for your website

## 📊 Before vs After

| Without Documents | With Documents |
|------------------|----------------|
| Generic responses | Business-specific answers |
| "I don't know" | Cites your actual policies |
| Low retrieval match | High retrieval match |
| Basic information | Answers drawn from your documents |
| No source attribution | Clear document references |

## 🛠 Technology Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS v4
- **Backend**: Next.js API routes (serverless)
- **Storage**: In memory by default (`src/lib/database.ts`, no external database required), your own Postgres with pgvector (see [Connect your own database](#-connect-your-own-database)), or your own backend over the signed connector API (see [Connect your backend](#connect-your-backend))
- **Chat model**: `openai/gpt-oss-20b` on Groq by default (free tier; override with `GROQ_MODEL`), or your own OpenAI-compatible model, called through one small adapter in `src/lib/model/`
- **Embeddings**: `Xenova/all-MiniLM-L6-v2` via transformers.js, run on the server
- **Vector Search**: Cosine similarity, in-process for the demo and with pgvector's `<=>` operator in your database (exact scan, no approximate index)
- **File Processing**: Built-in PDF, TXT, MD, DOCX support
- **Enhancement**: RAG (Retrieval-Augmented Generation)
- **Deployment**: Builds with `npm run build` and runs on Vercel or any Node.js host (no deploy button; see [Deployment](#-deployment))

## 🚀 Deployment

### **Vercel (Recommended)**
```bash
# Build and deploy
npm run build
vercel --prod

# Set environment variables in Vercel dashboard:
# GROQ_API_KEY
# EMBED_TOKEN_KEY   (only if you want "connect your own database", "use your own model" or "connect your backend"; see below)
```

### **Environment Variables**
```bash
# Required
GROQ_API_KEY=your_groq_api_key

# Optional
GROQ_MODEL=openai/gpt-oss-20b
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
EMBED_TOKEN_KEY=          # openssl rand -base64 32; turns on "connect your own database", "use your own model" and "connect your backend"
SHARED_MODEL_DAILY_LIMIT= # questions per bot per UTC day on the shared demo model (default 200; 0 or off = no limit)
ALLOW_PRIVATE_DB_HOSTS=   # 1 = allow localhost/private database hosts on a production build
ALLOW_PRIVATE_MODEL_HOSTS= # 1 = allow localhost/private model addresses on a production build; leave unset in production
ALLOW_PRIVATE_CONNECTOR_HOSTS= # 1 = allow localhost/private backend addresses on a production build; leave unset in production
```

None of these are needed to build. See [.env.example](.env.example).

## 🗄 Connect your own database

By default, documents, chunks, embeddings and widgets live in server memory.
They are deleted when the server restarts, and a demo widget stops answering
then. Connecting your own Postgres database with
[pgvector](https://github.com/pgvector/pgvector) keeps them.

The connect step appears in the builder's Documents section only when the
server has `EMBED_TOKEN_KEY` set (see [below](#embed_token_key)).

### One-click setup (recommended)

Connect with your **admin** login (Neon's `neondb_owner`, Supabase's
`postgres`) and leave **Create a limited login for the assistant** ticked. The
server then, using the admin login for that one request only:

1. turns on pgvector if it is off (`CREATE EXTENSION vector`);
2. creates the `support_bot` tables if they are missing;
3. creates a login `support_bot_app` with a random 48-character password, or
   `support_bot_app_<6 hex>` if that name is taken (an existing login is never
   changed, so nothing using it breaks), with exactly the grants of
   [`scripts/support-bot-role.sql`](scripts/support-bot-role.sql) plus default
   privileges for tables a later version adds;
4. connects as the new login to check it works, then seals **only that login**
   into the builder token, and from then on into embed codes and automation
   keys. The admin login is not saved and its connection pool is closed.

If the login cannot create logins it is used as it is (right for a login that
is already limited). If anything fails part-way, the new login's grants are
revoked and it is dropped, and the builder says it is using the login you
entered. Rollback revokes explicitly rather than using `DROP OWNED BY`, which an
admin that is not a superuser (Neon's owner) is not allowed to run. Through a
pooler that routes by user name (Supabase's `postgres.<project>`), the new login
gets the same suffix.

API callers opt in with `"secureSetup": true` on `POST /api/storage/connect`;
the response then carries `setup: { status: "created", role }`,
`{ status: "already_limited" }` or `{ status: "not_possible", reason }`.

The in-app guide at **`/docs/database`** covers one-click and manual setup,
managing logins, and troubleshooting. The manual steps follow.

**What happens when you press Connect**

1. The server checks the connection string, resolves the host, connects,
   checks that pgvector is installed, and creates the `support_bot` tables
   only if they are missing.
2. Documents already uploaded in this browser session are copied into your
   database, embeddings included. Connecting the same session again does not
   copy them twice.
3. The server returns an encrypted link to your database (a builder token,
   `sbb1_…`). The browser keeps it in `localStorage`. The server does not save
   your connection string anywhere; it exists only inside encrypted tokens, and
   in server memory while a connection to your database is open.
4. From then on, uploads, the preview chat and **Generate** use your database.
   The embed code carries a widget token (`sbw1_…`) instead of a `widget-…`
   key, so the script URL is long: roughly 1,600 characters for a
   1,000-character connection string, and over 4,000 if the user name,
   password or database name is mostly characters that need percent-encoding
   (such as `$`). If you add allowed sites or your own model, the embed
   carries a compressed `sbw2_…` token instead; see
   [Token size](#token-size). The widget keeps
   answering after server restarts.

**Widget scope differs between modes.** A demo widget searches the documents
that were uploaded when it was generated. A widget backed by your database
searches **every document in its workspace**, including ones you upload later.

**Disconnect** in the builder only removes the link from this browser. It does
not revoke anything; see [Revoking access](#revoking-access).

What still leaves your database: each visitor question and the matching
passages pass through this server and go to Groq, or to your own model if you
attached one. See
[GOVERNANCE.md](GOVERNANCE.md#where-data-goes).

### Connection string rules

- `postgres://` or `postgresql://`, one host, at most 1,000 characters.
- Only `sslmode` is kept from the query string; other parameters are dropped.
  Parameters that would change where or how the app connects (`host`,
  `hostaddr`, `port`, `user`, `password`, `dbname`, `options`, `service`,
  `passfile`, `sslcert`, `sslkey`, `sslrootcert`, `sslcrl`) are rejected.
- TLS:
  - no `sslmode` (or `prefer`, `allow`, `verify-ca`, `verify-full`): TLS with
    the certificate and host name checked against Node's trusted CAs
  - `sslmode=require`: encrypted, but the certificate is **not** checked
  - `sslmode=disable`: rejected for public hosts
- Hosts on localhost, private networks or link-local addresses are rejected,
  including host names that resolve to them, unless the server runs with
  `npm run dev` or `ALLOW_PRIVATE_DB_HOSTS=1`. For those hosts a missing
  `sslmode` means a plain TCP connection.

### Step 1: setup SQL (run once, as the database owner or an admin)

Install pgvector in the database once:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then run [`scripts/support-bot-schema.sql`](scripts/support-bot-schema.sql):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/support-bot-schema.sql
```

It stops with an error if pgvector is missing. It creates the `support_bot`
schema with the tables `meta`, `workspaces`, `documents`, `chunks` (embeddings
are `vector(384)`) and `widgets`. It is safe to run twice and never drops,
truncates or alters anything.

If you connect as the database owner, you can skip this file: the app creates
any missing `support_bot` objects itself when you press Connect. It never runs
`CREATE EXTENSION`, `DROP` or `TRUNCATE`. If the tables already exist but were
made for another schema version or embedding size, Connect fails with "made for
a different version or embedding size" and nothing is changed.

### Upgrading a database set up with an earlier version

Run [`scripts/support-bot-upgrade.sql`](scripts/support-bot-upgrade.sql) once
as the admin login. It creates the tables added since v1 (automation keys and
their activity, `widget_prefs`, the conversation log, daily stats), adds newer
columns to tables made from an older script, and grants every assistant login
(`support_bot_app`, and the `support_bot_app_<6 hex>` logins one-click setup
makes) the role script's rights on them. It is idempotent and never drops,
empties or rewrites anything. `src/lib/storage/__tests__/schema.test.ts` fails
if a new optional table is missing from it.

### Step 2 (recommended, or use one-click setup): a least-privilege role

Connecting as the owner gives the app, and anyone who can decrypt a token, the
owner's rights. Instead, run
[`scripts/support-bot-role.sql`](scripts/support-bot-role.sql) as an admin
**after** the setup SQL, with the password replaced:

```sql
-- Least-privilege login role for the AI Support Bot.
--
-- Run this as an admin AFTER scripts/support-bot-schema.sql, then give the app
-- a connection string that logs in as support_bot_app.
--
-- What the role gets:
--   - USAGE on the support_bot schema and SELECT, INSERT, UPDATE on its tables,
--     plus DELETE on documents and chunks so the builder can remove or replace a
--     document. No DELETE on workspaces or widgets, no CREATE, no DDL.
--   - A search_path that finds the pgvector type whether it lives in public
--     (self-hosted, Neon) or extensions (Supabase). Schemas in the list that do
--     not exist are ignored.
-- What it does not get:
--   - No rights on any table in public or any other schema.
--   - CONNECT on the database is granted to PUBLIC by default, so it is not
--     granted here.
--
-- To revoke the app's access, change the password:
--   ALTER ROLE support_bot_app PASSWORD '<new password>';

-- Safe to run more than once. If the role already exists it is left as is
-- (including its password); the grants below are re-applied.

-- Replace the password before running.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'support_bot_app') THEN CREATE ROLE support_bot_app LOGIN PASSWORD 'change-me-to-a-long-random-password'; END IF; END $$;
GRANT USAGE ON SCHEMA support_bot TO support_bot_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA support_bot TO support_bot_app;
GRANT DELETE ON support_bot.documents, support_bot.chunks TO support_bot_app;
ALTER ROLE support_bot_app SET search_path = support_bot, public, extensions;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN GRANT USAGE ON SCHEMA extensions TO support_bot_app; END IF; END $$;
```

What it does:

- The role gets `USAGE` on `support_bot` and `SELECT, INSERT, UPDATE` on the
  tables that exist there when it runs, plus `DELETE` on `documents` and
  `chunks` so the builder can remove a document or replace one uploaded again
  under the same name. No `DELETE` on workspaces or widgets, no DDL, and no
  rights on `public` or any other schema's tables. A role made before this
  change lacks `DELETE`; Remove then says so and gives the one `GRANT` to run. That is why the setup SQL must run
  first: the app cannot create tables as this role.
- `search_path` is set to `support_bot, public, extensions`, so the `vector`
  type is found whether pgvector lives in `public` (self-hosted, Neon) or in
  `extensions` (Supabase). If an `extensions` schema exists, the role also gets
  `USAGE` on it.
- Running it again re-applies the grants. An existing role, and its password,
  are left as they are.

Then connect with `postgresql://support_bot_app:<password>@<host>:5432/<database>`.

### Provider notes

**Supabase**

- Enable `vector` under Database → Extensions, or run
  `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;` in the SQL
  editor. Supabase puts pgvector in the `extensions` schema. Then paste the
  setup SQL and the role SQL into the SQL editor.
- Use the **direct** connection string or the **session pooler** (port 5432)
  from the project's Connect dialog. The direct host may only have an IPv6
  address; if the server cannot reach it, use the session pooler. The
  transaction pooler (port 6543) may reject this app's connection settings;
  you will see "The connection pooler rejected this app's connection settings".
- The pooler's user name includes the project ref (for example
  `postgres.<project-ref>`). For the role above, use
  `support_bot_app.<project-ref>`.
- Supabase signs its certificates with its own CA, which Node does not trust,
  so the default check fails with "A secure connection couldn't be set up".
  Add `?sslmode=require` to the end of the string. The connection is still
  encrypted, but the certificate is not checked.

**Neon**

- Run `CREATE EXTENSION IF NOT EXISTS vector;` in the SQL editor, then the
  setup SQL and the role SQL.
- Neon's connection strings already include `sslmode=require` (encrypted,
  certificate not checked). Other parameters such as `channel_binding` are
  dropped. To have the certificate checked too, change it to
  `sslmode=verify-full`.
- Prefer the direct endpoint. Pooled endpoints (a host containing `-pooler`)
  run PgBouncer in transaction mode and may reject this app's connection
  settings with the "connection pooler rejected" error.

**Self-hosted**

- Install the pgvector package for your Postgres version, then run
  `CREATE EXTENSION vector;` in the database as a superuser.
- The database must be reachable from the app server on a public address, with
  TLS on. With no `sslmode`, its certificate must be valid for the host name
  and chain to a CA Node trusts. For a self-signed certificate, use
  `sslmode=require` (no certificate check).
- To try it locally (for example Postgres in Docker on `localhost`), run
  `npm run dev`, which allows local hosts and plain TCP. A production build
  needs `ALLOW_PRIVATE_DB_HOSTS=1` for the same.

### Revoking access

The app keeps no list of tokens and cannot revoke a single one. To cut it off,
**change the database password**:

```sql
ALTER ROLE support_bot_app PASSWORD '<new password>';
```

This breaks every token and every embed for that database: every browser's
link and every widget. Connections that are already open survive a password
change. To close them straight away:

```sql
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'support_bot_app';
```

To start using it again, connect with the new string in the builder, generate
the widget again and replace the embed code on your site.

### `EMBED_TOKEN_KEY`

The server's key for encrypting tokens (AES-256-GCM). Generate it with:

```bash
openssl rand -base64 32
```

- Set it in the host's runtime environment (on Vercel: Project Settings →
  Environment Variables). `npm run build` does not need it.
- Missing or not exactly that shape (44 characters that decode to 32 bytes):
  the connect step says it isn't available, anything carrying a token is
  refused, and database-backed widgets answer "Widget unavailable". Demo mode
  works as before. Unsetting it is the quickest way to switch the feature off.
- **Rotating it invalidates every token**: every browser's link and every
  database-backed or backend-backed embed, for every database and backend.
  Users must connect again and replace their embed code.
- Keep it secret. Anyone with both a token and this key can decrypt the
  connection string, the model API key, the backend signing secret and the
  allowed sites inside it.
- It also turns on "Use your own model" and "Connect your backend". Without
  it, those steps are disabled, and allowed sites are kept with the demo
  widget in server memory.

`ALLOW_PRIVATE_DB_HOSTS=1` lets a production build connect to localhost,
private-network and link-local database hosts (and use plain TCP to them).
Leave it unset on a public deployment.

`ALLOW_PRIVATE_MODEL_HOSTS=1` does the same for model addresses (including
plain `http:` to them), for example to test against a local mock. Leave it
unset on a public deployment.

`ALLOW_PRIVATE_CONNECTOR_HOSTS=1` does the same for backend base URLs, for
example to connect the reference server on `http://127.0.0.1:8080`. Leave it
unset on a public deployment.

## 🔑 Automation keys (keep documents in sync)

With a database connected, the builder can create **automation keys**, for a
script or CI job that keeps the assistant's documents in step with your site,
for example a GitHub Action on every deploy.

- A key can **upload, list and remove documents** in its workspace, and
  nothing else: it cannot create widgets, change settings or manage keys.
- Uploading a file with an existing name **replaces** it, so a sync job just
  uploads its files every time.
- A key is **shown once** and never stored by this app. Revoke it in the
  builder and it stops working on the next request. Up to 10 active keys per
  workspace.
- Every key **expires**: after 30 days, 90 days or a year (the default), or
  never if you choose so. Expiry is per key, so an expired key stops only the
  job that uses it; your widget, the builder and every other key keep working.
  The builder flags a key two weeks before it expires. To replace one, create
  a new key, update the secret, then revoke the old key.
- Each key has an **audit trail**: the builder shows its recent activity,
  which files it uploaded, replaced or removed and when, and any request
  refused because it was revoked or expired. Filenames only, never document
  content.

```bash
# upload (or replace) documents
curl -H "Authorization: Bearer $SUPPORT_BOT_KEY" \
  -F files=@services.md -F files=@faq.md https://<this app>/api/upload

# list documents (with ids)
curl -H "Authorization: Bearer $SUPPORT_BOT_KEY" https://<this app>/api/storage/documents

# remove one
curl -X DELETE -H "Authorization: Bearer $SUPPORT_BOT_KEY" "https://<this app>/api/storage/documents?id=<id>"
```

How it works: the key is an encrypted `sbk1_` token, like the builder's other
tokens, carrying your database link, the workspace and a key id (this server
stores no connection strings). The key id has a row in
`support_bot.api_keys` in **your** database, created on first use of the keys
section; a key works only while its row is unrevoked and unexpired. What keys
do is written to `support_bot.key_events`, also in your database, and is gone
when the key or the workspace is deleted. The log is best-effort: if a write to
it fails the upload still succeeds and the response says `"audit":
"not_recorded"`. A string that is not a genuine key cannot be logged, because
nothing in it says which database it belongs to; the server log notes it
instead. A database login made with the least-privilege script before these
tables existed needs `scripts/support-bot-schema.sql` and
`scripts/support-bot-role.sql` run again. That script grants no `DELETE` on
`key_events`, so the app's own login cannot erase the trail.

## ✏️ Change an assistant after it's live

With a database connected, **Your assistants** in the builder lists every
assistant stored there. **Edit** changes one in place: the embed code on your
site stays exactly the same, and visitors see the change on their next page
load (the widget script is served `no-store`, and every answer reads the
current settings).

| Setting | Where it is kept | Changed in place? |
|---|---|---|
| Title, welcome message, colour, position, size | `support_bot.widgets` | Yes |
| Instructions (new) | `support_bot.widgets.system_prompt` | Yes |
| Suggested questions | `support_bot.widget_prefs`, over the tag's attributes | Yes |
| Allowed sites | `support_bot.widget_prefs`, over the sites sealed in the embed code | Yes |
| Model: shared demo model or your own | `support_bot.widget_prefs`; your model as its sealed `sbm1_` link, readable only by this server | Yes |
| Documents | `support_bot.documents`, shared by every assistant in the project (workspace) | Yes, upload or remove in the builder |

**Instructions** are added to the widget's prompt, not swapped for it, and the
grounding and visitor rules always come after them. An instruction can set the
tone ("call him Anuj, never I"), forbid a topic or ask for a contact line; it
cannot make the assistant state facts your documents do not contain.

**Two rules that are never relaxed.** An assistant answering with your own
model (your API credits) is never opened to every site: an empty saved list
falls back to the sites sealed in the embed code. And a saved model link this
server cannot open fails closed, never quietly becoming the demo model.

**The trade-off.** Allowed sites and the model used to be sealed only in the
embed code, so nobody who could write to the database could widen them. Now a
saved row wins, so anyone who can write to the `support_bot` tables can change
them; that is the same set of people who could already rewrite the documents
and instructions. The settings table is created with the others; a limited
login made before it existed needs `scripts/support-bot-schema.sql` and
`scripts/support-bot-role.sql` run again by an admin.

A backend-connected assistant (`sbw3_`) keeps its settings in the embed code
and is not editable here; generate new embed code for it.

### Who counts as the owner

There are no accounts on this service; owning the database is what counts.
Connecting needs a connection string that logs in, which Postgres checks. A
successful connect gives this browser an encrypted builder link (`sbb1_…`),
and every owner action (editing assistants, managing keys) requires that link,
for its own workspace only. Automation keys and embed codes are refused. To
use another browser, connect again; to revoke everything made with a login,
change that login's password. The builder link sits in browser storage, so
use **Disconnect** on shared computers.

## 🗂 Your bots: one per site

Managing several sites? Give each its own bot, with its own database and its
own settings, and manage them all from the builder.

1. Connect the first site's database and set the bot up. **Rename** it in
   **Your bots** (for example `shubhagya.com`).
2. Click **+ New bot**. The current bot stays listed; the builder goes back
   to a blank form and the connect box. Connect the next site's database.
3. Repeat for each site. **Your bots** lists them all; **Open** switches to
   one, bringing back its documents, assistants, keys, log, stats and the
   builder form as you left it. No connection string is needed again.

The list is kept in this browser (each entry holds that database's sealed
builder link, the same thing the builder already keeps for the open one), so
use the same browser, or connect a bot once in another to add it there.
**Forget** removes a bot from the list; **Disconnect this browser** removes the
open one. Neither deletes anything from the database, and embed code already
on a site keeps working whichever bot is open. Names are also saved in the
database when it has the optional `support_bot.projects` table (created by
one-click setup or `scripts/support-bot-upgrade.sql`); otherwise they are kept
in this browser only.

## 📝 Conversation log

To check what the assistant tells visitors, turn on **Conversation log** in
the builder's connected panel. It needs your own database: the demo and
backend-connected modes keep no log.

- **Off by default.** While it is on, the widget shows visitors *"Questions
  and answers are saved to improve this assistant."* under the chat box.
- **Logged only with the notice showing.** The widget asks whether the log is
  on when it is first opened (`POST /api/widget/status`) and sends
  `logNotice: true` only after it has displayed the notice; the server logs a
  question only with that flag and the log switched on. A failed or slow check
  means "not logged", never "logged without notice".
- **What is kept:** the question, the answer, whether any document matched,
  its match score, the documents used, the time, and a random per-page-view
  chat id. No IP
  address, user agent or cookie. Builder-preview questions are never logged.
- **Where:** `support_bot.conversations` and `support_bot.log_settings`, in
  your database. This server keeps nothing; the write happens after the reply
  is sent (`after()`), so it adds no wait for the visitor, and a failed write
  never fails an answer.
- **How long:** 1 to 730 days, 90 by default. Older entries are deleted on
  every write, and at once when you shorten the period. **Delete all** empties
  it.
- **Reading it:** newest first, with filters for questions no document
  matched (the list of what your documents are missing) and for low-match
  answers (score below 40), and **Download CSV** (cells a spreadsheet would run
  as a formula are quoted).
- **Owner only:** the builder link is required; automation keys and embed
  codes are refused.

A limited login made before these tables existed needs them created and
granted by an admin: run `scripts/support-bot-schema.sql` and
`scripts/support-bot-role.sql` again (the role needs `DELETE` on
`conversations` for the retention clean-up), or connect once with your admin
login and one-click setup.

## 📊 Daily stats

The **Questions and answers** panel shows the last 7, 30 or 90 days from
`support_bot.daily_stats`, one row per day (UTC) updated with a single upsert
after each widget reply:

| Count | Meaning |
|---|---|
| Questions | Every widget question, answered or failed |
| Answered from documents | At least one passage matched |
| No matching documents | Nothing in the documents matched |
| "Don't know" answers | The answer used the phrasing the visitor rule asks for ("I don't have that information"); a pattern match, so a reworded refusal can be missed |
| Failures | The visitor got an error instead of an answer (model error, or a database error while searching). A failure while the database is unreachable cannot be counted in it |
| Mean / lowest match score | Over answers that used documents |
| Low-match answers | Answers whose match score was below 40 |

**The match score is not a confidence that the answer is right.** It is the
retrieval match score (0-100, `matchScore` in `src/lib/embeddings.ts`): where
the best passage's similarity falls between 0.15 and 0.5. Low scores are where
weak answers come from, which is why they are counted and filterable in the log.

Counts hold no visitor text, so they are kept even with the conversation log
off, unless the owner turns counting off (**Count questions** in the panel,
`log_settings.stats_enabled`). Reading them and the switch need the builder
link. When the builder's login may alter tables, connect adds columns that
newer versions need (`conversations.match_score`, `log_settings.stats_enabled`)
to tables made from an older script; a limited login carries on without them.

## 💬 Suggested questions

Up to four "Try asking" questions can be set in the builder. They show under
the welcome message, in the preview and in the widget on your site, and a
click asks that question. They travel in the embed code as attributes:

```html
<script data-question-1="What services do you offer?" data-question-2="How does pricing work?" src="…" async></script>
```

Each is trimmed and capped at 120 characters, at most four are used, and they
are shown as plain text only.

With a database connected, you can also change them under **Your assistants**
without touching your site. Questions saved there replace the tag's attributes
(an empty saved list shows none).

## 🔒 Allowed sites

The embed step has an **Allowed sites** field. Enter each site as
`scheme://host[:port]`, such as `https://example.com`, up to 10. Matching is
exact: `https://www.example.com`, `http://example.com` and
`https://example.com:8443` are different sites, and wildcards are not
supported. `http://localhost:<port>` works for local testing.

With a list, chat requests from another site are refused, and the widget
script is not served to a page whose `Origin` or `Referer` names another site.
A page that sends neither header (for example with
`Referrer-Policy: no-referrer`) still gets the script, but its questions are
refused. This relies on the `Origin` and
`Referer` headers that browsers send. A script outside a browser can send any
header, so the list does not stop someone who copies your embed token from
calling the chat API directly. Without a list, any site can use the tag. The
builder preview is not affected by the list. See
[GOVERNANCE.md](GOVERNANCE.md#known-gaps) for the details.

## 🚦 Daily limit on the shared demo model

Widget questions that the owner's own model or backend does not answer go to
the deployment's shared Groq key, which every bot shares. So each bot may ask
it **200 questions per UTC day** by default (`SHARED_MODEL_DAILY_LIMIT`; `0` or
`off` removes the limit). After that, visitors see *"This assistant has
answered all the questions it can for today. Please try again tomorrow."*
(HTTP 429, `code: "daily_limit"`), and the model is not called.

- **Assistants on your own model, or answered by your own backend, are never
  counted.** Connect one under *Use your own model* and choose it in *Your
  assistants* to remove the limit.
- For a bot with its own database, the count is kept there
  (`support_bot.shared_model_usage`, one row per day, claimed with one atomic
  upsert), so it holds across every server instance. Each instance also counts
  in memory; that is the only counter for bots without a database, and the
  backstop when the table is missing. A question is refused when either is
  full.
- The owner sees today's use under *Questions and answers* in the builder.
- The database count can be edited by the database owner, so this is a
  fair-use limit for a shared key, not a security boundary. The per-visitor
  limit (20 messages a minute per IP) still applies on top.

## 🤖 Use your own model

The **Use your own model (optional)** step, under the database step in the
builder, lets answers come from your own OpenAI-compatible model instead of
the shared demo model on Groq. It needs `EMBED_TOKEN_KEY` on the server.

- Pick a provider (Groq, OpenAI, OpenRouter, Together AI or another
  OpenAI-compatible endpoint) to fill in the base URL, then enter the model ID
  and your API key. Only `https://` addresses on the public internet are
  accepted, and only Bearer-key `/v1` style APIs work.
- **Save** sends one short test request (at most 16 output tokens) to check
  the settings. Your provider may bill for it. The browser then keeps an
  encrypted model token; the key is not shown again.
- With a model saved, the preview and every embed you generate answer with
  it, and nothing falls back to Groq if it fails. An embed that uses your
  model must list at least one allowed site.
- Visitors on your allowed sites spend your provider credits, up to 20
  questions a minute per network, per server instance. Your provider's rate
  limits, pricing and data retention apply.
- **Remove model** forgets it in this browser only. Embeds you already
  generated keep using the key until you revoke it at your provider; that is
  the only way to cut them off.

Provider errors are shown as fixed messages, such as "The provider rejected
this API key." The provider's own error text is never shown or logged.

### Token size

Embeds with allowed sites or your own model carry an `sbw2_` token in the
script URL. It is compressed before encryption. For the largest inputs the
app accepts (a 3,000-character normalised connection string, 10 sites of 255
characters and the longest model settings), the token is at most 7,273
characters, and its script URL 7,388 on an 88-character host name. Generate
refuses an embed that would not fit.

Embeds for [your own backend](#connect-your-backend) carry an `sbw3_` token,
also compressed, capped at 7,800 characters (script URL at most 8,000). It
holds the widget settings too, so its size depends mostly on the system
prompt and role context and how well they compress. Measured over 200 seeded
cases, with script URLs on an 88-character host:

- every field at its maximum but no system prompt or role context: fits
  (largest script URL 5,499);
- a typical embed (short addresses, 2 sites) with a 4,000-character system
  prompt and 2,000-character role context of varied text: fits (3,803);
- every field at its maximum, prompts included: fits only if the prompts
  compress well (repetitive text: 6,463), and is refused with varied text
  (8,880) or random text (12,380).

The builder does not send a system prompt or role context when generating,
so its embeds are in the first range.

## Connect your backend

The **Connect your backend** step, next to the database step in the builder,
points the builder at a server you run. That server stores and searches your
documents. It must implement the [connector API v1](docs/connector-api.md)
([OpenAPI](docs/connector-openapi.yaml)). The reference server in
[`connector/`](connector/README.md) does, on Postgres with pgvector; its
README covers running it locally, deploying it (written steps only),
rotating keys and its limits. The step needs `EMBED_TOKEN_KEY` on this app's
server. While a backend is connected, "Connect your own database" is
disabled, and the other way round: documents live in one place at a time.

**Connecting**

1. Enter the backend's base URL. Only `https://` addresses on the public
   internet are accepted (see `ALLOW_PRIVATE_CONNECTOR_HOSTS` below for local
   testing), and redirects are not followed. The app calls unsigned
   `GET /v1/health` and shows the version and capabilities. It refuses a
   backend that is not version `1` or lacks `documents` or `search`.
2. The app generates a key id (`ck_` and 16 hex characters) and a signing
   secret, and shows the secret **once**, with the line to add to your backend:
   `CONNECTOR_KEYS=<key id>:<secret>`. Add it and restart your backend. If you
   leave or reload the page before confirming, connect again to get a new key.
3. Press "I've saved it", then **Test connection**. It sends a signed health
   call and a one-result search, and shows pass or fail with a fixed message.

Connect is limited to 5 attempts per minute per IP, per server instance.

**Documents.** Uploads are read and split into 1,000-character passages on
this server, as in the other modes, then sent to `POST /v1/documents`, one
document per request. This server does not embed them or keep them. A
document over 1,000 passages or 2 MB is refused before anything is sent.
Documents uploaded to the demo session before you connected are not sent to
your backend; upload them again. The builder lists your backend's documents
and can delete one (with a confirm step).

**Questions.** The question is sent to `POST /v1/search` as typed (top 5
passages), with no rewording, in both the preview and the widget. Passages
scoring below `MIN_SIMILARITY` are dropped, and the match score is computed
from the rest. Those cut-offs were measured for `all-MiniLM-L6-v2`; a backend
that embeds with another model will see a different cut-off.

**Who writes the answer** (the builder and the install guide name the one in
use):

- **Your backend**, when its health lists `answer`: the question, the passages
  from that search and the system prompt (if any) go to `POST /v1/answer`. No model on
  this app is used and nothing goes to Groq. A saved own model is not used for
  this backend, and the "Use your own model" step is disabled.
- **Your own model**, when the backend does not answer and you saved one: this
  app writes the answer from the passages, as in [Use your own model](#-use-your-own-model).
- **The demo model on Groq** otherwise.

A failed backend or model call is an error (preview 502, widget "Widget
unavailable"), never a Groq answer instead. The `answer` capability is read
at connect, again on **Test connection**, and at **Generate**; it is not
polled. If you turn answering on or off on your backend, test again and
regenerate the embed code.

**Embed code.** Generate needs at least one allowed site and at least one
document on your backend. The whole widget (settings, allowed sites, the
backend's address, key id and secret, the `answer` flag, and your model only
when the backend does not answer) is sealed into an `sbw3_` token in the
script URL. Nothing is saved on this server. The `sbw3_` token is at most
7,800 characters and the script URL at most 8,000; Generate refuses a larger
embed (`embed_too_large`) before returning anything. See
[Token size](#token-size) for measured sizes.

**What the tokens hold, and who can read them.** The builder keeps an `sbc1_`
token in `localStorage`; the embed code carries the `sbw3_` token. Both are
encrypted with `EMBED_TOKEN_KEY` and hold the backend's base URL, key id and
signing secret. Anyone with a token and `EMBED_TOKEN_KEY` can recover the
secret and sign requests as this app does, including adding and deleting
documents on the reference server, whose keys have no narrower scope. The
secret is never logged; this server logs each backend call as an operation,
an 8-character fingerprint of the base URL, an outcome code and a duration.

**Revoking.** On the reference server, remove the key id from
`CONNECTOR_KEYS` and restart it (another backend has its own way to drop a
key). Every request signed with that key, including from embeds generated
with it, is then refused, and those embeds answer "Widget unavailable".
**Disconnect** in the builder only forgets this browser's link; existing
embeds keep working until you remove the key id.

**Local testing.** A backend on `localhost`, a private network or plain
`http:` (such as the reference server on `http://127.0.0.1:8080`) works only
when this app runs with `npm run dev` or `ALLOW_PRIVATE_CONNECTOR_HOSTS=1`.
The flag is read on every call, so a link or embed for such a host stops
working on a server without it.

## ⚙️ Configuration

### **Assistant Settings**
The platform allows full customization of AI assistants:

```typescript
// Widget configuration options
const widgetConfig = {
  name: 'Business Support Assistant',    // Internal reference
  title: 'AI Support Assistant',        // Displayed to users
  welcome_message: 'Hi! How can I help?', // First message
  primary_color: '#3B82F6',             // Brand color
  position: 'bottom-right',             // bottom-right | bottom-left
  size: 'medium'                        // small | medium | large
}
```

### **Advanced Customization**
- **Instructions per assistant**: Under **Your assistants** (database-backed assistants). They are added to the widget prompt in `widgetSystemPrompt()` in `src/lib/llm.ts`
- **Preview prompt**: `UNIVERSAL_ASSISTANT.systemPrompt` in `src/app/page.tsx` is the builder preview's, for the owner; widget answers use `audience: 'visitor'`
- **Styling**: Built with Tailwind CSS v4
- **Branding**: Professional blue/gray color scheme, fully customizable
- **Responsive**: Mobile-first design that works on all devices

## 📝 Use Cases

### **E-commerce**
Upload product catalogs, return policies, shipping guides
- *"What's your return policy for shoes?"*
- *"Do you have size guides available?"*

### **SaaS Support**
Upload user manuals, API docs, troubleshooting guides
- *"How do I invite team members?"*
- *"What are the API rate limits?"*

### **Clinics and local services**
Upload opening hours, procedure guides and the insurers you accept
- *"Do you accept my insurance?"*
- *"What should I bring to my appointment?"*

> Do not upload patient records or other personal health data. In the demo,
> passages and questions are sent to a model provider to write answers; see
> [GOVERNANCE.md](GOVERNANCE.md) for exactly where data goes.

### **Professional Services**
Upload service descriptions, process guides, FAQ documents
- *"What's the process for making an offer?"*
- *"What documents do I need for closing?"*

## 🔧 Development

### **Project Structure**
```
ai-support-bot/
├── src/
│   ├── app/                 # Next.js App Router pages
│   ├── components/ui/       # Reusable UI components
│   ├── lib/                 # Core functionality (RAG, chat model, embeddings)
│   └── types/               # TypeScript definitions
├── public/                  # Static assets
├── scripts/                 # SQL for connecting your own Postgres (schema + least-privilege role)
├── docs/                    # Connector API v1 spec, OpenAPI file and shared signing test vectors
└── connector/               # Reference connector server (its own package; see connector/README.md)
```

### **Key Components**
- **ChatInterface**: Main conversation component with live preview
- **FileUpload**: Document upload and processing
- **WidgetGenerator**: Embeddable code generation

### **Testing**

`npm test` runs the Jest tests: tokens, connection-string validation, error
mapping and schema SQL (`src/lib/storage/__tests__/`), allowed-site matching
(`src/lib/__tests__/`), the model URL guard, adapter and tokens
(`src/lib/model/__tests__/`, with the adapter tested against a mock server
started in the test), the connector client, signing, tokens and answer paths
(`src/lib/connector/__tests__/`, against a mock backend started in the test),
the connector routes (`src/app/api/connector/__tests__/`), and the widget,
preview chat and generate routes, plus the upload route in connector mode
(`src/app/api/widget/__tests__/`).
They need no database, no network and no env vars. A Postgres integration test (`pg.integration.test.ts`) is skipped
unless `TEST_DATABASE_URL` points at a database with pgvector installed.
The reference server has its own suite: `cd connector && npm ci && npm test`.
The storage routes (keys, Your assistants, the conversation log, daily
stats, one-click setup) have route-level integration tests that run with
`TEST_DATABASE_URL`. Chunking and most of the UI have no tests yet; adding
some is a good first contribution, see [CONTRIBUTING.md](CONTRIBUTING.md).

### **Dependency audit**

`npm audit` reports only one advisory, at low severity:
`deepmerge` (GHSA prototype poisoning in `mergeObject()`, range 4.2.0-4.3.1),
pulled in by Jest's config loader. No fixed release exists (4.3.1 is the
latest), and it runs only inside the test runner to merge Jest's own config,
never in the app. npm's suggested fix is downgrading Jest to 25, which is not
taken. Two overrides in `package.json` pin patched versions where a parent
lags: `postcss` ^8.5.32 inside `next` (Next 15.5.29 pins 8.4.31, affected by
the PostCSS stringify XSS advisories) and `minimatch` ^11.0.1 inside
`@typescript-eslint/typescript-estree` (lint-time only).

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch: `git checkout -b feature/widget-customization`
3. **Add** your changes and tests
4. **Check**: `npm run lint` and `npm run build`
5. **Submit** pull request with detailed description

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

### **Development Guidelines**
- Tests are welcome, especially for chunking, the upload and storage routes, and the UI
- Use TypeScript for type safety
- Follow the existing code style and conventions
- Add tests for new features

## 🚀 Roadmap

- [ ] **Multi-language Support**: Support for non-English documents
- [x] **Conversation log**: Questions and answers kept in your own database, off by default, with a visitor notice and a retention period
- [ ] **Projects**: Several assistants for different sites in one database, each with its own documents
- [ ] **Custom Domains**: White-label deployment options
- [ ] **Team Collaboration**: Multi-user workspace management
- [x] **API access for documents**: Automation keys upload, list and remove documents (`/api/upload`, `/api/storage/documents`)
- [ ] **Advanced Theming**: Full CSS customization options

## 📝 License

MIT. See [LICENSE](LICENSE).
