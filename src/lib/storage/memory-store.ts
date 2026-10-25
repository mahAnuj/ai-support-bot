import {
  createSession,
  createWidgetFromSession,
  findRelevantChunks,
  findRelevantChunksForKnowledgeBase,
  getInMemoryDatabase,
  getSession,
  getSessionDocuments,
  getWidgetByKey,
  knowledgeBaseHasDocuments,
  storeDocument,
  updateSessionAccess,
} from '../database'
import type { ChunkInput, KnowledgeStore, WidgetRecord } from './types'

export interface ExportedDocument {
  sourceId: string
  filename: string
  contentPreview: string
  chunks: ChunkInput[]
}

export const memoryStore: KnowledgeStore = {
  kind: 'memory',

  createWorkspace() {
    return createSession()
  },

  getWorkspace(workspaceId) {
    return getSession(workspaceId)
  },

  touchWorkspace(workspaceId) {
    return updateSessionAccess(workspaceId)
  },

  async storeDocument(workspaceId, filename, chunks) {
    const { document } = await storeDocument(workspaceId, filename, chunks)
    return { documentId: document.id, chunkCount: document.chunk_count }
  },

  async listDocuments(workspaceId) {
    const documents = await getSessionDocuments(workspaceId)
    return documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      chunkCount: d.chunk_count,
      createdAt: d.created_at,
    }))
  },

  async hasDocuments(workspaceId) {
    const session = await getSession(workspaceId)
    return session ? session.document_count > 0 : false
  },

  searchChunks({ workspaceId, queryEmbedding, threshold, maxResults }) {
    return findRelevantChunks({
      session_id: workspaceId,
      query_embedding: queryEmbedding,
      similarity_threshold: threshold,
      max_results: maxResults,
    })
  },

  async createWidget(workspaceId, settings) {
    const { widget } = await createWidgetFromSession(workspaceId, { ...settings, knowledge_base_id: '' })
    return { ...widget, system_prompt: settings.system_prompt, role_context: settings.role_context }
  },

  async getWidget(ref) {
    const widget = await getWidgetByKey(ref)
    if (!widget) return null
    const knowledgeBase = getInMemoryDatabase().knowledgeBases.get(widget.knowledge_base_id)
    const record: WidgetRecord = {
      ...widget,
      system_prompt: knowledgeBase?.system_prompt,
      role_context: knowledgeBase?.role_context,
    }
    return record
  },

  widgetHasDocuments(widget) {
    return knowledgeBaseHasDocuments(widget.knowledge_base_id)
  },

  searchWidgetChunks(widget, { queryEmbedding, threshold, maxResults }) {
    return findRelevantChunksForKnowledgeBase({
      knowledge_base_id: widget.knowledge_base_id,
      query_embedding: queryEmbedding,
      similarity_threshold: threshold,
      max_results: maxResults,
    })
  },
}

export function exportMemorySession(sessionId: string): ExportedDocument[] {
  const db = getInMemoryDatabase()
  const documentIds = db.sessionDocuments.get(sessionId)
  if (!documentIds) return []

  const exported: ExportedDocument[] = []
  for (const documentId of documentIds) {
    const document = db.documents.get(documentId)
    if (!document) continue
    const chunks: ChunkInput[] = []
    for (const chunkId of db.documentChunks.get(documentId) ?? []) {
      const chunk = db.chunks.get(chunkId)
      if (chunk) chunks.push({ content: chunk.content, embedding: chunk.embedding, index: chunk.chunk_index })
    }
    chunks.sort((a, b) => a.index - b.index)
    exported.push({
      sourceId: document.id,
      filename: document.filename,
      contentPreview: document.content_preview ?? '',
      chunks,
    })
  }
  return exported
}
