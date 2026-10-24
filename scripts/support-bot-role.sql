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
