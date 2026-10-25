import * as http from 'node:http'
import * as https from 'node:https'
import * as path from 'node:path'
import { isModelError, type ModelErrorCode } from '../model/shared'
import { checkModelBaseUrl, guardedLookup, type ModelProtocol } from '../model/url-guard'
import { connectorCallLog } from './log'
import { signRequestHeaders, type ConnectorMethod } from './signing'
import {
  CONNECTOR_API_VERSION,
  CONNECTOR_LIMITS,
  CONNECTOR_TIMEOUTS_MS,
  ConnectorError,
  DOCUMENT_ID_PATTERN,
  isConnectorError,
  type ConnectorCapability,
  type ConnectorConfig,
  type ConnectorDocument,
  type ConnectorErrorCode,
  type ConnectorHealth,
  type ConnectorOp,
  type ConnectorPassage,
  type DocumentPayload,
} from './shared'

export const CONNECTOR_USER_AGENT = 'ai-support-bot-connector-client/1'

const QUESTION_MAX_CHARS = 2000
const SYSTEM_PROMPT_MAX_CHARS = 4000
const MAX_ANSWER_PASSAGES = 10
const MAX_ANSWER_SOURCES = 10
const MAX_LISTED_DOCUMENTS = 1000
const MAX_CAPABILITIES = 64
const MAX_SHORT_STRING = 64

export const CONTENT_TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export interface CallOptions {
  // Test hook: shortens the op's timeout, never lengthens it.
  timeoutMs?: number
}

export type ConnectorUrlCheck =
  | { ok: true; baseUrl: string; host: string; protocol: ModelProtocol }
  | { ok: false; code: ConnectorErrorCode }

export interface ConnectorHealthResponse {
  version: string
  capabilities: string[]
}

export interface AnswerRequest {
  question: string
  passages: ConnectorPassage[]
  systemPrompt: string | null
}

export interface ConnectorAnswer {
  message: string
  sources: string[]
}

export interface CreatedDocument {
  id: string
  filename: string
  passageCount: number
}

// Read on every call, never at import, so the build and tests see the live env.
export function isPrivateConnectorHostAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.ALLOW_PRIVATE_CONNECTOR_HOSTS === '1'
}

const MODEL_TO_CONNECTOR_CODE: Partial<Record<ModelErrorCode, ConnectorErrorCode>> = {
  model_invalid_url: 'connector_invalid_url',
  model_url_too_long: 'connector_url_too_long',
  model_https_required: 'connector_https_required',
  model_address_blocked: 'connector_address_blocked',
  model_unreachable: 'connector_unreachable',
}

export function connectorCodeFromModel(code: ModelErrorCode): ConnectorErrorCode {
  return MODEL_TO_CONNECTOR_CODE[code] ?? 'connector_unreachable'
}

export function checkConnectorBaseUrl(raw: unknown, opts?: { allowPrivate?: boolean }): ConnectorUrlCheck {
  const allowPrivate = opts?.allowPrivate ?? isPrivateConnectorHostAllowed()
  const checked = checkModelBaseUrl(raw, { allowPrivate })
  if (!checked.ok) return { ok: false, code: connectorCodeFromModel(checked.code) }
  return checked
}

interface TransportRequest {
  baseUrl: string
  signer: Pick<ConnectorConfig, 'keyId' | 'secret'> | null
  op: ConnectorOp
  method: ConnectorMethod
  apiPath: string
  body?: unknown
  timeoutMs?: number
}

function errorForStatus(op: ConnectorOp, method: ConnectorMethod, status: number): ConnectorError {
  if (status >= 300 && status < 400) return new ConnectorError('connector_redirect')
  if (status === 401 || status === 403) return new ConnectorError('connector_auth_rejected')
  if (status === 404) {
    return new ConnectorError(op === 'documents' && method === 'DELETE' ? 'connector_document_not_found' : 'connector_not_found')
  }
  if (status === 413 && op === 'documents' && method === 'POST') return new ConnectorError('connector_document_too_large')
  return new ConnectorError('connector_http_error', status)
}

function connectorRequest(req: TransportRequest): Promise<unknown> {
  const allowPrivate = isPrivateConnectorHostAllowed()
  // Literal-IP hosts never reach guardedLookup, so the static check runs on every call.
  const checked = checkConnectorBaseUrl(req.baseUrl, { allowPrivate })
  if (!checked.ok) return Promise.reject(new ConnectorError(checked.code))

  const url = new URL(checked.baseUrl)
  const payload = req.body === undefined ? null : Buffer.from(JSON.stringify(req.body), 'utf8')
  const maxMs = CONNECTOR_TIMEOUTS_MS[req.op]
  const timeoutMs = Math.min(Math.max(1, req.timeoutMs ?? maxMs), maxMs)
  const transport = checked.protocol === 'https:' ? https : http

  const headers: Record<string, string> = {
    accept: 'application/json',
    'accept-encoding': 'identity',
    'user-agent': CONNECTOR_USER_AGENT,
  }
  if (payload) {
    headers['content-type'] = 'application/json'
    headers['content-length'] = String(payload.length)
  }
  if (req.signer) {
    // Signed over the API path only; a path prefix in the base URL is the backend's mount point.
    Object.assign(headers, signRequestHeaders({ config: req.signer, method: req.method, path: req.apiPath, body: payload ?? '' }))
  }

  return new Promise<unknown>((resolve, reject) => {
    let settled = false
    let request: http.ClientRequest | null = null

    const finish = (error: ConnectorError | null, value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        request?.destroy()
        reject(error)
      } else {
        resolve(value)
      }
    }
    // Raw socket, TLS and DNS errors carry hostnames: replace them with a code.
    const fromRaw = (e: unknown) => {
      if (isConnectorError(e)) finish(e)
      else if (isModelError(e)) finish(new ConnectorError(connectorCodeFromModel(e.code)))
      else finish(new ConnectorError('connector_unreachable'))
    }

    const timer = setTimeout(() => finish(new ConnectorError('connector_timeout')), timeoutMs)

    try {
      request = transport.request({
        protocol: checked.protocol,
        hostname: checked.host,
        port: url.port || undefined,
        path: url.pathname.replace(/\/+$/, '') + req.apiPath,
        method: req.method,
        agent: false,
        lookup: guardedLookup({ allowPrivate, protocol: checked.protocol }),
        headers,
      })
    } catch {
      finish(new ConnectorError('connector_unreachable'))
      return
    }

    request.on('error', fromRaw)
    request.on('response', (res) => {
      res.on('error', fromRaw)
      const status = res.statusCode ?? 0
      // Non-2xx bodies are never read: only the integer status is kept. Redirects are never followed.
      if (status < 200 || status >= 300) {
        finish(errorForStatus(req.op, req.method, status))
        return
      }

      const chunks: Buffer[] = []
      let size = 0
      res.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > CONNECTOR_LIMITS.responseBytes) {
          chunks.length = 0
          finish(new ConnectorError('connector_bad_response'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        if (settled) return
        let parsed: unknown
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          finish(new ConnectorError('connector_bad_response'))
          return
        }
        finish(null, parsed)
      })
    })
    if (payload) request.end(payload)
    else request.end()
  })
}

// One log line per call, whatever the outcome, including shape failures after the transport returns.
async function runCall<T>(op: ConnectorOp, baseUrl: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now()
  let outcome: 'ok' | ConnectorErrorCode = 'ok'
  try {
    return await fn()
  } catch (e) {
    const error = isConnectorError(e) ? e : new ConnectorError('connector_unreachable')
    outcome = error.code
    throw error
  } finally {
    connectorCallLog(op, typeof baseUrl === 'string' ? baseUrl : '', outcome, Date.now() - started)
  }
}

function badResponse(): ConnectorError {
  return new ConnectorError('connector_bad_response')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
}

function parseHealth(body: unknown): ConnectorHealthResponse {
  if (!isObject(body)) throw badResponse()
  const { version, capabilities } = body
  if (!isBoundedString(version, 1, MAX_SHORT_STRING)) throw badResponse()
  if (!Array.isArray(capabilities) || capabilities.length > MAX_CAPABILITIES) throw badResponse()
  if (!capabilities.every((c) => isBoundedString(c, 0, MAX_SHORT_STRING))) throw badResponse()
  return { version, capabilities: [...(capabilities as string[])] }
}

function parsePassage(value: unknown): ConnectorPassage {
  if (!isObject(value)) throw badResponse()
  const { documentId, filename, text, score } = value
  if (typeof documentId !== 'string' || !DOCUMENT_ID_PATTERN.test(documentId)) throw badResponse()
  if (!isBoundedString(filename, 1, CONNECTOR_LIMITS.filenameChars)) throw badResponse()
  if (!isBoundedString(text, 1, CONNECTOR_LIMITS.passageTextChars)) throw badResponse()
  if (typeof score !== 'number' || !Number.isFinite(score) || score < -1 || score > 1) throw badResponse()
  return { documentId, filename, text, score }
}

function parseDocument(value: unknown): ConnectorDocument {
  if (!isObject(value)) throw badResponse()
  const { id, filename, contentType, passageCount, createdAt } = value
  if (typeof id !== 'string' || !DOCUMENT_ID_PATTERN.test(id)) throw badResponse()
  if (!isBoundedString(filename, 1, CONNECTOR_LIMITS.filenameChars)) throw badResponse()
  if (!isBoundedString(contentType, 1, 255)) throw badResponse()
  if (!isCount(passageCount, CONNECTOR_LIMITS.passagesPerDocument)) throw badResponse()
  if (!isBoundedString(createdAt, 1, MAX_SHORT_STRING) || Number.isNaN(Date.parse(createdAt))) throw badResponse()
  return { id, filename, contentType, passageCount, createdAt }
}

export function assertCapabilities(health: ConnectorHealthResponse): ConnectorHealth {
  if (health.version !== CONNECTOR_API_VERSION) throw new ConnectorError('connector_version_unsupported')
  const known: ConnectorCapability[] = (['documents', 'search', 'answer'] as const).filter((c) =>
    health.capabilities.includes(c),
  )
  if (!known.includes('documents') || !known.includes('search')) throw new ConnectorError('connector_capability_missing')
  return { version: CONNECTOR_API_VERSION, capabilities: known, answer: known.includes('answer') }
}

export function getHealthUnsigned(baseUrl: string, opts: CallOptions = {}): Promise<ConnectorHealthResponse> {
  return runCall('health', baseUrl, async () =>
    parseHealth(
      await connectorRequest({ baseUrl, signer: null, op: 'health', method: 'GET', apiPath: '/v1/health', ...opts }),
    ),
  )
}

export function getHealth(config: ConnectorConfig, opts: CallOptions = {}): Promise<ConnectorHealthResponse> {
  return runCall('health', config.baseUrl, async () =>
    parseHealth(
      await connectorRequest({ baseUrl: config.baseUrl, signer: config, op: 'health', method: 'GET', apiPath: '/v1/health', ...opts }),
    ),
  )
}

export function searchPassages(
  config: ConnectorConfig,
  query: string,
  topK: number = CONNECTOR_LIMITS.searchTopK,
  opts: CallOptions = {},
): Promise<ConnectorPassage[]> {
  return runCall('search', config.baseUrl, async () => {
    if (!isBoundedString(query, 1, QUESTION_MAX_CHARS)) throw new ConnectorError('connector_invalid_request')
    if (!Number.isInteger(topK) || topK < 1 || topK > CONNECTOR_LIMITS.maxTopK) {
      throw new ConnectorError('connector_invalid_request')
    }
    const body = await connectorRequest({
      baseUrl: config.baseUrl,
      signer: config,
      op: 'search',
      method: 'POST',
      apiPath: '/v1/search',
      body: { query, topK },
      ...opts,
    })
    if (!isObject(body) || !Array.isArray(body.passages) || body.passages.length > topK) throw badResponse()
    return body.passages.map(parsePassage)
  })
}

export function requestAnswer(config: ConnectorConfig, input: AnswerRequest, opts: CallOptions = {}): Promise<ConnectorAnswer> {
  return runCall('answer', config.baseUrl, async () => {
    const { question, passages, systemPrompt } = input
    if (!isBoundedString(question, 1, QUESTION_MAX_CHARS)) throw new ConnectorError('connector_invalid_request')
    if (!Array.isArray(passages) || passages.length > MAX_ANSWER_PASSAGES) throw new ConnectorError('connector_invalid_request')
    if (systemPrompt !== null && !isBoundedString(systemPrompt, 0, SYSTEM_PROMPT_MAX_CHARS)) {
      throw new ConnectorError('connector_invalid_request')
    }
    const body = await connectorRequest({
      baseUrl: config.baseUrl,
      signer: config,
      op: 'answer',
      method: 'POST',
      apiPath: '/v1/answer',
      body: {
        question,
        passages: passages.map((p) => ({ documentId: p.documentId, filename: p.filename, text: p.text, score: p.score })),
        systemPrompt,
      },
      ...opts,
    })
    if (!isObject(body)) throw badResponse()
    const { message, sources } = body
    if (!isBoundedString(message, 1, CONNECTOR_LIMITS.answerMessageChars)) throw badResponse()
    if (!Array.isArray(sources) || sources.length > MAX_ANSWER_SOURCES) throw badResponse()
    if (!sources.every((s) => isBoundedString(s, 1, CONNECTOR_LIMITS.filenameChars))) throw badResponse()
    return { message, sources: [...(sources as string[])] }
  })
}

export function createDocument(config: ConnectorConfig, payload: DocumentPayload, opts: CallOptions = {}): Promise<CreatedDocument> {
  return runCall('documents', config.baseUrl, async () => {
    const body = await connectorRequest({
      baseUrl: config.baseUrl,
      signer: config,
      op: 'documents',
      method: 'POST',
      apiPath: '/v1/documents',
      body: payload,
      ...opts,
    })
    if (!isObject(body)) throw badResponse()
    const { id, filename, passageCount } = body
    if (typeof id !== 'string' || !DOCUMENT_ID_PATTERN.test(id)) throw badResponse()
    if (!isBoundedString(filename, 1, CONNECTOR_LIMITS.filenameChars)) throw badResponse()
    if (!isCount(passageCount, CONNECTOR_LIMITS.passagesPerDocument)) throw badResponse()
    return { id, filename, passageCount }
  })
}

export function listDocuments(config: ConnectorConfig, opts: CallOptions = {}): Promise<ConnectorDocument[]> {
  return runCall('documents', config.baseUrl, async () => {
    const body = await connectorRequest({
      baseUrl: config.baseUrl,
      signer: config,
      op: 'documents',
      method: 'GET',
      apiPath: '/v1/documents',
      ...opts,
    })
    if (!isObject(body) || !Array.isArray(body.documents) || body.documents.length > MAX_LISTED_DOCUMENTS) {
      throw badResponse()
    }
    return body.documents.map(parseDocument)
  })
}

export function deleteDocument(config: ConnectorConfig, id: string, opts: CallOptions = {}): Promise<{ deleted: true }> {
  return runCall('documents', config.baseUrl, async () => {
    if (typeof id !== 'string' || !DOCUMENT_ID_PATTERN.test(id)) throw new ConnectorError('connector_invalid_request')
    const body = await connectorRequest({
      baseUrl: config.baseUrl,
      signer: config,
      op: 'documents',
      method: 'DELETE',
      apiPath: `/v1/documents/${id}`,
      ...opts,
    })
    if (!isObject(body) || body.deleted !== true) throw badResponse()
    return { deleted: true as const }
  })
}

export function buildDocumentPayload(
  filename: string,
  chunks: { content: string; index: number }[],
  extension: string,
): DocumentPayload {
  const contentType = CONTENT_TYPES[extension.toLowerCase().replace(/^\./, '')]
  if (!contentType) throw new ConnectorError('connector_invalid_request')

  let name = filename
  if (name.length > CONNECTOR_LIMITS.filenameChars) name = path.basename(name)
  if (name.length === 0) throw new ConnectorError('connector_invalid_request')
  if (name.length > CONNECTOR_LIMITS.filenameChars) throw new ConnectorError('connector_document_too_large')

  if (chunks.length === 0) throw new ConnectorError('connector_invalid_request')
  if (chunks.length > CONNECTOR_LIMITS.passagesPerDocument) throw new ConnectorError('connector_document_too_large')

  const seen = new Set<number>()
  const passages = chunks.map((chunk) => {
    const text = chunk.content
    if (typeof text !== 'string' || text.length < 1 || text.length > CONNECTOR_LIMITS.passageChars) {
      throw new ConnectorError('connector_document_too_large')
    }
    const index = chunk.index
    if (!Number.isInteger(index) || index < 0 || index >= CONNECTOR_LIMITS.passagesPerDocument || seen.has(index)) {
      throw new ConnectorError('connector_invalid_request')
    }
    seen.add(index)
    return { index, text }
  })

  const payload: DocumentPayload = { filename: name, contentType, passages }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > CONNECTOR_LIMITS.documentRequestBytes) {
    throw new ConnectorError('connector_document_too_large')
  }
  return payload
}
