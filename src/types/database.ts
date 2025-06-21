// Database types for PostgreSQL + pgvector integration

export interface DemoSession {
  id: string
  created_at: Date
  last_accessed: Date
  document_count: number
}

export interface SessionDocument {
  id: string
  session_id: string
  filename: string
  content_preview: string // First 200 chars for display
  chunk_count: number
  created_at: Date
}

export interface DocumentChunk {
  id: string
  document_id: string
  content: string
  embedding: number[] // Vector embedding
  chunk_index: number
  created_at: Date
}

export interface VectorSearchResult {
  content: string
  filename: string
  similarity: number
  chunk_index: number
  document_id: string
}

export interface DatabaseConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
}

// Query parameters for vector search
export interface VectorSearchParams {
  session_id: string
  query_embedding: number[]
  similarity_threshold?: number
  max_results?: number
}

// Result from document processing
export interface StoredDocument {
  document: SessionDocument
  chunks: DocumentChunk[]
} 