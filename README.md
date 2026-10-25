# 🚀 AI Assistant Builder

> **Create custom AI assistants trained on your business knowledge in minutes**

A powerful platform that lets any business build, test, and deploy intelligent AI assistants trained on their specific documents and knowledge base. Transform generic AI into domain experts with just a few clicks.

## ✨ What It Does

### 🎯 **Complete AI Assistant Builder**
- **Custom Configuration**: Set display name, welcome message, colors, and positioning
- **Your Documents**: Upload business documents (PDF, TXT, MD, DOCX) for the assistant to answer from
- **Live Preview**: See exactly how your assistant will look and behave
- **One-Click Deployment**: Generate embeddable JavaScript code for your website
- **Professional UI**: Clean, mobile-responsive design that works on any website

### 📚 **Intelligent Document Processing**
- **Chunking**: Splits each document into fixed-size passages of about 1,000 characters
- **Local Embeddings**: Passages are embedded on the server with an open-source model (`all-MiniLM-L6-v2`), so indexing needs no API key and sends no document text to a third party
- **Source Attribution**: Shows which documents were used in each response
- **Retrieval Match Score**: Shows how closely the retrieved passages match the question (a similarity score, not a probability that the answer is correct)

### 🌐 **Production-Ready Deployment**
- **Embeddable Widget**: Copy-paste JavaScript code to add to any website
- **Customizable Appearance**: Match your brand colors and positioning preferences
- **Mobile Optimized**: Works seamlessly on desktop, tablet, and mobile devices
- **Bounded by default**: Per-IP rate limits, input size caps, and optional per-widget domain allowlists. See [GOVERNANCE.md](GOVERNANCE.md) for what is and is not protected

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

Visit [http://localhost:3000](http://localhost:3000) and start building your AI assistant!

## 🎥 Demo Features

### **🎨 Live Configuration**
- Real-time preview as you customize
- See exactly what customers will experience
- Instant updates when you change settings

### **📄 Smart Document Processing**
- Drag & drop PDF, DOCX, TXT, MD files
- Automatic chunking and indexing
- Progress indicators and success confirmation

### **🚀 One-Click Deployment**
- Generate production-ready JavaScript code
- Copy-paste integration for any website
- Complete implementation guide included

## 🎪 How It Works

1. **Test the AI**: Try sample questions to see baseline performance
2. **Upload Documents**: Add your business knowledge (PDFs, docs, text files)
3. **Configure Assistant**: Customize name, welcome message, colors, and position
4. **Live Preview**: See real-time improvements in the chat interface
5. **Deploy**: Generate and copy embeddable code for your website

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
- **Storage**: In memory by default (`src/lib/database.ts`, no external database required), or your own Postgres with pgvector (see [Connect your own database](#-connect-your-own-database))
- **Chat model**: `openai/gpt-oss-20b` on Groq (free tier; override with `GROQ_MODEL`)
- **Embeddings**: `Xenova/all-MiniLM-L6-v2` via transformers.js, run on the server
- **Vector Search**: Cosine similarity, in-process for the demo and with pgvector's `<=>` operator in your database (exact scan, no approximate index)
- **File Processing**: Built-in PDF, TXT, MD, DOCX support
- **Enhancement**: RAG (Retrieval-Augmented Generation)
- **Deployment**: Vercel-ready with one-click deploy

## 🚀 Deployment

### **Vercel (Recommended)**
```bash
# Build and deploy
npm run build
vercel --prod

# Set environment variables in Vercel dashboard:
# GROQ_API_KEY
# EMBED_TOKEN_KEY   (only if you want "connect your own database"; see below)
```

### **Environment Variables**
```bash
# Required
GROQ_API_KEY=your_groq_api_key

# Optional
GROQ_MODEL=openai/gpt-oss-20b
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
EMBED_TOKEN_KEY=          # openssl rand -base64 32; turns on "connect your own database"
ALLOW_PRIVATE_DB_HOSTS=   # 1 = allow localhost/private database hosts on a production build
```

None of these are needed to build. See [.env.example](.env.example).

## 🗄 Connect your own database

By default, documents, chunks, embeddings and widgets live in server memory.
They are deleted when the server restarts, and a demo widget stops answering
then. Connecting your own Postgres database with
[pgvector](https://github.com/pgvector/pgvector) keeps them.

The connect step appears in the builder's Documents section only when the
server has `EMBED_TOKEN_KEY` set (see [below](#embed_token_key)).

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
   (such as `$`). The widget keeps
   answering after server restarts.

**Widget scope differs between modes.** A demo widget searches the documents
that were uploaded when it was generated. A widget backed by your database
searches **every document in its workspace**, including ones you upload later.

**Disconnect** in the builder only removes the link from this browser. It does
not revoke anything; see [Revoking access](#revoking-access).

What still leaves your database: each visitor question and the matching
passages pass through this server and go to Groq. See
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

### Step 2 (recommended): a least-privilege role

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
--   - USAGE on the support_bot schema and SELECT, INSERT, UPDATE on its tables.
--     No DELETE, no CREATE, no DDL.
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
ALTER ROLE support_bot_app SET search_path = support_bot, public, extensions;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN GRANT USAGE ON SCHEMA extensions TO support_bot_app; END IF; END $$;
```

What it does:

- The role gets `USAGE` on `support_bot` and `SELECT, INSERT, UPDATE` on the
  tables that exist there when it runs. No `DELETE`, no DDL, and no rights on
  `public` or any other schema's tables. That is why the setup SQL must run
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
  database-backed embed, for every database. Users must connect again and
  replace their embed code.
- Keep it secret. Anyone with both a token and this key can decrypt the
  connection string inside it.

`ALLOW_PRIVATE_DB_HOSTS=1` lets a production build connect to localhost,
private-network and link-local database hosts (and use plain TCP to them).
Leave it unset on a public deployment.

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
- **System Prompts**: Modify `UNIVERSAL_ASSISTANT.systemPrompt` in `src/app/page.tsx`
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

### **Healthcare**
Upload patient information, procedure guides, insurance details
- *"Do you accept my insurance?"*
- *"What should I bring to my appointment?"*

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
└── scripts/                 # SQL for connecting your own Postgres (schema + least-privilege role)
```

### **Key Components**
- **ChatInterface**: Main conversation component with live preview
- **FileUpload**: Document upload and processing
- **WidgetGenerator**: Embeddable code generation

### **Testing**

`npm test` runs the Jest unit tests in `src/lib/storage/__tests__/` (tokens,
connection-string validation, error mapping, schema SQL). They need no database
and no env vars. A Postgres integration test (`pg.integration.test.ts`) is
skipped unless `TEST_DATABASE_URL` points at a database with pgvector installed.
The rest of the app (chunking, the in-memory store, the routes and UI) has no
tests yet; adding some is a good first contribution, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch: `git checkout -b feature/widget-customization`
3. **Add** your changes and tests
4. **Check**: `npm run lint` and `npm run build`
5. **Submit** pull request with detailed description

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

### **Development Guidelines**
- Tests are welcome, especially outside `src/lib/storage/`, which is the only covered area so far
- Use TypeScript for type safety
- Follow the existing code style and conventions
- Add tests for new features

## 🚀 Roadmap

- [ ] **Multi-language Support**: Support for non-English documents
- [ ] **Analytics**: Track widget performance and user engagement (not built yet)
- [ ] **Custom Domains**: White-label deployment options
- [ ] **Team Collaboration**: Multi-user workspace management
- [ ] **API Access**: RESTful API for programmatic assistant management
- [ ] **Advanced Theming**: Full CSS customization options

## 📝 License

MIT. See [LICENSE](LICENSE).

---

## 🌟 Why Choose AI Assistant Builder?

✅ **5-Minute Setup** - From documents to deployed assistant in minutes  
✅ **No Technical Skills Required** - Visual interface, no coding needed  
✅ **Mobile Optimized** - Works on desktop, tablet and phone  
✅ **Brand Consistent** - Match your company's look and feel  
✅ **Honest About Data** - [GOVERNANCE.md](GOVERNANCE.md) says exactly where your documents go  

**Transform your customer support** with intelligent AI assistants powered by your business knowledge! 🚀
