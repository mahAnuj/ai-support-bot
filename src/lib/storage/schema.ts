import type { Pool, PoolClient } from 'pg'
import { StorageError, mapDriverError } from './errors'

export const SCHEMA_NAME = 'support_bot'
export const SCHEMA_VERSION = '1'
export const EMBEDDING_DIM = 384

interface SchemaStep {
  readonly sql: string
  // Catalog object this statement creates; null means "always run during a DDL pass".
  readonly object: string | null
  // Added after v1. A login that may not create it still connects; the feature
  // that needs it reports what to run instead (see createMissingObjects).
  readonly optional?: true
}

const SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    object: 'support_bot',
    sql: 'CREATE SCHEMA IF NOT EXISTS support_bot',
  },
  {
    object: 'support_bot.meta',
    sql: 'CREATE TABLE IF NOT EXISTS support_bot.meta (key text PRIMARY KEY, value text NOT NULL)',
  },
  {
    object: null,
    sql: "INSERT INTO support_bot.meta (key, value) VALUES ('schema_version','1'),('embedding_dim','384'),('embedding_model','Xenova/all-MiniLM-L6-v2') ON CONFLICT (key) DO NOTHING",
  },
  {
    object: 'support_bot.workspaces',
    sql: 'CREATE TABLE IF NOT EXISTS support_bot.workspaces (id uuid PRIMARY KEY, source_session_id uuid UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), last_accessed timestamptz NOT NULL DEFAULT now())',
  },
  {
    object: 'support_bot.documents',
    sql: 'CREATE TABLE IF NOT EXISTS support_bot.documents (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, filename text NOT NULL, content_preview text, chunk_count integer NOT NULL, source_document_id uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (workspace_id, source_document_id))',
  },
  {
    object: 'support_bot.chunks',
    sql: 'CREATE TABLE IF NOT EXISTS support_bot.chunks (id uuid PRIMARY KEY, document_id uuid NOT NULL REFERENCES support_bot.documents(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, chunk_index integer NOT NULL, content text NOT NULL, embedding vector(384) NOT NULL, created_at timestamptz NOT NULL DEFAULT now())',
  },
  {
    object: 'support_bot.widgets',
    sql: "CREATE TABLE IF NOT EXISTS support_bot.widgets (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, name text NOT NULL, title text NOT NULL, welcome_message text NOT NULL, primary_color text NOT NULL, position text NOT NULL, size text NOT NULL, allowed_domains text[] NOT NULL DEFAULT '{}', system_prompt text, role_context text, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())",
  },
  {
    // Automation keys: the key itself is an sbk1_ token held by the owner; this
    // row is what makes it revocable. Added after v1 shipped; additive, so the
    // schema version is unchanged and existing databases gain it on Connect.
    object: 'support_bot.api_keys',
    optional: true,
    sql: 'CREATE TABLE IF NOT EXISTS support_bot.api_keys (id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, label text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz, expires_at timestamptz)',
  },
  {
    // Audit trail of what each automation key did (uploaded, replaced,
    // removed, refused): filenames and actions, never document content.
    object: 'support_bot.key_events',
    optional: true,
    sql: 'CREATE TABLE IF NOT EXISTS support_bot.key_events (id uuid PRIMARY KEY, key_id uuid NOT NULL REFERENCES support_bot.api_keys(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, action text NOT NULL, filename text, detail text, at timestamptz NOT NULL DEFAULT now())',
  },
  {
    object: 'support_bot.key_events_key_idx',
    optional: true,
    sql: 'CREATE INDEX IF NOT EXISTS key_events_key_idx ON support_bot.key_events (key_id, at DESC)',
  },
  {
    // Settings edited under "Your assistants" that the embed code used to carry:
    // suggested questions, allowed sites and the model. A row here wins over
    // the embed token, so existing embed code picks up an edit with no change
    // on the owner's site. model_token is the builder's sealed sbm1_ model link,
    // readable only by this server.
    object: 'support_bot.widget_prefs',
    optional: true,
    sql: "CREATE TABLE IF NOT EXISTS support_bot.widget_prefs (widget_id uuid PRIMARY KEY REFERENCES support_bot.widgets(id) ON DELETE CASCADE, workspace_id uuid NOT NULL REFERENCES support_bot.workspaces(id) ON DELETE CASCADE, starter_questions text[], allowed_origins text[], model_mode text CHECK (model_mode IN ('demo', 'owner')), model_token text, updated_at timestamptz NOT NULL DEFAULT now())",
  },
  {
    object: 'support_bot.documents_workspace_idx',
    sql: 'CREATE INDEX IF NOT EXISTS documents_workspace_idx ON support_bot.documents (workspace_id)',
  },
  {
    object: 'support_bot.chunks_workspace_idx',
    sql: 'CREATE INDEX IF NOT EXISTS chunks_workspace_idx ON support_bot.chunks (workspace_id)',
  },
  {
    object: 'support_bot.widgets_workspace_idx',
    sql: 'CREATE INDEX IF NOT EXISTS widgets_workspace_idx ON support_bot.widgets (workspace_id)',
  },
]

export const SCHEMA_STATEMENTS: readonly string[] = Object.freeze(SCHEMA_STEPS.map((step) => step.sql))

// Reads pg_namespace/pg_class directly rather than via to_regclass(): the
// syscache can hold stale negative entries after waiting on the advisory lock,
// which would make every concurrent caller re-run the DDL.
const CATALOG_QUERY = `SELECT 'support_bot' AS name FROM pg_namespace WHERE nspname = 'support_bot'
UNION ALL
SELECT 'support_bot.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'support_bot'`

type CatalogState = ReadonlySet<string>

async function readCatalog(client: PoolClient): Promise<CatalogState> {
  const result = await client.query<{ name: string }>(CATALOG_QUERY)
  return new Set(result.rows.map((row) => row.name))
}

function missingObjects(state: CatalogState): string[] {
  return SCHEMA_STEPS.flatMap((step) => (step.object !== null && !state.has(step.object) ? [step.object] : []))
}

// CREATE ... IF NOT EXISTS checks the CREATE privilege before existence, so a
// least-privilege role must never run DDL for objects that already exist.
async function createMissingObjects(client: PoolClient): Promise<void> {
  await client.query('BEGIN')
  let onlyOptionalMissing = false
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('support_bot.schema'))")
    const state = await readCatalog(client)
    const missing = missingObjects(state)
    onlyOptionalMissing = missing.every((name) => SCHEMA_STEPS.some((step) => step.object === name && step.optional))
    if (missing.length > 0) {
      for (const step of SCHEMA_STEPS) {
        if (step.object !== null && state.has(step.object)) continue
        await client.query(step.sql)
      }
    }
    await client.query('COMMIT')
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The original error is the one worth reporting.
    }
    // A limited login after an upgrade: the core tables exist and only a newer,
    // optional one is missing. Carry on; that feature reports what to run.
    if (onlyOptionalMissing && (err as { code?: unknown })?.code === '42501') {
      console.log('schema: newer optional tables are missing and this login cannot create them')
      return
    }
    throw err
  }
}

async function verifySchema(client: PoolClient): Promise<void> {
  const meta = await client.query<{ key: string; value: string }>(
    "SELECT key, value FROM support_bot.meta WHERE key IN ('schema_version','embedding_dim')",
  )
  const values = new Map(meta.rows.map((row) => [row.key, row.value]))
  if (values.get('schema_version') !== SCHEMA_VERSION || values.get('embedding_dim') !== String(EMBEDDING_DIM)) {
    throw new StorageError('schema_mismatch')
  }

  const column = await client.query<{ type: string }>(
    "SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'support_bot.chunks'::regclass AND attname = 'embedding' AND NOT attisdropped",
  )
  if (column.rows.length !== 1 || column.rows[0].type !== `vector(${EMBEDDING_DIM})`) {
    throw new StorageError('schema_mismatch')
  }
}

export async function ensureSchema(pool: Pool): Promise<void> {
  let client: PoolClient
  try {
    client = await pool.connect()
  } catch (err) {
    throw mapDriverError(err)
  }

  try {
    const vector = await client.query<{ has_vector: boolean }>(
      "SELECT to_regtype('vector') IS NOT NULL AS has_vector",
    )
    if (vector.rows[0]?.has_vector !== true) {
      throw new StorageError('pgvector_missing')
    }

    const state = await readCatalog(client)
    if (missingObjects(state).length > 0) {
      // Refuse before any DDL if an existing install has a different version or embedding size.
      if (state.has('support_bot.meta') && state.has('support_bot.chunks')) {
        await verifySchema(client)
      }
      await createMissingObjects(client)
    }

    await verifySchema(client)
  } catch (err) {
    throw mapDriverError(err)
  } finally {
    client.release()
  }
}
