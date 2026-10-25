/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST as connect } from '../connect/route'
import { POST as testConnection } from '../test/route'
import { DELETE as deleteDoc, GET as listDocs } from '../documents/route'
import { CONNECTOR_ERROR_MESSAGES, type ConnectorConfig } from '../../../../lib/connector/shared'
import { openConnectorToken, sealConnectorToken, sealWidgetTokenV3 } from '../../../../lib/connector/token'
import type { OwnerModelConfig } from '../../../../lib/model/shared'
import { STORAGE_TOKEN_HEADER } from '../../../../lib/storage/errors'
import { openPrefixed, sealBuilderToken, sealModelToken } from '../../../../lib/storage/token'
import { SENTINEL, startMockBackend, type MockBackend, type MockDocument } from '../../../../../test/helpers/connector-mock-backend'

// Wrap the shared opener so the test can see whether anything was decrypted.
jest.mock('../../../../lib/storage/token', () => {
  const actual = jest.requireActual('../../../../lib/storage/token')
  return { ...actual, openPrefixed: jest.fn(actual.openPrefixed) }
})
const openSpy = openPrefixed as jest.MockedFunction<typeof openPrefixed>

const TEST_TOKEN_KEY = randomBytes(32)
const CALL_LINE = /^connector call op=(health|search|answer|documents) backend=#[0-9a-f]{8} outcome=[a-z_]+ ms=\d+$/
const MODEL: OwnerModelConfig = { baseUrl: 'https://api.example.com/v1', model: 'm-1', apiKey: 'sk-test-SENTINEL-route-1' }
const CONN = 'postgresql://user:pw@db.example.com:5432/app?sslmode=verify-full'
const SETTINGS = { title: 'Help', welcomeMessage: 'Hi', primaryColor: '#123456', position: 'bottom-right' as const, size: 'small' as const }

const savedEnv = { ...process.env }
let logs: string[] = []
let ipCounter = 0
const backends: MockBackend[] = []

function nextIp(): string {
  ipCounter += 1
  return `connector-route-client-${ipCounter}`
}

function connectRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/connector/connect', {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-real-ip': nextIp(), ...headers }),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function tokenRequest(path: string, method: string, token: string | null, ip = nextIp()): NextRequest {
  const headers: Record<string, string> = { 'x-real-ip': ip }
  if (token !== null) headers[STORAGE_TOKEN_HEADER] = token
  return new NextRequest(`http://localhost${path}`, { method, headers })
}

async function backend(opts: Parameters<typeof startMockBackend>[0] = {}): Promise<MockBackend> {
  const b = await startMockBackend(opts)
  backends.push(b)
  return b
}

interface Connected {
  token: string
  keyId: string
  secret: string
  answer: boolean
  text: string
}

// Connects through the route and installs the issued key on the mock, as the owner would.
async function connectTo(b: MockBackend): Promise<Connected> {
  const res = await connect(connectRequest({ baseUrl: b.baseUrl }))
  expect(res.status).toBe(200)
  const text = await res.text()
  const json = JSON.parse(text) as Connected
  b.options.keyId = json.keyId
  b.options.secret = json.secret
  return { ...json, text }
}

function callLines(): string[] {
  return logs.filter((l) => l.startsWith('connector call '))
}

function otherPurposeTokens(): [string, string][] {
  const connector: ConnectorConfig = {
    baseUrl: 'https://support.example.com',
    keyId: 'ck_0123456789abcdef',
    secret: 'SECRETsentinel_'.padEnd(43, 'A'),
  }
  return [
    ['sbb1_', sealBuilderToken({ conn: CONN, workspaceId: randomUUID() })],
    ['sbm1_', sealModelToken(MODEL)],
    ['sbw3_', sealWidgetTokenV3({ connector, origins: ['https://a.example'], answer: true, settings: SETTINGS })],
  ]
}

function doc(id: string, filename: string, passages: string[]): MockDocument {
  return {
    id,
    filename,
    contentType: 'text/markdown',
    passages: passages.map((text, index) => ({ index, text })),
    createdAt: '2026-01-02T03:04:05.000Z',
  }
}

beforeEach(() => {
  process.env = { ...savedEnv, EMBED_TOKEN_KEY: TEST_TOKEN_KEY.toString('base64'), ALLOW_PRIVATE_CONNECTOR_HOSTS: '1' }
  logs = []
  const capture = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
  jest.spyOn(console, 'log').mockImplementation(capture)
  jest.spyOn(console, 'warn').mockImplementation(capture)
  jest.spyOn(console, 'error').mockImplementation(capture)
  openSpy.mockClear()
})

afterEach(async () => {
  jest.restoreAllMocks()
  await Promise.all(backends.splice(0).map((b) => b.close()))
})

afterAll(() => {
  process.env = savedEnv
})

describe('POST /api/connector/connect', () => {
  it('returns the token, key id and secret once, with no-store, after one unsigned health call', async () => {
    const b = await backend({ capabilities: ['documents', 'search', 'answer'] })
    const res = await connect(connectRequest({ baseUrl: `  ${b.baseUrl}  ` }))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const json = await res.json()
    expect(Object.keys(json).sort()).toEqual(
      ['answer', 'capabilities', 'host', 'keyId', 'secret', 'status', 'token', 'version'].sort(),
    )
    expect(json).toMatchObject({
      status: 'pending',
      host: `127.0.0.1:${b.port}`,
      version: '1',
      capabilities: ['documents', 'search', 'answer'],
      answer: true,
    })
    expect(json.keyId).toMatch(/^ck_[0-9a-f]{16}$/)
    expect(json.secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(json.token).toMatch(/^sbc1_/)
    expect(json.token).not.toContain(json.secret)

    const opened = openConnectorToken(json.token)
    expect(opened).toEqual({ baseUrl: b.baseUrl, keyId: json.keyId, secret: json.secret, answer: true })

    expect(b.requests).toHaveLength(1)
    expect(b.requests[0]).toMatchObject({ method: 'GET', path: '/v1/health', signature: 'unsigned' })

    expect(callLines()).toHaveLength(1)
    expect(callLines()[0]).toMatch(CALL_LINE)
    expect(logs).toContainEqual(expect.stringMatching(/^connector connect outcome=ok backend=#[0-9a-f]{8}$/))
    const joined = logs.join('\n')
    for (const secretish of [json.secret, json.keyId, b.baseUrl]) {
      expect(joined).not.toContain(secretish)
    }
  })

  it('keeps the secret out of every later response and every log line', async () => {
    const b = await backend({ documents: [doc('doc-1', 'faq.md', ['Upload txt, md, pdf or docx.'])] })
    const c = await connectTo(b)
    expect(c.text).toContain(c.secret)

    const tested = await testConnection(tokenRequest('/api/connector/test', 'POST', c.token))
    const testText = await tested.text()
    expect(tested.status).toBe(200)
    const listed = await listDocs(tokenRequest('/api/connector/documents', 'GET', c.token))
    const listText = await listed.text()
    expect(listed.status).toBe(200)
    const deleted = await deleteDoc(tokenRequest('/api/connector/documents?id=doc-1', 'DELETE', c.token))
    const deleteText = await deleted.text()
    expect(deleted.status).toBe(200)

    b.options.secret = 'WRONGsecret_'.padEnd(43, 'B')
    const failed = await testConnection(tokenRequest('/api/connector/test', 'POST', c.token))
    const failedText = await failed.text()
    expect(failed.status).toBe(422)

    for (const text of [testText, listText, deleteText, failedText, logs.join('\n')]) {
      expect(text).not.toContain(c.secret)
      expect(text).not.toContain(SENTINEL)
    }
    expect(logs.join('\n')).not.toContain(c.keyId)
  })

  it('refuses the 6th connect from one IP with 429 and makes no 6th call', async () => {
    const b = await backend()
    const ip = 'connector-rate-limit-ip'
    for (let i = 0; i < 5; i++) {
      const res = await connect(connectRequest({ baseUrl: b.baseUrl }, { 'x-real-ip': ip }))
      expect(res.status).toBe(200)
    }
    const sixth = await connect(connectRequest({ baseUrl: b.baseUrl }, { 'x-real-ip': ip }))
    expect(sixth.status).toBe(429)
    expect((await sixth.json()).code).toBe('connector_rate_limited')
    expect(b.requests).toHaveLength(5)
  })

  it('refuses a body over 8 KB with 400 before any network access', async () => {
    const b = await backend()
    const big = JSON.stringify({ baseUrl: b.baseUrl, pad: 'x'.repeat(9000) })
    const res = await connect(connectRequest(big))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('connector_invalid_request')

    // A streamed body with no content-length is cut off at the cap as well.
    const encoded = new TextEncoder().encode(big)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < encoded.length; at += 1024) controller.enqueue(encoded.slice(at, at + 1024))
        controller.close()
      },
    })
    const streamed = new NextRequest('http://localhost/api/connector/connect', {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json', 'x-real-ip': nextIp() }),
      body: stream,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1] & { duplex: 'half' })
    const streamedRes = await connect(streamed)
    expect(streamedRes.status).toBe(400)
    expect((await streamedRes.json()).code).toBe('connector_invalid_request')

    expect(b.requests).toHaveLength(0)
    expect(callLines()).toHaveLength(0)
  })

  it('refuses unreadable bodies and a non-string baseUrl with connector_invalid_request', async () => {
    for (const body of ['not json', '[]', { baseUrl: 42 }, {}]) {
      const res = await connect(connectRequest(body))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('connector_invalid_request')
    }
  })

  it('refuses a private address with the flag unset, and the backend sees no request', async () => {
    delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
    const b = await backend()

    const plain = await connect(connectRequest({ baseUrl: b.baseUrl }))
    expect(plain.status).toBe(400)
    expect((await plain.json()).code).toBe('connector_address_blocked')

    const tls = await connect(connectRequest({ baseUrl: `https://127.0.0.1:${b.port}` }))
    expect(tls.status).toBe(400)
    expect((await tls.json()).code).toBe('connector_address_blocked')

    const junk = await connect(connectRequest({ baseUrl: 'not a url' }))
    expect(junk.status).toBe(400)
    expect((await junk.json()).code).toBe('connector_invalid_url')

    expect(b.requests).toHaveLength(0)
    expect(callLines()).toHaveLength(0)
  })

  it('refuses another API version and missing capabilities with fixed 422 codes', async () => {
    const v2 = await backend({ version: '2' })
    const r1 = await connect(connectRequest({ baseUrl: v2.baseUrl }))
    expect(r1.status).toBe(422)
    expect(await r1.json()).toEqual({
      error: CONNECTOR_ERROR_MESSAGES.connector_version_unsupported,
      code: 'connector_version_unsupported',
      details: CONNECTOR_ERROR_MESSAGES.connector_version_unsupported,
    })

    const noSearch = await backend({ capabilities: ['documents'] })
    const r2 = await connect(connectRequest({ baseUrl: noSearch.baseUrl }))
    expect(r2.status).toBe(422)
    expect((await r2.json()).code).toBe('connector_capability_missing')
    expect(logs).toContainEqual(expect.stringMatching(/^connector connect outcome=connector_capability_missing backend=#[0-9a-f]{8}$/))
  })

  it('maps a failing health call without echoing the backend body or headers', async () => {
    const b = await backend({
      overrides: { 'GET /v1/health': { status: 500, headers: { 'x-sentinel': SENTINEL }, body: { error: { code: SENTINEL } } } },
    })
    const res = await connect(connectRequest({ baseUrl: b.baseUrl }))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text).code).toBe('connector_http_error')
    expect(JSON.parse(text).details).toBe('Your backend returned an error (HTTP 500).')
    expect(res.headers.get('x-sentinel')).toBeNull()
    expect(text).not.toContain(SENTINEL)
    expect(logs.join('\n')).not.toContain(SENTINEL)
    expect(callLines()).toHaveLength(1)
  })

  it('returns 503 connector_unavailable without EMBED_TOKEN_KEY, before any network access', async () => {
    delete process.env.EMBED_TOKEN_KEY
    const b = await backend()
    const res = await connect(connectRequest({ baseUrl: b.baseUrl }))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('connector_unavailable')
    expect(b.requests).toHaveLength(0)
  })

  it.each(['sbm1_', 'sbw3_'])('refuses a %s token in x-storage-token with 403 before decrypting', async (prefix) => {
    const b = await backend()
    const token = otherPurposeTokens().find(([p]) => p === prefix)![1]
    openSpy.mockClear()
    const res = await connect(connectRequest({ baseUrl: b.baseUrl }, { [STORAGE_TOKEN_HEADER]: token }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('connector_token_wrong_purpose')
    expect(openSpy).not.toHaveBeenCalled()
    expect(b.requests).toHaveLength(0)
  })
})

describe('POST /api/connector/test', () => {
  it('runs a signed health and search, and re-seals the token with the fresh answer flag', async () => {
    const b = await backend({ capabilities: ['documents', 'search'] })
    const c = await connectTo(b)
    expect(c.answer).toBe(false)
    b.options.capabilities = ['documents', 'search', 'answer']
    b.options.searchResults = [{ documentId: 'doc-1', filename: 'faq.md', text: 'connection test passage', score: 0.5 }]
    logs = []

    const res = await testConnection(tokenRequest('/api/connector/test', 'POST', c.token))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const json = await res.json()
    expect(Object.keys(json).sort()).toEqual(['answer', 'capabilities', 'ok', 'passagesReturned', 'token', 'version'].sort())
    expect(json).toMatchObject({ ok: true, version: '1', capabilities: ['documents', 'search', 'answer'], answer: true, passagesReturned: 1 })

    const signed = b.requests.slice(1)
    expect(signed.map((r) => `${r.method} ${r.path} ${r.signature}`)).toEqual([
      'GET /v1/health valid',
      'POST /v1/search valid',
    ])
    expect(JSON.parse(signed[1].body)).toEqual({ query: 'connection test', topK: 1 })

    expect(json.token).not.toBe(c.token)
    expect(openConnectorToken(json.token)).toEqual({ baseUrl: b.baseUrl, keyId: c.keyId, secret: c.secret, answer: true })

    expect(callLines()).toHaveLength(2)
    for (const line of callLines()) expect(line).toMatch(CALL_LINE)
  })

  it('reports connector_auth_rejected at stage health when the backend has another secret', async () => {
    const b = await backend()
    const c = await connectTo(b)
    b.options.secret = 'WRONGsecret_'.padEnd(43, 'B')

    const res = await testConnection(tokenRequest('/api/connector/test', 'POST', c.token))
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      error: CONNECTOR_ERROR_MESSAGES.connector_auth_rejected,
      code: 'connector_auth_rejected',
      details: CONNECTOR_ERROR_MESSAGES.connector_auth_rejected,
      stage: 'health',
    })
    expect(b.requests.filter((r) => r.path === '/v1/search')).toHaveLength(0)
  })

  it('reports a search failure at stage search without echoing the backend', async () => {
    const b = await backend({
      overrides: { 'POST /v1/search': { status: 500, headers: { 'x-sentinel': SENTINEL }, body: `{"error":"${SENTINEL}"}` } },
    })
    const c = await connectTo(b)
    logs = []

    const res = await testConnection(tokenRequest('/api/connector/test', 'POST', c.token))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ code: 'connector_http_error', stage: 'search' })
    expect(text).not.toContain(SENTINEL)
    expect(logs.join('\n')).not.toContain(SENTINEL)
    expect(callLines()).toHaveLength(2)
  })

  it('returns 401 connector_token_invalid without a token and for a tampered one', async () => {
    const missing = await testConnection(tokenRequest('/api/connector/test', 'POST', null))
    expect(missing.status).toBe(401)
    expect((await missing.json()).code).toBe('connector_token_invalid')

    const token = sealConnectorToken({ baseUrl: 'https://support.example.com', keyId: 'ck_0123456789abcdef', secret: 'A'.repeat(43), answer: false })
    const tampered = token.slice(0, 20) + (token[20] === 'A' ? 'B' : 'A') + token.slice(21)
    const res = await testConnection(tokenRequest('/api/connector/test', 'POST', tampered))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('connector_token_invalid')
  })

  it('refuses a token for a private address once the flag is unset, with no request', async () => {
    const b = await backend()
    const c = await connectTo(b)
    delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
    const res = await testConnection(tokenRequest('/api/connector/test', 'POST', c.token))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('connector_address_blocked')
    expect(b.requests).toHaveLength(1)
  })

  it('limits to 10 per minute per IP', async () => {
    const ip = 'connector-test-rate-ip'
    for (let i = 0; i < 10; i++) {
      const res = await testConnection(tokenRequest('/api/connector/test', 'POST', null, ip))
      expect(res.status).toBe(401)
    }
    const res = await testConnection(tokenRequest('/api/connector/test', 'POST', null, ip))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('connector_rate_limited')
  })
})

describe('/api/connector/documents', () => {
  it('lists documents as id, filename, passageCount and createdAt', async () => {
    const b = await backend({
      documents: [doc('doc-1', 'faq.md', ['a', 'b']), doc('doc-2', 'terms.txt', ['c'])],
    })
    const c = await connectTo(b)
    logs = []

    const res = await listDocs(tokenRequest('/api/connector/documents', 'GET', c.token))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      documents: [
        { id: 'doc-1', filename: 'faq.md', passageCount: 2, createdAt: '2026-01-02T03:04:05.000Z' },
        { id: 'doc-2', filename: 'terms.txt', passageCount: 1, createdAt: '2026-01-02T03:04:05.000Z' },
      ],
    })
    const last = b.requests[b.requests.length - 1]
    expect(last).toMatchObject({ method: 'GET', path: '/v1/documents', signature: 'valid' })
    expect(callLines()).toEqual([expect.stringMatching(CALL_LINE)])
  })

  it('deletes by id, then maps a 404 to connector_document_not_found', async () => {
    const b = await backend({ documents: [doc('doc-1', 'faq.md', ['a'])] })
    const c = await connectTo(b)

    const res = await deleteDoc(tokenRequest('/api/connector/documents?id=doc-1', 'DELETE', c.token))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true })
    expect(b.documents).toHaveLength(0)
    expect(b.requests[b.requests.length - 1]).toMatchObject({ method: 'DELETE', path: '/v1/documents/doc-1', signature: 'valid' })

    const again = await deleteDoc(tokenRequest('/api/connector/documents?id=doc-1', 'DELETE', c.token))
    expect(again.status).toBe(404)
    const text = await again.text()
    expect(JSON.parse(text).code).toBe('connector_document_not_found')
    expect(text).not.toContain(SENTINEL)
    expect(logs.join('\n')).not.toContain(SENTINEL)
  })

  it('refuses a missing or malformed id with 400 before any request', async () => {
    const b = await backend()
    const c = await connectTo(b)
    const before = b.requests.length
    for (const query of ['', '?id=', '?id=..%2Fhealth', '?id=a%20b', `?id=${'a'.repeat(129)}`]) {
      const res = await deleteDoc(tokenRequest(`/api/connector/documents${query}`, 'DELETE', c.token))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('connector_invalid_request')
    }
    expect(b.requests).toHaveLength(before)
  })

  it('maps a list failure without echoing the backend', async () => {
    const b = await backend({
      overrides: { 'GET /v1/documents': { status: 503, headers: { 'x-sentinel': SENTINEL }, body: SENTINEL } },
    })
    const c = await connectTo(b)
    const res = await listDocs(tokenRequest('/api/connector/documents', 'GET', c.token))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(JSON.parse(text).details).toBe('Your backend returned an error (HTTP 503).')
    expect(text).not.toContain(SENTINEL)
    expect(logs.join('\n')).not.toContain(SENTINEL)
  })

  it('limits GET and DELETE together to 30 per minute per IP', async () => {
    const ip = 'connector-docs-rate-ip'
    for (let i = 0; i < 30; i++) {
      const handler = i % 2 === 0 ? listDocs : deleteDoc
      const res = await handler(tokenRequest('/api/connector/documents?id=x', i % 2 === 0 ? 'GET' : 'DELETE', null, ip))
      expect(res.status).toBe(401)
    }
    const res = await listDocs(tokenRequest('/api/connector/documents', 'GET', null, ip))
    expect(res.status).toBe(429)
  })

  it('returns 503 without EMBED_TOKEN_KEY', async () => {
    const token = sealConnectorToken({ baseUrl: 'https://support.example.com', keyId: 'ck_0123456789abcdef', secret: 'A'.repeat(43), answer: false })
    delete process.env.EMBED_TOKEN_KEY
    const res = await listDocs(tokenRequest('/api/connector/documents', 'GET', token))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('connector_unavailable')
  })
})

describe('purpose binding on test and documents', () => {
  const routes: [string, (r: NextRequest) => Promise<Response>, string, string][] = [
    ['test', testConnection, '/api/connector/test', 'POST'],
    ['documents GET', listDocs, '/api/connector/documents', 'GET'],
    ['documents DELETE', deleteDoc, '/api/connector/documents?id=doc-1', 'DELETE'],
  ]

  it.each(routes)('%s refuses sbb1_, sbm1_ and sbw3_ with 403 before decrypting', async (_name, handler, path, method) => {
    for (const [, token] of otherPurposeTokens()) {
      openSpy.mockClear()
      const res = await handler(tokenRequest(path, method, token))
      expect(res.status).toBe(403)
      expect((await res.json()).code).toBe('connector_token_wrong_purpose')
      expect(openSpy).not.toHaveBeenCalled()
    }
    expect(callLines()).toHaveLength(0)
  })
})
