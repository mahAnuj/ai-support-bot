export const CONTENT_TYPES = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

export type ContentType = (typeof CONTENT_TYPES)[number]

export const MAX_LISTED_DOCUMENTS = 1000
export const EMBEDDING_DIM = 384

export interface Passage {
  index: number
  text: string
}

export interface NewDocument {
  filename: string
  contentType: ContentType
  passages: Passage[]
}

export interface StoredDocument {
  id: string
  filename: string
  contentType: string
  passageCount: number
  /** ISO 8601 */
  createdAt: string
}

export interface SearchHit {
  documentId: string
  filename: string
  text: string
  score: number
}

/** Where the reference server keeps documents. One knowledge base per deployment. */
export interface KnowledgeStore {
  /** `embeddings[i]` belongs to `doc.passages[i]`. Stores everything or nothing. */
  insertDocument(doc: NewDocument, embeddings: number[][]): Promise<StoredDocument>
  /** Ordered by createdAt, then id. */
  listDocuments(limit: number): Promise<StoredDocument[]>
  /** False when no document has this id. */
  deleteDocument(id: string): Promise<boolean>
  /** Exact cosine similarity, highest first. */
  search(embedding: number[], topK: number): Promise<SearchHit[]>
}
