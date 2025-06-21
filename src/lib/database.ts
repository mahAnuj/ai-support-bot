// Optimized in-memory database implementation for demo
// This eliminates the need for PostgreSQL setup and makes the demo easier to run

import type { 
  DemoSession, 
  SessionDocument, 
  DocumentChunk, 
  VectorSearchResult,
  VectorSearchParams,
  StoredDocument 
} from '../types/database'

// In-memory storage
interface InMemoryDatabase {
  sessions: Map<string, DemoSession>
  documents: Map<string, SessionDocument>
  chunks: Map<string, DocumentChunk>
  sessionDocuments: Map<string, string[]> // sessionId -> documentIds
  documentChunks: Map<string, string[]> // documentId -> chunkIds
  createdAt: Date // Track when database was created
}

// Use global variable to persist database across hot reloads in development
declare global {
  var __ragDatabase: InMemoryDatabase | undefined
}

const createDatabase = (): InMemoryDatabase => {
  const newDb: InMemoryDatabase = {
    sessions: new Map(),
    documents: new Map(),
    chunks: new Map(),
    sessionDocuments: new Map(),
    documentChunks: new Map(),
    createdAt: new Date()
  }
  console.log('🔍 DB - New database instance created at:', newDb.createdAt.toISOString())
  return newDb
}

// In development, use global variable to persist across hot reloads
// In production, create new instance
const db: InMemoryDatabase = global.__ragDatabase || createDatabase()

if (process.env.NODE_ENV === 'development') {
  global.__ragDatabase = db
}

console.log('🔍 DB - Using database instance created at:', db.createdAt.toISOString())

// Utility function to generate UUIDs
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// Calculate cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  
  let dotProduct = 0
  let normA = 0
  let normB = 0
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  
  if (normA === 0 || normB === 0) return 0
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Database operations
export async function initializeDatabase(): Promise<void> {
  // No setup needed for in-memory database
  console.log('In-memory database initialized')
}

export async function setupDatabase(): Promise<void> {
  // No setup needed for in-memory database
  console.log('In-memory database setup completed')
}

export async function closeDatabase(): Promise<void> {
  // Clear all data
  db.sessions.clear()
  db.documents.clear()
  db.chunks.clear()
  db.sessionDocuments.clear()
  db.documentChunks.clear()
  console.log('In-memory database cleared')
}

// Create a new demo session
export async function createSession(): Promise<DemoSession> {
  const session: DemoSession = {
    id: generateUUID(),
    created_at: new Date(),
    last_accessed: new Date(),
    document_count: 0
  }
  
  db.sessions.set(session.id, session)
  db.sessionDocuments.set(session.id, [])
  
  return session
}

// Get session by ID
export async function getSession(sessionId: string): Promise<DemoSession | null> {
  return db.sessions.get(sessionId) || null
}

// Update session last accessed time
export async function updateSessionAccess(sessionId: string): Promise<void> {
  const session = db.sessions.get(sessionId)
  if (session) {
    session.last_accessed = new Date()
    db.sessions.set(sessionId, session)
  }
}

// Store document and chunks
export async function storeDocument(
  sessionId: string,
  filename: string,
  chunks: Array<{ content: string; embedding: number[]; index: number }>
): Promise<StoredDocument> {
  console.log(`🔍 DB - storeDocument called:`, {
    sessionId,
    filename,
    chunksCount: chunks.length,
    firstChunkPreview: chunks[0]?.content.substring(0, 50) + '...'
  })
  
  // Create document
  const document: SessionDocument = {
    id: generateUUID(),
    session_id: sessionId,
    filename,
    content_preview: chunks[0]?.content.substring(0, 200) || '',
    chunk_count: chunks.length,
    created_at: new Date()
  }
  
  console.log(`🔍 DB - Created document object:`, {
    documentId: document.id,
    sessionId: document.session_id,
    filename: document.filename,
    chunkCount: document.chunk_count
  })
  
  db.documents.set(document.id, document)
  console.log(`🔍 DB - Stored document in db.documents. Total documents now:`, db.documents.size)
  
  // Store chunks
  const storedChunks: DocumentChunk[] = []
  const chunkIds: string[] = []
  
  for (const chunk of chunks) {
    const storedChunk: DocumentChunk = {
      id: generateUUID(),
      document_id: document.id,
      content: chunk.content,
      embedding: chunk.embedding,
      chunk_index: chunk.index,
      created_at: new Date()
    }
    
    db.chunks.set(storedChunk.id, storedChunk)
    storedChunks.push(storedChunk)
    chunkIds.push(storedChunk.id)
  }
  
  console.log(`🔍 DB - Stored ${chunkIds.length} chunks. Total chunks now:`, db.chunks.size)
  
  db.documentChunks.set(document.id, chunkIds)
  console.log(`🔍 DB - Mapped document ${document.id} to ${chunkIds.length} chunks`)
  
  // Update session
  const sessionDocIds = db.sessionDocuments.get(sessionId) || []
  sessionDocIds.push(document.id)
  db.sessionDocuments.set(sessionId, sessionDocIds)
  console.log(`🔍 DB - Updated session ${sessionId} documents:`, sessionDocIds)
  
  const session = db.sessions.get(sessionId)
  if (session) {
    session.document_count = sessionDocIds.length
    db.sessions.set(sessionId, session)
    console.log(`🔍 DB - Updated session document count to:`, session.document_count)
  } else {
    console.error(`🔍 DB - ERROR: Session ${sessionId} not found when updating document count!`)
  }
  
  console.log(`🔍 DB - Final database state:`, {
    totalSessions: db.sessions.size,
    totalDocuments: db.documents.size,
    totalChunks: db.chunks.size
  })
  
  return {
    document,
    chunks: storedChunks
  }
}

// Find relevant chunks using vector similarity
export async function findRelevantChunks({
  session_id,
  query_embedding,
  similarity_threshold = 0.7,
  max_results = 5
}: VectorSearchParams): Promise<VectorSearchResult[]> {
  console.log(`🔍 VECTOR SEARCH - Starting search with threshold: ${similarity_threshold}`)
  console.log(`🔍 VECTOR SEARCH - Query embedding length: ${query_embedding.length}`)
  console.log(`🔍 VECTOR SEARCH - Query embedding sample: [${query_embedding.slice(0, 5).join(', ')}]`)
  
  const sessionDocIds = db.sessionDocuments.get(session_id) || []
  const results: VectorSearchResult[] = []
  const allSimilarities: number[] = []
  
  // Search through all chunks in the session
  for (const docId of sessionDocIds) {
    const document = db.documents.get(docId)
    if (!document) continue
    
    const chunkIds = db.documentChunks.get(docId) || []
    console.log(`🔍 VECTOR SEARCH - Processing ${chunkIds.length} chunks for document: ${document.filename}`)
    
    for (const chunkId of chunkIds) {
      const chunk = db.chunks.get(chunkId)
      if (!chunk) continue
      
      const similarity = cosineSimilarity(query_embedding, chunk.embedding)
      allSimilarities.push(similarity)
      
      console.log(`🔍 VECTOR SEARCH - Chunk ${chunk.chunk_index}: similarity = ${similarity.toFixed(4)} (threshold: ${similarity_threshold})`)
      
      if (similarity >= similarity_threshold) {
        results.push({
          content: chunk.content,
          filename: document.filename,
          similarity,
          chunk_index: chunk.chunk_index,
          document_id: document.id
        })
      }
    }
  }
  
  console.log(`🔍 VECTOR SEARCH - All similarities: [${allSimilarities.map(s => s.toFixed(4)).join(', ')}]`)
  console.log(`🔍 VECTOR SEARCH - Max similarity: ${Math.max(...allSimilarities).toFixed(4)}`)
  console.log(`🔍 VECTOR SEARCH - Found ${results.length} chunks above threshold`)
  
  // Sort by similarity and limit results
  results.sort((a, b) => b.similarity - a.similarity)
  return results.slice(0, max_results)
}

// Get all documents for a session
export async function getSessionDocuments(sessionId: string): Promise<SessionDocument[]> {
  const sessionDocIds = db.sessionDocuments.get(sessionId) || []
  const documents: SessionDocument[] = []
  
  for (const docId of sessionDocIds) {
    const document = db.documents.get(docId)
    if (document) {
      documents.push(document)
    }
  }
  
  return documents
}

// Clean up old sessions (older than 24 hours)
export async function cleanupOldSessions(): Promise<number> {
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 hours ago
  let cleanedCount = 0
  
  for (const [sessionId, session] of db.sessions.entries()) {
    if (session.last_accessed < cutoffTime) {
      // Remove session documents and chunks
      const sessionDocIds = db.sessionDocuments.get(sessionId) || []
      for (const docId of sessionDocIds) {
        const chunkIds = db.documentChunks.get(docId) || []
        for (const chunkId of chunkIds) {
          db.chunks.delete(chunkId)
        }
        db.documentChunks.delete(docId)
        db.documents.delete(docId)
      }
      
      // Remove session
      db.sessionDocuments.delete(sessionId)
      db.sessions.delete(sessionId)
      cleanedCount++
    }
  }
  
  return cleanedCount
}

// Get database statistics
export async function getDatabaseStats(): Promise<{
  sessions: number
  documents: number
  chunks: number
}> {
  return {
    sessions: db.sessions.size,
    documents: db.documents.size,
    chunks: db.chunks.size
  }
}

// Export the database instance for testing
export const getInMemoryDatabase = () => db 