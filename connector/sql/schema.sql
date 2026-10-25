-- support_bot_connector schema for the AI Support Bot reference connector.
--
-- Creates the support_bot_connector schema and its tables (meta, documents,
-- chunks, nonces). Run it as the database owner or an admin, for example:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema.sql
-- docker compose runs it once from /docker-entrypoint-initdb.d.
-- It is safe to run more than once: every statement is IF NOT EXISTS or
-- ON CONFLICT DO NOTHING. It never drops, truncates or alters anything.
--
-- The server never creates or changes these objects itself. At start-up it
-- reads support_bot_connector.meta and exits if the schema is missing or
-- does not match. The schema name differs from the app's support_bot, so
-- both can share one database.
--
-- Search is an exact cosine scan with no ANN index, so results match the
-- app's own in-memory search.

CREATE EXTENSION IF NOT EXISTS vector;

BEGIN;

CREATE SCHEMA IF NOT EXISTS support_bot_connector;

CREATE TABLE IF NOT EXISTS support_bot_connector.meta (key text PRIMARY KEY, value text NOT NULL);

INSERT INTO support_bot_connector.meta (key, value) VALUES ('schema_version','1'),('embedding_dim','384'),('embedding_model','Xenova/all-MiniLM-L6-v2') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_bot_connector.documents (id uuid PRIMARY KEY, filename text NOT NULL, content_type text NOT NULL, chunk_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE IF NOT EXISTS support_bot_connector.chunks (id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES support_bot_connector.documents(id) ON DELETE CASCADE, chunk_index integer NOT NULL, content text NOT NULL, embedding vector(384) NOT NULL, UNIQUE (document_id, chunk_index));

CREATE TABLE IF NOT EXISTS support_bot_connector.nonces (key_id text NOT NULL, nonce text NOT NULL, seen_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (key_id, nonce));

CREATE INDEX IF NOT EXISTS chunks_document_idx ON support_bot_connector.chunks (document_id);

CREATE INDEX IF NOT EXISTS nonces_seen_at_idx ON support_bot_connector.nonces (seen_at);

COMMIT;
