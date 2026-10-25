import type { DemoSession, VectorSearchResult, Widget } from '../../types/database'

export type StoreKind = 'memory' | 'postgres'

export interface ChunkInput { content: string; embedding: number[]; index: number }

export interface DocumentSummary { id: string; filename: string; chunkCount: number; createdAt: Date }

export interface SearchParams { workspaceId: string; queryEmbedding: number[]; threshold: number; maxResults: number }

export interface WidgetSearchParams { queryEmbedding: number[]; threshold: number; maxResults: number }

export interface WidgetSettings {
  name: string
  title: string
  welcome_message: string
  primary_color: string
  position: 'bottom-right' | 'bottom-left'
  size: 'small' | 'medium' | 'large'
  allowed_domains: string[]
  allowed_origins?: string[]
  sealed?: boolean
  business_name?: string
  system_prompt?: string
  role_context?: string
}

export interface WidgetRecord extends Widget { system_prompt?: string; role_context?: string }

export interface KnowledgeStore {
  readonly kind: StoreKind
  createWorkspace(): Promise<DemoSession>
  getWorkspace(workspaceId: string): Promise<DemoSession | null>
  touchWorkspace(workspaceId: string): Promise<void>
  storeDocument(workspaceId: string, filename: string, chunks: ChunkInput[]): Promise<{ documentId: string; chunkCount: number }>
  listDocuments(workspaceId: string): Promise<DocumentSummary[]>
  hasDocuments(workspaceId: string): Promise<boolean>
  searchChunks(params: SearchParams): Promise<VectorSearchResult[]>
  createWidget(workspaceId: string, settings: WidgetSettings): Promise<WidgetRecord>
  /** memory: widget key; postgres: widget uuid */
  getWidget(ref: string): Promise<WidgetRecord | null>
  widgetHasDocuments(widget: WidgetRecord): Promise<boolean>
  searchWidgetChunks(widget: WidgetRecord, params: WidgetSearchParams): Promise<VectorSearchResult[]>
}
