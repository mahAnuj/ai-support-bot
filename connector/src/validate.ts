import { CONTENT_TYPES, type ContentType, type NewDocument, type SearchHit } from './store.js'

// Request body rules from docs/connector-api.md. "Characters" are UTF-16
// code units (JavaScript .length). Unknown fields are ignored.

export const LIMITS = {
  documentBodyBytes: 2_097_152,
  queryBodyBytes: 262_144,
  filenameChars: 255,
  passagesPerDocument: 1000,
  maxPassageIndex: 999,
  passageChars: 1000,
  queryChars: 2000,
  maxTopK: 10,
  answerPassages: 10,
  answerPassageTextChars: 10_000,
  systemPromptChars: 4000,
  answerMessageChars: 20_000,
  answerSources: 10,
} as const

export const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9._~-]{1,128}$/

export type Parsed<T> = { ok: true; value: T } | { ok: false }

const fail = { ok: false } as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function parseDocumentBody(body: unknown): Parsed<NewDocument> {
  if (!isObject(body)) return fail
  const { filename, contentType, passages } = body
  if (!isText(filename, 1, LIMITS.filenameChars)) return fail
  if (typeof contentType !== 'string' || !(CONTENT_TYPES as readonly string[]).includes(contentType)) return fail
  if (!Array.isArray(passages) || passages.length < 1 || passages.length > LIMITS.passagesPerDocument) return fail
  const seen = new Set<number>()
  const out: NewDocument['passages'] = []
  for (const passage of passages) {
    if (!isObject(passage)) return fail
    const { index, text } = passage
    if (!isIntIn(index, 0, LIMITS.maxPassageIndex) || seen.has(index)) return fail
    if (!isText(text, 1, LIMITS.passageChars)) return fail
    seen.add(index)
    out.push({ index, text })
  }
  return { ok: true, value: { filename, contentType: contentType as ContentType, passages: out } }
}

export interface SearchRequest {
  query: string
  topK: number
}

export function parseSearchBody(body: unknown): Parsed<SearchRequest> {
  if (!isObject(body)) return fail
  const { query, topK } = body
  if (!isText(query, 1, LIMITS.queryChars) || !isIntIn(topK, 1, LIMITS.maxTopK)) return fail
  return { ok: true, value: { query, topK } }
}

export interface AnswerRequest {
  question: string
  passages: SearchHit[] | null
  systemPrompt: string | null
}

function parsePassage(value: unknown): SearchHit | null {
  if (!isObject(value)) return null
  const { documentId, filename, text, score } = value
  if (typeof documentId !== 'string' || !DOCUMENT_ID_PATTERN.test(documentId)) return null
  if (!isText(filename, 1, LIMITS.filenameChars)) return null
  if (!isText(text, 0, LIMITS.answerPassageTextChars)) return null
  if (typeof score !== 'number' || !Number.isFinite(score)) return null
  return { documentId, filename, text, score }
}

export function parseAnswerBody(body: unknown): Parsed<AnswerRequest> {
  if (!isObject(body)) return fail
  const { question } = body
  // A missing field is read as null.
  const passages = body.passages ?? null
  const systemPrompt = body.systemPrompt ?? null
  if (!isText(question, 1, LIMITS.queryChars)) return fail
  if (!(systemPrompt === null || isText(systemPrompt, 0, LIMITS.systemPromptChars))) return fail
  let parsedPassages: SearchHit[] | null = null
  if (passages !== null) {
    if (!Array.isArray(passages) || passages.length > LIMITS.answerPassages) return fail
    parsedPassages = []
    for (const item of passages) {
      const passage = parsePassage(item)
      if (!passage) return fail
      parsedPassages.push(passage)
    }
  }
  return { ok: true, value: { question, passages: parsedPassages, systemPrompt: systemPrompt === '' ? null : systemPrompt } }
}

/** Parses a raw JSON body. Undefined when it is not valid UTF-8 JSON. */
export function parseJson(raw: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  } catch {
    return undefined
  }
}
