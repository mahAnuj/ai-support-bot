import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { ParsedConnection } from './connection'
import { StorageError, mapDriverError } from './errors'
import { exportMemorySession, type ExportedDocument } from './memory-store'
import { getPool } from './pg-pool'
import { EMBEDDING_DIM } from './schema'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const UPSERT_SESSION_WORKSPACE_SQL =
  'INSERT INTO support_bot.workspaces (id, source_session_id) VALUES ($1, $2) ON CONFLICT (source_session_id) DO UPDATE SET last_accessed = now() RETURNING id'

const INSERT_WORKSPACE_SQL = 'INSERT INTO support_bot.workspaces (id) VALUES ($1) RETURNING id'

// One database holds one assistant. Connecting again (another browser, after
// Disconnect, after clearing site data) reopens the workspace already there,
// preferring the most recently used one that has documents, instead of
// creating an empty one beside it.
const FIND_SESSION_WORKSPACE_SQL = 'SELECT id FROM support_bot.workspaces WHERE source_session_id = $1'
const FIND_EXISTING_WORKSPACE_SQL =
  'SELECT w.id, (SELECT count(*) FROM support_bot.documents d WHERE d.workspace_id = w.id)::int AS documents, (SELECT count(*) FROM support_bot.workspaces)::int AS workspaces FROM support_bot.workspaces w ORDER BY (SELECT count(*) FROM support_bot.documents d WHERE d.workspace_id = w.id) > 0 DESC, w.last_accessed DESC LIMIT 1'
const TOUCH_WORKSPACE_SQL = 'UPDATE support_bot.workspaces SET last_accessed = now() WHERE id = $1'
const WORKSPACE_FILENAMES_SQL = 'SELECT filename FROM support_bot.documents WHERE workspace_id = $1'

const INSERT_DOCUMENT_SQL =
  'INSERT INTO support_bot.documents (id, workspace_id, filename, content_preview, chunk_count, source_document_id) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (workspace_id, source_document_id) DO NOTHING RETURNING id'

const INSERT_CHUNKS_SQL =
  'INSERT INTO support_bot.chunks (id, document_id, workspace_id, chunk_index, content, embedding) SELECT i, d, w, n, c, e::vector FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::int[], $5::text[], $6::text[]) AS t(i, d, w, n, c, e)'

export interface MigrationResult {
  workspaceId: string
  migratedDocuments: number
  migratedChunks: number
  /** An existing workspace was reopened rather than a new one created. */
  reopened: boolean
  /** Documents the reopened workspace already held. */
  existingDocuments: number
  /** Session documents not copied because the workspace already had that filename. */
  skippedDocuments: number
}

function stripNul(value: string): string {
  return value.replace(/\u0000/g, '')
}

function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIM || !embedding.every((v) => Number.isFinite(v))) {
    throw new StorageError('storage_error')
  }
  return '[' + embedding.join(',') + ']'
}

async function insertDocument(client: PoolClient, workspaceId: string, doc: ExportedDocument): Promise<number | null> {
  const inserted = await client.query<{ id: string }>(INSERT_DOCUMENT_SQL, [
    randomUUID(),
    workspaceId,
    stripNul(doc.filename),
    stripNul(doc.contentPreview),
    doc.chunks.length,
    doc.sourceId,
  ])
  if (inserted.rows.length === 0) return null

  const documentId = inserted.rows[0].id
  if (doc.chunks.length === 0) return 0

  const ids: string[] = []
  const documentIds: string[] = []
  const workspaceIds: string[] = []
  const indexes: number[] = []
  const contents: string[] = []
  const embeddings: string[] = []
  for (const chunk of doc.chunks) {
    ids.push(randomUUID())
    documentIds.push(documentId)
    workspaceIds.push(workspaceId)
    indexes.push(chunk.index)
    contents.push(stripNul(chunk.content))
    embeddings.push(toVectorLiteral(chunk.embedding))
  }
  await client.query(INSERT_CHUNKS_SQL, [ids, documentIds, workspaceIds, indexes, contents, embeddings])
  return doc.chunks.length
}

export async function migrateSessionToPostgres(
  connection: ParsedConnection,
  sessionId: string | null,
): Promise<MigrationResult> {
  const sourceSessionId = typeof sessionId === 'string' && UUID_RE.test(sessionId) ? sessionId : null
  // Memory document ids are UUIDs; anything else could not be deduplicated on a re-run.
  const docs = sourceSessionId
    ? exportMemorySession(sourceSessionId).filter((doc) => UUID_RE.test(doc.sourceId))
    : []

  let client: PoolClient
  try {
    const pool = await getPool(connection)
    client = await pool.connect()
  } catch (err) {
    throw mapDriverError(err)
  }

  let broken = false
  try {
    await client.query('BEGIN')

    let workspaceId: string | null = null
    let reopened = false
    let existingDocuments = 0

    // 1. This session connected before: keep using its workspace.
    if (sourceSessionId) {
      const own = await client.query<{ id: string }>(FIND_SESSION_WORKSPACE_SQL, [sourceSessionId])
      if (own.rows[0]) workspaceId = own.rows[0].id
    }
    // 2. Otherwise reopen the workspace this database already holds.
    if (!workspaceId) {
      const existing = await client.query<{ id: string; documents: number }>(FIND_EXISTING_WORKSPACE_SQL)
      if (existing.rows[0]) {
        workspaceId = existing.rows[0].id
        existingDocuments = existing.rows[0].documents
        reopened = true
        await client.query(TOUCH_WORKSPACE_SQL, [workspaceId])
      }
    }
    // 3. An empty database: create the first workspace.
    if (!workspaceId) {
      const created = sourceSessionId
        ? await client.query<{ id: string }>(UPSERT_SESSION_WORKSPACE_SQL, [randomUUID(), sourceSessionId])
        : await client.query<{ id: string }>(INSERT_WORKSPACE_SQL, [randomUUID()])
      workspaceId = created.rows[0].id
    }

    // Copy the session's documents, except files the workspace already has by
    // name: the database copy stays, so reconnecting never duplicates them.
    const taken = new Set(
      (await client.query<{ filename: string }>(WORKSPACE_FILENAMES_SQL, [workspaceId])).rows.map((r) => r.filename),
    )
    let migratedDocuments = 0
    let migratedChunks = 0
    let skippedDocuments = 0
    for (const doc of docs) {
      if (reopened && taken.has(stripNul(doc.filename))) {
        skippedDocuments += 1
        continue
      }
      const chunkCount = await insertDocument(client, workspaceId, doc)
      if (chunkCount === null) continue
      migratedDocuments += 1
      migratedChunks += chunkCount
    }

    await client.query('COMMIT')
    return { workspaceId, migratedDocuments, migratedChunks, reopened, existingDocuments, skippedDocuments }
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // The original error is the one worth reporting; destroy the connection instead of reusing it.
      broken = true
    }
    throw mapDriverError(err)
  } finally {
    client.release(broken)
  }
}
