import type { Embedder } from './embed.js'
import type { Outcome } from './log.js'
import { ModelCallError, type AnswerModel } from './model.js'
import { MAX_LISTED_DOCUMENTS, type KnowledgeStore, type SearchHit } from './store.js'
import { LIMITS, parseAnswerBody, parseDocumentBody, parseSearchBody } from './validate.js'

export const API_VERSION = '1'
// Same cut-off as the app's MIN_SIMILARITY (src/lib/embeddings.ts), used when
// /v1/answer is asked to retrieve for itself.
export const MIN_SIMILARITY = 0.15
export const ANSWER_TOP_K = 5

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'not_found'
  | 'method_not_allowed'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'internal'
  | 'upstream_error'

export const ERROR_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal: 500,
  upstream_error: 502,
}

export interface HandlerResult {
  status: number
  body: unknown
  outcome: Outcome
}

export interface HandlerDeps {
  store: KnowledgeStore
  embedder: Embedder
  /** Null when the model variables are not all set: /v1/answer is then not offered. */
  model: AnswerModel | null
}

export function errorResult(code: ErrorCode): HandlerResult {
  const outcome: Outcome = code === 'unauthorized' ? 'unauthorized:unknown' : code
  return { status: ERROR_STATUS[code], body: { error: { code } }, outcome }
}

function ok(status: number, body: unknown): HandlerResult {
  return { status, body, outcome: 'ok' }
}

export function health(deps: HandlerDeps): HandlerResult {
  const capabilities = deps.model ? ['documents', 'search', 'answer'] : ['documents', 'search']
  return ok(200, { version: API_VERSION, capabilities })
}

export async function createDocument(deps: HandlerDeps, body: unknown): Promise<HandlerResult> {
  const parsed = parseDocumentBody(body)
  if (!parsed.ok) return errorResult('bad_request')
  const doc = parsed.value
  const embeddings = await deps.embedder.embed(doc.passages.map((p) => p.text))
  const stored = await deps.store.insertDocument(doc, embeddings)
  return ok(201, { id: stored.id, filename: stored.filename, passageCount: stored.passageCount })
}

export async function listDocuments(deps: HandlerDeps): Promise<HandlerResult> {
  const documents = await deps.store.listDocuments(MAX_LISTED_DOCUMENTS)
  return ok(200, {
    documents: documents.map((d) => ({
      id: d.id,
      filename: d.filename,
      contentType: d.contentType,
      passageCount: d.passageCount,
      createdAt: d.createdAt,
    })),
  })
}

export async function deleteDocument(deps: HandlerDeps, id: string): Promise<HandlerResult> {
  const deleted = await deps.store.deleteDocument(id)
  return deleted ? ok(200, { deleted: true }) : errorResult('not_found')
}

async function retrieve(deps: HandlerDeps, query: string, topK: number): Promise<SearchHit[]> {
  const [embedding] = await deps.embedder.embed([query])
  return deps.store.search(embedding, topK)
}

export async function search(deps: HandlerDeps, body: unknown): Promise<HandlerResult> {
  const parsed = parseSearchBody(body)
  if (!parsed.ok) return errorResult('bad_request')
  const hits = await retrieve(deps, parsed.value.query, parsed.value.topK)
  return ok(200, {
    passages: hits.map((h) => ({ documentId: h.documentId, filename: h.filename, text: h.text, score: h.score })),
  })
}

export async function answer(deps: HandlerDeps, body: unknown): Promise<HandlerResult> {
  if (!deps.model) return errorResult('not_found')
  const parsed = parseAnswerBody(body)
  if (!parsed.ok) return errorResult('bad_request')
  const { question, systemPrompt } = parsed.value
  const passages =
    parsed.value.passages ?? (await retrieve(deps, question, ANSWER_TOP_K)).filter((p) => p.score >= MIN_SIMILARITY)

  let message: string
  try {
    message = await deps.model.answer({ question, passages, systemPrompt })
  } catch (error) {
    if (error instanceof ModelCallError) return errorResult('upstream_error')
    throw error
  }
  const sources = [...new Set(passages.map((p) => p.filename))].slice(0, LIMITS.answerSources)
  return ok(200, { message: message.slice(0, LIMITS.answerMessageChars), sources })
}
