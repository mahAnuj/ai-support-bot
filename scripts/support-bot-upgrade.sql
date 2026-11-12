-- Upgrade an existing support_bot database to the current version.
--
-- Run as the database owner or an admin (Neon: neondb_owner; Supabase:
-- postgres) if your database was set up before these features existed:
-- automation keys, Your assistants, the conversation log, daily stats, projects and the shared model's daily cap.
-- Safe to run more than once: everything is IF NOT EXISTS, and it never drops,
-- empties or rewrites anything.
--
-- Connecting once with your admin login and one-click setup does the same,
-- except for the grants to logins made earlier, which only this script does.

BEGIN;

-- Automation keys and their activity log
CREATE TABLE IF NOT EXISTS support_bot.api_keys (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz, expires_at timestamptz);
ALTER TABLE support_bot.api_keys ADD COLUMN IF NOT EXISTS expires_at timestamptz;
CREATE TABLE IF NOT EXISTS support_bot.key_events (id uuid PRIMARY KEY, key_id uuid NOT NULL REFERENCES support_bot.api_keys(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, action text NOT NULL, filename text, detail text, at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS key_events_key_idx ON support_bot.key_events (key_id, at DESC);

-- Your assistants: settings saved over the embed code
CREATE TABLE IF NOT EXISTS support_bot.widget_prefs (widget_id uuid PRIMARY KEY REFERENCES support_bot.widgets(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, starter_questions text[], allowed_origins text[], model_mode text CHECK (model_mode IN ('demo', 'owner')), model_token text, updated_at timestamptz NOT NULL DEFAULT now());

-- Conversation log
CREATE TABLE IF NOT EXISTS support_bot.conversations (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, chat_id uuid, question text NOT NULL, answer text NOT NULL, matched boolean NOT NULL, match_score smallint, sources text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE support_bot.conversations ADD COLUMN IF NOT EXISTS match_score smallint;
CREATE INDEX IF NOT EXISTS conversations_workspace_idx ON support_bot.conversations (workspace_id, created_at DESC);
CREATE TABLE IF NOT EXISTS support_bot.log_settings (workspace_id uuid PRIMARY KEY REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, enabled boolean NOT NULL DEFAULT false, retention_days integer NOT NULL DEFAULT 90, stats_enabled boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE support_bot.log_settings ADD COLUMN IF NOT EXISTS stats_enabled boolean NOT NULL DEFAULT true;

-- Projects: names for workspaces, one per site
CREATE TABLE IF NOT EXISTS support_bot.projects (workspace_id uuid PRIMARY KEY REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());

-- Shared demo model: questions per day, for its daily cap
CREATE TABLE IF NOT EXISTS support_bot.shared_model_usage (workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, day date NOT NULL, questions integer NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, day));

-- Daily stats
CREATE TABLE IF NOT EXISTS support_bot.daily_stats (workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, day date NOT NULL, questions integer NOT NULL DEFAULT 0, matched integer NOT NULL DEFAULT 0, no_match integer NOT NULL DEFAULT 0, dont_know integer NOT NULL DEFAULT 0, failures integer NOT NULL DEFAULT 0, score_sum integer NOT NULL DEFAULT 0, score_count integer NOT NULL DEFAULT 0, score_min smallint, low_score integer NOT NULL DEFAULT 0, PRIMARY KEY (workspace_id, day));

-- Grants for every limited login the assistant uses: support_bot_app (made by
-- scripts/support-bot-role.sql) and support_bot_app_xxxxxx (made by one-click
-- setup). The same rights as the role script: read, add and update, plus
-- delete on documents, chunks and log entries. Nothing else.
DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname ~ '^support_bot_app(_[0-9a-f]{6})?$' LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA support_bot TO %I', r);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA support_bot TO %I', r);
    EXECUTE format('GRANT DELETE ON support_bot.documents, support_bot.chunks, support_bot.conversations TO %I', r);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA support_bot GRANT SELECT, INSERT, UPDATE ON TABLES TO %I', r);
  END LOOP;
END $$;

COMMIT;
