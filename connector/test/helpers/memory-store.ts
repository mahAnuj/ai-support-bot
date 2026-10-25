import { randomUUID } from 'node:crypto'
import type { KnowledgeStore, NewDocument, SearchHit, StoredDocument } from '../../src/store.js'

interface Row {
  doc: StoredDocument
  order: number
  chunks: { index: number; text: string; embedding: number[] }[]
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

/** In-memory KnowledgeStore with the same ordering rules as pg-store. Tests only. */
export class MemoryStore implements KnowledgeStore {
  readonly rows = new Map<string, Row>()
  private counter = 0

  async insertDocument(doc: NewDocument, embeddings: number[][]): Promise<StoredDocument> {
    if (embeddings.length !== doc.passages.length) throw new Error('embedding count does not match passages')
    const order = this.counter++
    const stored: StoredDocument = {
      id: randomUUID(),
      filename: doc.filename,
      contentType: doc.contentType,
      passageCount: doc.passages.length,
      createdAt: new Date(Date.UTC(2026, 0, 1) + order * 1000).toISOString(),
    }
    this.rows.set(stored.id, {
      doc: stored,
      order,
      chunks: doc.passages.map((p, i) => ({ index: p.index, text: p.text, embedding: embeddings[i] })),
    })
    return stored
  }

  async listDocuments(limit: number): Promise<StoredDocument[]> {
    return [...this.rows.values()].sort((a, b) => a.order - b.order).slice(0, limit).map((r) => r.doc)
  }

  async deleteDocument(id: string): Promise<boolean> {
    return this.rows.delete(id)
  }

  async search(embedding: number[], topK: number): Promise<SearchHit[]> {
    const hits: (SearchHit & { order: number; index: number })[] = []
    for (const row of this.rows.values()) {
      for (const chunk of row.chunks) {
        hits.push({
          documentId: row.doc.id,
          filename: row.doc.filename,
          text: chunk.text,
          score: cosine(embedding, chunk.embedding),
          order: row.order,
          index: chunk.index,
        })
      }
    }
    hits.sort((a, b) => b.score - a.score || a.order - b.order || a.index - b.index)
    return hits.slice(0, topK).map(({ documentId, filename, text, score }) => ({ documentId, filename, text, score }))
  }
}
