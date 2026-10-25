import { randomUUID } from 'node:crypto'
import type { PoolClient, QueryResultRow } from 'pg'
import type { DemoSession, VectorSearchResult } from '../../types/database'
import type { ParsedConnection } from './connection'
import { StorageError, mapDriverError } from './errors'
import { getPool } from './pg-pool'
import { EMBEDDING_DIM } from './schema'
import type { ChunkInput, DocumentSummary, KnowledgeStore, WidgetRecord, WidgetSettings } from './types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SQL_GET_WORKSPACE =
  'SELECT w.id, w.created_at, w.last_accessed, (SELECT count(*)::int FROM support_bot.documents d WHERE d.workspace_id = w.id) AS document_count FROM support_bot.workspaces w WHERE w.id = $1'
const SQL_TOUCH_WORKSPACE = 'UPDATE support_bot.workspaces SET last_accessed = now() WHERE id = $1'
const SQL_CREATE_WORKSPACE =
  'INSERT INTO support_bot.workspaces (id) VALUES ($1) RETURNING id, created_at, last_accessed'
const SQL_INSERT_DOCUMENT =
  'INSERT INTO support_bot.documents (id, workspace_id, filename, content_preview, chunk_count) VALUES ($1, $2, $3, $4, $5)'
const SQL_INSERT_CHUNKS =
  'INSERT INTO support_bot.chunks (id, document_id, workspace_id, chunk_index, content, embedding) SELECT i, d, w, n, c, e::vector FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::int[], $5::text[], $6::text[]) AS t(i, d, w, n, c, e)'
const SQL_LIST_DOCUMENTS =
  'SELECT id, filename, chunk_count, created_at FROM support_bot.documents WHERE workspace_id = $1 ORDER BY created_at, id'
const SQL_HAS_DOCUMENTS = 'SELECT EXISTS (SELECT 1 FROM support_bot.chunks WHERE workspace_id = $1) AS has_documents'
const SQL_SEARCH_CHUNKS =
  'SELECT c.id AS chunk_id, c.content, d.filename, c.chunk_index, 1 - (c.embedding <=> $2) AS similarity' +
  ' FROM support_bot.chunks c JOIN support_bot.documents d ON d.id = c.document_id' +
  ' WHERE c.workspace_id = $1 AND 1 - (c.embedding <=> $2) >= $3' +
  ' ORDER BY similarity DESC, d.created_at, d.id, c.chunk_index' +
  ' LIMIT $4'
const SQL_CREATE_WIDGET =
  'INSERT INTO support_bot.widgets (id, workspace_id, name, title, welcome_message, primary_color, position, size, allowed_domains, system_prompt, role_context) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, name, title, welcome_message, primary_color, position, size, allowed_domains, system_prompt, role_context, is_active, created_at, updated_at'
const SQL_GET_WIDGET =
  'SELECT id, name, title, welcome_message, primary_color, position, size, allowed_domains, system_prompt, role_context, is_active, created_at, updated_at FROM support_bot.widgets WHERE id = $1 AND workspace_id = $2 AND is_active'

interface WorkspaceRow { id: string; created_at: Date; last_accessed: Date; document_count: number }
interface DocumentRow { id: string; filename: string; chunk_count: number; created_at: Date }
interface SearchRow { chunk_id: string; content: string; filename: string; chunk_index: number; similarity: number }
interface WidgetRow {
  id: string
  name: string
  title: string
  welcome_message: string
  primary_color: string
  position: string
  size: string
  allowed_domains: string[] | null
  system_prompt: string | null
  role_context: string | null
  is_active: boolean
  created_at: Date
  updated_at: Date
}

function stripNul(value: string): string {
  return value.replace(/\u0000/g, '')
}

function vectorLiteral(embedding: number[]): string {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) throw new StorageError('storage_error')
  return '[' + embedding.join(',') + ']'
}

function toWidgetRecord(row: WidgetRow, workspaceId: string): WidgetRecord {
  return {
    id: row.id,
    business_id: '',
    knowledge_base_id: workspaceId,
    widget_key: row.id,
    name: row.name,
    title: row.title,
    welcome_message: row.welcome_message,
    primary_color: row.primary_color,
    position: row.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    size: row.size === 'small' || row.size === 'large' ? row.size : 'medium',
    allowed_domains: row.allowed_domains ?? [],
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    system_prompt: row.system_prompt ?? undefined,
    role_context: row.role_context ?? undefined,
  }
}

export function createPostgresStore(connection: ParsedConnection, workspaceId: string): KnowledgeStore {
  const bound = workspaceId

  function assertBound(id: string): void {
    if (id !== bound) throw new StorageError('workspace_not_found')
  }

  async function q<R extends QueryResultRow>(sql: string, params: unknown[]): Promise<R[]> {
    try {
      const pool = await getPool(connection)
      const result = await pool.query<R>(sql, params)
      return result.rows
    } catch (err) {
      throw mapDriverError(err)
    }
  }

  async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient
    try {
      const pool = await getPool(connection)
      client = await pool.connect()
    } catch (err) {
      throw mapDriverError(err)
    }
    try {
      await client.query('BEGIN')
      const value = await fn(client)
      await client.query('COMMIT')
      return value
    } catch (err) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // The original error is the one worth reporting.
      }
      throw mapDriverError(err)
    } finally {
      client.release()
    }
  }

  async function hasDocuments(id: string): Promise<boolean> {
    assertBound(id)
    const rows = await q<{ has_documents: boolean }>(SQL_HAS_DOCUMENTS, [bound])
    return rows[0]?.has_documents === true
  }

  async function search(
    queryEmbedding: number[],
    threshold: number,
    maxResults: number,
  ): Promise<VectorSearchResult[]> {
    const rows = await q<SearchRow>(SQL_SEARCH_CHUNKS, [bound, vectorLiteral(queryEmbedding), threshold, maxResults])
    return rows.map((row) => ({
      chunk_id: row.chunk_id,
      content: row.content,
      filename: row.filename,
      similarity: Number(row.similarity),
      chunk_index: row.chunk_index,
    }))
  }

  return {
    kind: 'postgres',

    async createWorkspace(): Promise<DemoSession> {
      const rows = await q<Omit<WorkspaceRow, 'document_count'>>(SQL_CREATE_WORKSPACE, [randomUUID()])
      const row = rows[0]
      if (!row) throw new StorageError('storage_error')
      return { id: row.id, created_at: row.created_at, last_accessed: row.last_accessed, document_count: 0 }
    },

    async getWorkspace(id) {
      assertBound(id)
      const rows = await q<WorkspaceRow>(SQL_GET_WORKSPACE, [bound])
      const row = rows[0]
      if (!row) return null
      return {
        id: row.id,
        created_at: row.created_at,
        last_accessed: row.last_accessed,
        document_count: row.document_count,
      }
    },

    async touchWorkspace(id) {
      assertBound(id)
      await q(SQL_TOUCH_WORKSPACE, [bound])
    },

    async storeDocument(id, filename, chunks: ChunkInput[]) {
      assertBound(id)
      const documentId = randomUUID()
      const preview = stripNul(chunks[0]?.content.substring(0, 200) || '')
      const embeddings = chunks.map((chunk) => vectorLiteral(chunk.embedding))

      await tx(async (client) => {
        await client.query(SQL_INSERT_DOCUMENT, [documentId, bound, stripNul(filename), preview, chunks.length])
        if (chunks.length > 0) {
          await client.query(SQL_INSERT_CHUNKS, [
            chunks.map(() => randomUUID()),
            chunks.map(() => documentId),
            chunks.map(() => bound),
            chunks.map((chunk) => chunk.index),
            chunks.map((chunk) => stripNul(chunk.content)),
            embeddings,
          ])
        }
      })

      return { documentId, chunkCount: chunks.length }
    },

    async listDocuments(id): Promise<DocumentSummary[]> {
      assertBound(id)
      const rows = await q<DocumentRow>(SQL_LIST_DOCUMENTS, [bound])
      return rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        chunkCount: row.chunk_count,
        createdAt: row.created_at,
      }))
    },

    hasDocuments,

    async searchChunks({ workspaceId: id, queryEmbedding, threshold, maxResults }) {
      assertBound(id)
      return search(queryEmbedding, threshold, maxResults)
    },

    async createWidget(id, settings: WidgetSettings) {
      assertBound(id)
      const rows = await q<WidgetRow>(SQL_CREATE_WIDGET, [
        randomUUID(),
        bound,
        settings.name,
        settings.title || 'AI Support Assistant',
        settings.welcome_message || 'Hi! How can I help you today?',
        settings.primary_color || '#3B82F6',
        settings.position || 'bottom-right',
        settings.size || 'medium',
        settings.allowed_domains ?? [],
        settings.system_prompt ?? null,
        settings.role_context ?? null,
      ])
      const row = rows[0]
      if (!row) throw new StorageError('storage_error')
      return toWidgetRecord(row, bound)
    },

    async getWidget(ref) {
      if (typeof ref !== 'string' || !UUID_PATTERN.test(ref)) return null
      const rows = await q<WidgetRow>(SQL_GET_WIDGET, [ref, bound])
      const row = rows[0]
      return row ? toWidgetRecord(row, bound) : null
    },

    widgetHasDocuments(widget) {
      return hasDocuments(widget.knowledge_base_id)
    },

    async searchWidgetChunks(widget, { queryEmbedding, threshold, maxResults }) {
      assertBound(widget.knowledge_base_id)
      return search(queryEmbedding, threshold, maxResults)
    },
  }
}
