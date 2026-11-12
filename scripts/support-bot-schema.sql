-- support_bot schema for the AI Support Bot "connect your own database" feature.
--
-- Creates the support_bot schema and its tables (meta, workspaces, documents,
-- chunks, widgets). Run it as the database owner or an admin, for example:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/support-bot-schema.sql
-- It is safe to run more than once: every statement is IF NOT EXISTS or
-- ON CONFLICT DO NOTHING. It never drops, truncates or alters anything.
--
-- The app only creates these objects itself when they are missing, so after
-- running this file the app can use the least-privilege role from
-- scripts/support-bot-role.sql.

-- CREATE EXTENSION IF NOT EXISTS vector;  -- run once as an admin if the check below fails

DO $$ BEGIN IF to_regtype('vector') IS NULL THEN RAISE EXCEPTION 'pgvector is not installed. Run: CREATE EXTENSION vector;'; END IF; END $$;

BEGIN;

CREATE SCHEMA IF NOT EXISTS support_bot;

CREATE TABLE IF NOT EXISTS support_bot.meta (key text PRIMARY KEY, value text NOT NULL);

INSERT INTO support_bot.meta (key, value) VALUES ('schema_version','1'),('embedding_dim','384'),('embedding_model','Xenova/all-MiniLM-L6-v2') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_bot.workspaces (id uuid PRIMARY KEY, source_session_id uuid UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), last_accessed timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS support_bot.documents (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, filename text NOT NULL, content_preview text, chunk_count integer NOT NULL, source_document_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workspace_id, source_document_id));

CREATE TABLE IF NOT EXISTS support_bot.chunks (id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES support_bot.documents(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, chunk_index integer NOT NULL, content text NOT NULL, embedding vector(384) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS support_bot.widgets (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, name text NOT NULL, title text NOT NULL, welcome_message text NOT NULL, primary_color text NOT NULL, position text NOT NULL, size text NOT NULL, allowed_domains text[] NOT NULL DEFAULT '{}', system_prompt text, role_context text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());

-- Automation keys: revocation and last-used time for sbk1_ keys (the key itself is held by the owner).
CREATE TABLE IF NOT EXISTS support_bot.api_keys (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz, expires_at timestamptz);
-- Audit trail of automation-key actions: filenames and actions, never document content.
CREATE TABLE IF NOT EXISTS support_bot.key_events (id uuid PRIMARY KEY, key_id uuid NOT NULL REFERENCES support_bot.api_keys(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, action text NOT NULL, filename text, detail text, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS key_events_key_idx ON support_bot.key_events (key_id, at DESC);
-- Conversation log (off until the owner turns it on): questions and answers, no IP or user agent.
CREATE TABLE IF NOT EXISTS support_bot.conversations (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, chat_id uuid, question text NOT NULL, answer text NOT NULL, matched boolean NOT NULL, sources text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS conversations_workspace_idx ON support_bot.conversations (workspace_id, created_at DESC);
CREATE TABLE IF NOT EXISTS support_bot.log_settings (workspace_id uuid PRIMARY KEY REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, enabled boolean NOT NULL DEFAULT false, retention_days integer NOT NULL DEFAULT 90, updated_at timestamptz NOT NULL DEFAULT now());
-- Settings edited under "Your assistants" (suggested questions, allowed sites, model); a row wins over the embed code.
CREATE TABLE IF NOT EXISTS support_bot.widget_prefs (widget_id uuid PRIMARY KEY REFERENCES support_bot.widgets(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, starter_questions text[], allowed_origins text[], model_mode text CHECK (model_mode IN ('demo', 'owner')), model_token text, updated_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX IF NOT EXISTS documents_workspace_idx ON support_bot.documents (workspace_id);

CREATE INDEX IF NOT EXISTS chunks_workspace_idx ON support_bot.chunks (workspace_id);

CREATE INDEX IF NOT EXISTS widgets_workspace_idx ON support_bot.widgets (workspace_id);

COMMIT;
