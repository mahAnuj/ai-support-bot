import { randomBytes } from 'node:crypto'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import { parseConfig, type Env } from '../../src/config.js'
import type { AnswerModel } from '../../src/model.js'
import { MemoryNonceStore, type NonceStore } from '../../src/nonce-store.js'
import { createServer } from '../../src/server.js'
import { signRequestHeaders } from '../../src/signing.js'
import { FakeEmbedder } from './fake-embedder.js'
import { MemoryStore } from './memory-store.js'

export const KEY_ID = 'ck_0123456789abcdef'
export const SECRET = 'S3cr3tS3cr3tS3cr3tS3cr3tS3cr3tS3cr3tS3cr3tA'
export const DB_URL = 'postgres://user:pw@127.0.0.1:1/unused'

export interface Response {
  status: number
  headers: http.IncomingHttpHeaders
  text: string
  json: any
}

export interface RequestOptions {
  method: string
  path: string
  body?: string | Buffer
  headers?: Record<string, string>
}

export function send(port: number, opts: RequestOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    const body = opts.body === undefined ? undefined : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(opts.body, 'utf8')
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        agent: false,
        headers: { ...(body ? { 'content-length': String(body.length) } : {}), ...(opts.headers ?? {}) },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let json: unknown = undefined
          try {
            json = JSON.parse(text)
          } catch {
            json = undefined
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json })
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export interface SignedOptions {
  method: string
  path: string
  body?: string
  keyId?: string
  secret?: string
  timestamp?: string
  nonce?: string
  contentType?: string | null
  /** Path prefix sent on the wire but not signed (a mount prefix). */
  prefix?: string
}

export function signed(port: number, opts: SignedOptions): Promise<Response> {
  const body = opts.body ?? ''
  const headers = signRequestHeaders({
    keyId: opts.keyId ?? KEY_ID,
    secret: opts.secret ?? SECRET,
    method: opts.method,
    path: opts.path,
    body,
    timestamp: opts.timestamp ?? String(nowSeconds()),
    nonce: opts.nonce ?? randomBytes(16).toString('base64url'),
  })
  const contentType = opts.contentType === undefined ? (body ? 'application/json' : null) : opts.contentType
  return send(port, {
    method: opts.method,
    path: `${opts.prefix ?? ''}${opts.path}`,
    body: body === '' ? undefined : body,
    headers: { ...headers, ...(contentType ? { 'content-type': contentType } : {}) },
  })
}

export interface TestServer {
  port: number
  store: MemoryStore
  embedder: FakeEmbedder
  nonceStore: NonceStore
  close(): Promise<void>
}

export interface StartOptions {
  env?: Env
  model?: AnswerModel | null
  nonceStore?: NonceStore
  store?: MemoryStore
  now?: () => number
}

export async function startServer(opts: StartOptions = {}): Promise<TestServer> {
  const config = parseConfig({ DATABASE_URL: DB_URL, CONNECTOR_KEYS: `${KEY_ID}:${SECRET}`, ...(opts.env ?? {}) })
  const store = opts.store ?? new MemoryStore()
  const embedder = new FakeEmbedder()
  const nonceStore = opts.nonceStore ?? new MemoryNonceStore()
  const server = createServer({ config, store, embedder, nonceStore, model: opts.model, now: opts.now })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    port: (server.address() as AddressInfo).port,
    store,
    embedder,
    nonceStore,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
