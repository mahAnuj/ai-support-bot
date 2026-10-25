import * as http from 'node:http'
import type { Config } from './config.js'
import type { Embedder } from './embed.js'
import * as handlers from './handlers.js'
import { errorResult, type HandlerDeps, type HandlerResult } from './handlers.js'
import { logError, logRequest, type Op, type Outcome } from './log.js'
import { openAICompatibleModel, type AnswerModel } from './model.js'
import type { NonceStore } from './nonce-store.js'
import { sqlState } from './pg-store.js'
import { isUnsigned, verifyRequest } from './signing.js'
import type { KnowledgeStore } from './store.js'
import { DOCUMENT_ID_PATTERN, LIMITS, parseJson } from './validate.js'

export const REQUEST_TIMEOUT_MS = 60_000

export interface ServerOptions {
  config: Config
  store: KnowledgeStore
  embedder: Embedder
  nonceStore: NonceStore
  /**
   * The answer model. Used only when config.model is set; when omitted it is
   * built from config.model. Without config.model, /v1/answer does not exist.
   */
  model?: AnswerModel | null
  /** Current Unix time in seconds. */
  now?: () => number
}

type Action = 'health' | 'createDocument' | 'listDocuments' | 'deleteDocument' | 'search' | 'answer'

interface Route {
  op: Op
  actions: Partial<Record<string, Action>>
  id?: string
}

function matchRoute(pathname: string, answerEnabled: boolean): Route | null {
  switch (pathname) {
    case '/v1/health':
      return { op: 'health', actions: { GET: 'health' } }
    case '/v1/documents':
      return { op: 'documents', actions: { GET: 'listDocuments', POST: 'createDocument' } }
    case '/v1/search':
      return { op: 'search', actions: { POST: 'search' } }
    case '/v1/answer':
      return answerEnabled ? { op: 'answer', actions: { POST: 'answer' } } : null
  }
  const prefix = '/v1/documents/'
  if (pathname.startsWith(prefix)) {
    const id = pathname.slice(prefix.length)
    if (DOCUMENT_ID_PATTERN.test(id)) return { op: 'documents', actions: { DELETE: 'deleteDocument' }, id }
  }
  return null
}

/** The path and query after the mount prefix, or null when the request is outside it. */
function stripBasePath(rawUrl: string, basePath: string | null): string | null {
  if (!rawUrl.startsWith('/')) return null
  if (basePath === null) return rawUrl
  if (!rawUrl.startsWith(basePath)) return null
  const rest = rawUrl.slice(basePath.length)
  return rest.startsWith('/') ? rest : null
}

function bodyLimit(action: Action): number {
  if (action === 'createDocument') return LIMITS.documentBodyBytes
  if (action === 'search' || action === 'answer') return LIMITS.queryBodyBytes
  return 0
}

function isJsonContentType(header: string | undefined): boolean {
  if (!header) return false
  return header.split(';')[0].trim().toLowerCase() === 'application/json'
}

type BodyRead = { ok: true; body: Buffer } | { ok: false; reason: 'too_large' | 'aborted' }

function readBody(req: http.IncomingMessage, limit: number): Promise<BodyRead> {
  const declared = req.headers['content-length']
  if (declared !== undefined && Number(declared) > limit) {
    return Promise.resolve({ ok: false, reason: 'too_large' })
  }
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (result: BodyRead) => {
      if (done) return
      done = true
      req.off('data', onData)
      resolve(result)
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        chunks.length = 0
        // Stop reading; the 413 response closes the connection.
        req.pause()
        finish({ ok: false, reason: 'too_large' })
        return
      }
      chunks.push(chunk)
    }
    req.on('data', onData)
    req.on('end', () => finish({ ok: true, body: Buffer.concat(chunks) }))
    req.on('error', () => finish({ ok: false, reason: 'aborted' }))
    req.on('aborted', () => finish({ ok: false, reason: 'aborted' }))
  })
}

function send(res: http.ServerResponse, result: HandlerResult, extraHeaders: Record<string, string> = {}): void {
  if (res.headersSent || res.destroyed) return
  const payload = Buffer.from(JSON.stringify(result.body), 'utf8')
  res.writeHead(result.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  })
  res.end(payload)
}

export function createServer(options: ServerOptions): http.Server {
  const { config, store, embedder, nonceStore } = options
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  const model: AnswerModel | null = config.model ? (options.model ?? openAICompatibleModel(config.model)) : null
  const deps: HandlerDeps = { store, embedder, model }

  const run = async (action: Action, route: Route, body: unknown): Promise<HandlerResult> => {
    switch (action) {
      case 'health':
        return handlers.health(deps)
      case 'createDocument':
        return handlers.createDocument(deps, body)
      case 'listDocuments':
        return handlers.listDocuments(deps)
      case 'deleteDocument':
        return handlers.deleteDocument(deps, route.id ?? '')
      case 'search':
        return handlers.search(deps, body)
      case 'answer':
        return handlers.answer(deps, body)
    }
  }

  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const started = Date.now()
    let op: Op = 'unknown'
    let keyId: string | null = null
    let outcome: Outcome = 'internal'
    let status = 500

    const reply = (result: HandlerResult, extraHeaders?: Record<string, string>) => {
      outcome = result.outcome
      status = result.status
      send(res, result, extraHeaders)
    }

    try {
      const method = (req.method ?? '').toUpperCase()
      const path = stripBasePath(req.url ?? '', config.basePath)
      const route = path === null ? null : matchRoute(path.split('?')[0], model !== null)
      if (path === null || route === null) {
        reply(errorResult('not_found'))
        return
      }
      op = route.op
      const action = route.actions[method]
      if (!action) {
        reply(errorResult('method_not_allowed'), { allow: Object.keys(route.actions).join(', ') })
        return
      }

      const limit = bodyLimit(action)
      const read = await readBody(req, limit)
      if (!read.ok) {
        if (read.reason === 'aborted') {
          outcome = 'bad_request'
          status = 400
          res.destroy()
          return
        }
        reply(errorResult('payload_too_large'), { connection: 'close' })
        return
      }
      if (limit > 0 && !isJsonContentType(req.headers['content-type'])) {
        reply(errorResult('unsupported_media_type'))
        return
      }

      if (action === 'health' && isUnsigned(req.headers)) {
        reply(handlers.health(deps))
        return
      }
      const verified = await verifyRequest({
        headers: req.headers,
        method,
        path,
        rawBody: read.body,
        keys: config.keys,
        nowSeconds: now(),
        nonceStore,
      })
      if (!verified.ok) {
        reply({ ...errorResult('unauthorized'), outcome: `unauthorized:${verified.reason}` })
        return
      }
      keyId = verified.keyId

      let body: unknown = undefined
      if (limit > 0) {
        body = parseJson(read.body)
        if (body === undefined) {
          reply(errorResult('bad_request'))
          return
        }
      }
      reply(await run(action, route, body))
    } catch (error) {
      logError(op, sqlState(error) ?? 'unexpected')
      reply(errorResult('internal'))
    } finally {
      logRequest({ op, keyId, outcome, status, ms: Date.now() - started })
    }
  }

  const server = http.createServer((req, res) => {
    void handle(req, res)
  })
  server.requestTimeout = REQUEST_TIMEOUT_MS
  return server
}
