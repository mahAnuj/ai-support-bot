import * as http from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { bodySha256Hex, canonicalString, signCanonical } from '../../src/lib/connector/signing'
import { KEY_ID_PATTERN, NONCE_PATTERN, SIGNATURE_PATTERN, TIMESTAMP_PATTERN } from '../../src/lib/connector/shared'

// In-memory v1 connector for app tests. Listens on 127.0.0.1 only; never reaches the network.

export const SENTINEL = 'CONNECTOR-BODY-SENTINEL-5e1d'

export type SignatureCheck = 'valid' | 'invalid' | 'unsigned'

export interface MockRequest {
  method: string
  path: string
  headers: http.IncomingHttpHeaders
  body: string
  signature: SignatureCheck
}

export interface MockOverride {
  status?: number
  headers?: Record<string, string>
  // A string is sent as is; anything else is JSON-encoded.
  body?: unknown
  delayMs?: number
  redirect?: string
  hugeBodyBytes?: number
  handler?: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void
}

export interface MockDocument {
  id: string
  filename: string
  contentType: string
  passages: { index: number; text: string }[]
  createdAt: string
}

export interface MockBackendOptions {
  keyId?: string
  secret?: string
  version?: string
  capabilities?: string[]
  // Mount prefix the backend strips before routing and verifying, e.g. '/prefix'.
  basePath?: string
  documents?: MockDocument[]
  // Keyed by "METHOD /v1/path" (exact) or "/v1/path" (any method).
  overrides?: Record<string, MockOverride>
  // Fixed search result; defaults to a word-overlap score over stored passages.
  searchResults?: { documentId: string; filename: string; text: string; score: number }[]
  answer?: { message: string; sources: string[] }
}

export interface MockBackend {
  baseUrl: string
  port: number
  requests: MockRequest[]
  documents: MockDocument[]
  options: MockBackendOptions
  close(): Promise<void>
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()]
  return typeof value === 'string' ? value : undefined
}

function checkSignature(req: http.IncomingMessage, path: string, body: Buffer, opts: MockBackendOptions): SignatureCheck {
  const keyId = header(req, 'x-connector-key-id')
  const timestamp = header(req, 'x-connector-timestamp')
  const nonce = header(req, 'x-connector-nonce')
  const signature = header(req, 'x-connector-signature')
  if (keyId === undefined && timestamp === undefined && nonce === undefined && signature === undefined) return 'unsigned'
  if (!keyId || !timestamp || !nonce || !signature) return 'invalid'
  if (!KEY_ID_PATTERN.test(keyId) || !TIMESTAMP_PATTERN.test(timestamp) || !NONCE_PATTERN.test(nonce)) return 'invalid'
  if (!SIGNATURE_PATTERN.test(signature)) return 'invalid'
  if (!opts.secret || keyId !== opts.keyId) return 'invalid'
  const expected = signCanonical(
    opts.secret,
    canonicalString({ method: req.method ?? '', path, timestamp, nonce, bodySha256: bodySha256Hex(body) }),
  )
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature)) ? 'valid' : 'invalid'
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(text)
}

function sendError(res: http.ServerResponse, status: number, code: string): void {
  sendJson(res, status, { error: { code, detail: SENTINEL } }, { 'x-sentinel': SENTINEL })
}

function scoreFor(query: string, text: string): number {
  const words = query.toLowerCase().split(/\W+/).filter(Boolean)
  if (words.length === 0) return 0
  const hay = text.toLowerCase()
  return words.filter((w) => hay.includes(w)).length / words.length
}

function applyOverride(o: MockOverride, req: http.IncomingMessage, res: http.ServerResponse, body: string): void {
  const run = () => {
    if (res.destroyed) return
    if (o.handler) {
      o.handler(req, res, body)
      return
    }
    if (o.redirect) {
      res.writeHead(o.status ?? 302, { location: o.redirect, 'x-sentinel': SENTINEL, ...(o.headers ?? {}) })
      res.end(JSON.stringify({ error: { code: SENTINEL } }))
      return
    }
    if (o.hugeBodyBytes) {
      res.writeHead(o.status ?? 200, { 'content-type': 'application/json', ...(o.headers ?? {}) })
      const chunk = Buffer.alloc(64 * 1024, 'a')
      let sent = 0
      const write = () => {
        while (sent < o.hugeBodyBytes!) {
          sent += chunk.length
          if (!res.write(chunk)) {
            res.once('drain', write)
            return
          }
        }
        res.end()
      }
      res.on('error', () => undefined)
      write()
      return
    }
    sendJson(res, o.status ?? 200, o.body ?? { error: { code: SENTINEL } }, o.headers ?? {})
  }
  if (o.delayMs) setTimeout(run, o.delayMs)
  else run()
}

export async function startMockBackend(opts: MockBackendOptions = {}): Promise<MockBackend> {
  const requests: MockRequest[] = []
  const documents: MockDocument[] = [...(opts.documents ?? [])]
  const basePath = opts.basePath ?? ''

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks)
      const body = raw.toString('utf8')
      const fullPath = req.url ?? '/'
      const method = req.method ?? ''

      if (basePath && !fullPath.startsWith(basePath + '/')) {
        requests.push({ method, path: fullPath, headers: req.headers, body, signature: 'unsigned' })
        sendError(res, 404, 'not_found')
        return
      }
      const path = fullPath.slice(basePath.length)
      const signature = checkSignature(req, path, raw, opts)
      requests.push({ method, path: fullPath, headers: req.headers, body, signature })

      const route = path.split('?')[0]
      const override = opts.overrides?.[`${method} ${route}`] ?? opts.overrides?.[route]
      if (override) {
        applyOverride(override, req, res, body)
        return
      }

      const unsignedHealth = signature === 'unsigned' && method === 'GET' && route === '/v1/health'
      if (!unsignedHealth && signature !== 'valid') {
        sendError(res, 401, 'unauthorized')
        return
      }

      let parsed: Record<string, unknown> = {}
      if (raw.length > 0) {
        try {
          parsed = JSON.parse(body) as Record<string, unknown>
        } catch {
          sendError(res, 400, 'bad_request')
          return
        }
      }

      if (route === '/v1/health' && method === 'GET') {
        sendJson(res, 200, { version: opts.version ?? '1', capabilities: opts.capabilities ?? ['documents', 'search'] })
        return
      }
      if (route === '/v1/documents' && method === 'GET') {
        sendJson(res, 200, {
          documents: documents.map((d) => ({
            id: d.id,
            filename: d.filename,
            contentType: d.contentType,
            passageCount: d.passages.length,
            createdAt: d.createdAt,
          })),
        })
        return
      }
      if (route === '/v1/documents' && method === 'POST') {
        const doc: MockDocument = {
          id: randomUUID(),
          filename: String(parsed.filename),
          contentType: String(parsed.contentType),
          passages: Array.isArray(parsed.passages) ? (parsed.passages as MockDocument['passages']) : [],
          createdAt: new Date().toISOString(),
        }
        documents.push(doc)
        sendJson(res, 201, { id: doc.id, filename: doc.filename, passageCount: doc.passages.length })
        return
      }
      if (route.startsWith('/v1/documents/') && method === 'DELETE') {
        const id = route.slice('/v1/documents/'.length)
        const at = documents.findIndex((d) => d.id === id)
        if (at === -1) {
          sendError(res, 404, 'not_found')
          return
        }
        documents.splice(at, 1)
        sendJson(res, 200, { deleted: true })
        return
      }
      if (route === '/v1/search' && method === 'POST') {
        const topK = typeof parsed.topK === 'number' ? parsed.topK : 5
        const query = typeof parsed.query === 'string' ? parsed.query : ''
        const results =
          opts.searchResults ??
          documents
            .flatMap((d) =>
              d.passages.map((p) => ({ documentId: d.id, filename: d.filename, text: p.text, score: scoreFor(query, p.text) })),
            )
            .sort((a, b) => b.score - a.score)
        sendJson(res, 200, { passages: results.slice(0, topK) })
        return
      }
      if (route === '/v1/answer' && method === 'POST') {
        if (!(opts.capabilities ?? []).includes('answer') && !opts.answer) {
          sendError(res, 404, 'not_found')
          return
        }
        sendJson(res, 200, opts.answer ?? { message: 'Mock answer.', sources: [] })
        return
      }
      sendError(res, 404, 'not_found')
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port

  return {
    baseUrl: `http://127.0.0.1:${port}${basePath}`,
    port,
    requests,
    documents,
    options: opts,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
