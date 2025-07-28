// Multi-tenant database types for production RAG system
// Supports businesses with isolated knowledge bases and embeddable widgets

// =======================
// BUSINESS/TENANT TYPES
// =======================

export interface Business {
  id: string
  name: string
  email: string
  api_key: string
  plan_type: 'free' | 'pro' | 'enterprise'
  max_documents: number
  max_storage_mb: number
  created_at: Date
  updated_at: Date
  is_active: boolean
}

export interface BusinessUsage {
  business_id: string
  documents_count: number
  storage_used_mb: number
  queries_this_month: number
  last_reset_date: Date
}

// =======================
// KNOWLEDGE BASE TYPES
// =======================

export interface KnowledgeBase {
  id: string
  business_id: string
  name: string
  description?: string
  system_prompt?: string
  role_context?: string
  is_active: boolean
  created_at: Date
  updated_at: Date
}

export interface KnowledgeDocument {
  id: string
  knowledge_base_id: string
  filename: string
  original_filename: string
  content_preview?: string
  file_size_bytes: number
  mime_type: string
  chunk_count: number
  status: 'processing' | 'completed' | 'failed'
  error_message?: string
  created_at: Date
  updated_at: Date
}

export interface DocumentChunk {
  id: string
  document_id: string
  knowledge_base_id: string // Denormalized for faster queries
  content: string
  embedding: number[]
  chunk_index: number
  token_count: number
  created_at: Date
}

// =======================
// WIDGET TYPES
// =======================

export interface Widget {
  id: string
  business_id: string
  knowledge_base_id: string
  widget_key: string // Public key for embedding
  name: string
  title: string
  welcome_message: string
  primary_color: string
  position: 'bottom-right' | 'bottom-left'
  size: 'small' | 'medium' | 'large'
  allowed_domains: string[]
  is_active: boolean
  created_at: Date
  updated_at: Date
}

// =======================
// ANALYTICS TYPES
// =======================

export interface WidgetConversation {
  id: string
  widget_id: string
  session_id: string
  user_ip?: string
  user_agent?: string
  domain?: string
  messages_count: number
  started_at: Date
  last_message_at: Date
}

export interface WidgetMessage {
  id: string
  conversation_id: string
  message_type: 'user' | 'assistant'
  content: string
  confidence_score?: number
  sources_used?: string[]
  response_time_ms?: number
  created_at: Date
}

// =======================
// SEARCH & QUERY TYPES
// =======================

export interface VectorSearchParams {
  knowledge_base_id: string
  query_embedding: number[]
  similarity_threshold?: number
  max_results?: number
}

export interface VectorSearchResult {
  chunk_id: string
  content: string
  filename: string
  similarity: number
  chunk_index: number
}

export interface RAGQueryResult {
  context: string
  sources: string[]
  relevant_chunks: VectorSearchResult[]
  confidence: number
  knowledge_base_id: string
}

// =======================
// API REQUEST/RESPONSE TYPES
// =======================

export interface CreateBusinessRequest {
  name: string
  email: string
  plan_type?: 'free' | 'pro' | 'enterprise'
}

export interface CreateKnowledgeBaseRequest {
  name: string
  description?: string
  system_prompt?: string
  role_context?: string
}

export interface CreateWidgetRequest {
  knowledge_base_id: string
  name: string
  title?: string
  welcome_message?: string
  primary_color?: string
  position?: 'bottom-right' | 'bottom-left'
  size?: 'small' | 'medium' | 'large'
  allowed_domains?: string[]
}

export interface UploadDocumentRequest {
  knowledge_base_id: string
  files: File[]
}

export interface WidgetChatRequest {
  widget_key: string
  message: string
  session_id?: string
  conversation_id?: string
}

export interface WidgetChatResponse {
  message: string
  confidence: number
  sources: string[]
  conversation_id: string
  session_id: string
}

// =======================
// LEGACY TYPES (for migration)
// =======================

// Keep old types for backward compatibility during migration
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
  content_preview?: string
  chunk_count: number
  created_at: Date
}

// Legacy storage type
export interface StoredDocument {
  document: SessionDocument
  chunks: DocumentChunk[]
}

// =======================
// UTILITY TYPES
// =======================

export interface DatabaseStats {
  businesses: number
  knowledge_bases: number
  documents: number
  chunks: number
  widgets: number
  conversations: number
}

export interface BusinessLimits {
  max_documents: number
  max_storage_mb: number
  max_queries_per_month: number
  can_create_widgets: boolean
  can_use_custom_branding: boolean
}

export interface AuthContext {
  business_id: string
  api_key: string
  plan_type: string
  limits: BusinessLimits
} 