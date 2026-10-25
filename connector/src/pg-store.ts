import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { EMBEDDING_DIM, type KnowledgeStore, type NewDocument, type SearchHit, type StoredDocument } from './store.js'

// Every statement is a fixed string with $n parameters. Nothing here creates,
// alters or drops a database object: sql/schema.sql is run by the operator.

const SCHEMA_VERSION = '1'
const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SELECT_META = 'SELECT key, value FROM support_bot_connector.meta'

const INSERT_DOCUMENT =
  'INSERT INTO support_bot_connector.documents (id, filename, content_type, chunk_count) VALUES ($1, $2, $3, $4) RETURNING created_at'

const INSERT_CHUNKS =
  'INSERT INTO support_bot_connector.chunks (id, document_id, chunk_index, content, embedding) ' +
  'SELECT u.id, $5::uuid, u.chunk_index, u.content, u.embedding::vector ' +
  'FROM unnest($1::uuid[], $2::int[], $3::text[], $4::text[]) AS u(id, chunk_index, content, embedding)'

const LIST_DOCUMENTS =
  'SELECT id, filename, content_type, chunk_count, created_at FROM support_bot_connector.documents ORDER BY created_at, id LIMIT $1'

const DELETE_DOCUMENT = 'DELETE FROM support_bot_connector.documents WHERE id = $1'

const SEARCH_CHUNKS =
  'SELECT c.document_id, d.filename, c.content, 1 - (c.embedding <=> $1::vector) AS score ' +
  'FROM support_bot_connector.chunks c JOIN support_bot_connector.documents d ON d.id = c.document_id ' +
  'ORDER BY score DESC, d.created_at, d.id, c.chunk_index LIMIT $2'

export type SchemaErrorCode = 'schema_missing' | 'schema_mismatch'

export class SchemaError extends Error {
  constructor(readonly code: SchemaErrorCode) {
    super(code)
    this.name = 'SchemaError'
  }
}

/** pgvector's text input form. Throws on a wrong dimension or a non-finite value. */
export function toVectorLiteral(embedding: number[]): string {
  if (embedding.length !== EMBEDDING_DIM || !embedding.every((n) => Number.isFinite(n))) {
    throw new Error('embedding has the wrong shape')
  }
  return `[${embedding.join(',')}]`
}

/** The Postgres error code (SQLSTATE) of a pg error, never its message. */
export function sqlState(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null
}

export async function checkSchema(pool: Pick<Pool, 'query'>): Promise<void> {
  let rows: { key: string; value: string }[]
  try {
    rows = (await pool.query(SELECT_META)).rows
  } catch (error) {
    // 42P01 undefined_table, 3F000 invalid_schema_name
    const state = sqlState(error)
    if (state === '42P01' || state === '3F000') throw new SchemaError('schema_missing')
    throw error
  }
  const meta = new Map(rows.map((row) => [row.key, row.value]))
  if (meta.size === 0) throw new SchemaError('schema_missing')
  if (
    meta.get('schema_version') !== SCHEMA_VERSION ||
    meta.get('embedding_dim') !== String(EMBEDDING_DIM) ||
    meta.get('embedding_model') !== EMBEDDING_MODEL
  ) {
    throw new SchemaError('schema_mismatch')
  }
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()
}

export function createPgStore(pool: Pool): KnowledgeStore {
  return {
    async insertDocument(doc: NewDocument, embeddings: number[][]): Promise<StoredDocument> {
      if (embeddings.length !== doc.passages.length) throw new Error('embedding count does not match passages')
      const id = randomUUID()
      const vectors = embeddings.map(toVectorLiteral)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const inserted = await client.query(INSERT_DOCUMENT, [id, doc.filename, doc.contentType, doc.passages.length])
        await client.query(INSERT_CHUNKS, [
          doc.passages.map(() => randomUUID()),
          doc.passages.map((p) => p.index),
          doc.passages.map((p) => p.text),
          vectors,
          id,
        ])
        await client.query('COMMIT')
        return {
          id,
          filename: doc.filename,
          contentType: doc.contentType,
          passageCount: doc.passages.length,
          createdAt: toIso(inserted.rows[0]?.created_at),
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },

    async listDocuments(limit: number): Promise<StoredDocument[]> {
      const result = await pool.query(LIST_DOCUMENTS, [limit])
      return result.rows.map((row) => ({
        id: String(row.id),
        filename: String(row.filename),
        contentType: String(row.content_type),
        passageCount: Number(row.chunk_count),
        createdAt: toIso(row.created_at),
      }))
    },

    async deleteDocument(id: string): Promise<boolean> {
      // Ids this server issues are UUIDs; anything else cannot exist here.
      if (!UUID_PATTERN.test(id)) return false
      const result = await pool.query(DELETE_DOCUMENT, [id])
      return (result.rowCount ?? 0) > 0
    },

    async search(embedding: number[], topK: number): Promise<SearchHit[]> {
      const result = await pool.query(SEARCH_CHUNKS, [toVectorLiteral(embedding), topK])
      return result.rows.map((row) => ({
        documentId: String(row.document_id),
        filename: String(row.filename),
        text: String(row.content),
        score: Number(row.score),
      }))
    },
  }
}
