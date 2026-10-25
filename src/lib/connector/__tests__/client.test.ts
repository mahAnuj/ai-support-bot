/** @jest-environment node */
import * as http from 'node:http'
import * as dns from 'node:dns'
import type { AddressInfo } from 'node:net'
import {
  assertCapabilities,
  buildDocumentPayload,
  checkConnectorBaseUrl,
  createDocument,
  deleteDocument,
  getHealth,
  getHealthUnsigned,
  isPrivateConnectorHostAllowed,
  listDocuments,
  requestAnswer,
  searchPassages,
} from '../client'
import {
  CONNECTOR_ERROR_STATUS,
  ConnectorError,
  connectorErrorMessage,
  connectorStatus,
  isConnectorError,
  type ConnectorConfig,
  type ConnectorErrorCode,
} from '../shared'
import { bodySha256Hex, canonicalString, signCanonical } from '../signing'
import { connectorLabel } from '../log'
import { SENTINEL, startMockBackend, type MockBackend, type MockBackendOptions } from '../../../../test/helpers/connector-mock-backend'

// Probe hostnames resolve to fixed addresses; anything else fails, so nothing reaches the network.
jest.mock('node:dns', () => {
  const actual = jest.requireActual<typeof import('node:dns')>('node:dns')
  return { ...actual, lookup: jest.fn() }
})
const FAKE_DNS: Record<string, { address: string; family: number }[]> = {
  '127.0.0.1.nip.io': [{ address: '127.0.0.1', family: 4 }],
  '169.254.169.254.nip.io': [{ address: '169.254.169.254', family: 4 }],
  'localtest.me': [{ address: '127.0.0.1', family: 4 }],
}
const lookupMock = dns.lookup as unknown as jest.Mock

const KEY_ID = 'ck_0123456789abcdef'
const SECRET = 'SECRETsentinel_'.padEnd(43, 'A')
const QUESTION = 'QUESTION-SENTINEL-71c2 what file types can I upload?'
const PATH_SENTINEL = '/pathsentinel-q9z4'
const LOG_LINE = /^connector call op=(health|search|answer|documents) backend=#[0-9a-f]{8} outcome=[a-z_]+ ms=\d+$/

let savedFlag: string | undefined
let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance
let warnSpy: jest.SpyInstance
const mocks: MockBackend[] = []

function consoleText(): string {
  return [logSpy, errorSpy, warnSpy].flatMap((s) => s.mock.calls.map((args: unknown[]) => args.map(String).join(' '))).join('\n')
}

function callLogLines(): string[] {
  return logSpy.mock.calls.map((args: unknown[]) => args.map(String).join(' ')).filter((l) => l.startsWith('connector call'))
}

async function mock(opts: MockBackendOptions = {}): Promise<MockBackend> {
  const m = await startMockBackend({ keyId: KEY_ID, secret: SECRET, ...opts })
  mocks.push(m)
  return m
}

function configFor(m: MockBackend, overrides: Partial<ConnectorConfig> = {}): ConnectorConfig {
  return { baseUrl: m.baseUrl, keyId: KEY_ID, secret: SECRET, ...overrides }
}

async function codeOf(p: Promise<unknown>): Promise<{ code: ConnectorErrorCode; error: ConnectorError }> {
  try {
    await p
  } catch (e) {
    if (!isConnectorError(e)) throw e
    return { code: e.code, error: e }
  }
  throw new Error('expected a ConnectorError')
}

const PASSAGE = { documentId: 'doc-1', filename: 'faq.md', text: 'You can upload PDF, DOCX, TXT and MD files.', score: 0.62 }

beforeEach(() => {
  savedFlag = process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
  process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS = '1'
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  lookupMock.mockReset()
  lookupMock.mockImplementation((host: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
    const answer = FAKE_DNS[host]
    if (!answer) {
      const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
      process.nextTick(() => cb(err))
      return
    }
    process.nextTick(() => cb(null, answer))
  })
})

afterEach(async () => {
  if (savedFlag === undefined) delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
  else process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS = savedFlag
  logSpy.mockRestore()
  errorSpy.mockRestore()
  warnSpy.mockRestore()
  await Promise.all(mocks.splice(0).map((m) => m.close()))
})

describe('shared', () => {
  it('builds the HTTP status message from an integer status only', () => {
    expect(connectorErrorMessage('connector_http_error', 500)).toBe('Your backend returned an error (HTTP 500).')
    expect(connectorErrorMessage('connector_http_error', '500<b>')).toBe('Your backend returned an error.')
    expect(connectorErrorMessage('connector_http_error', 500.5)).toBe('Your backend returned an error.')
    expect(connectorErrorMessage('nope')).toBe('Your backend returned an error.')
    expect(connectorErrorMessage('connector_timeout')).toBe("Your backend didn't answer in time.")
    expect(connectorStatus('Your backend returned an error (HTTP 502).')).toBe(502)
    expect(connectorStatus('Your backend returned an error.')).toBeUndefined()
    expect(connectorStatus(42)).toBeUndefined()
  })

  it('ConnectorError message is the code only, and only http_error keeps a status', () => {
    const err = new ConnectorError('connector_http_error', 503)
    expect(err.message).toBe('connector_http_error')
    expect(err.httpStatus).toBe(503)
    expect(new ConnectorError('connector_timeout', 503).httpStatus).toBeUndefined()
    expect(CONNECTOR_ERROR_STATUS[err.code]).toBe(502)
    expect(CONNECTOR_ERROR_STATUS.connector_timeout).toBe(504)
  })
})

describe('isPrivateConnectorHostAllowed / checkConnectorBaseUrl', () => {
  it('reads its own flag from the env passed in', () => {
    expect(isPrivateConnectorHostAllowed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isPrivateConnectorHostAllowed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isPrivateConnectorHostAllowed({ NODE_ENV: 'production', ALLOW_PRIVATE_CONNECTOR_HOSTS: '1' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isPrivateConnectorHostAllowed({ NODE_ENV: 'test', ALLOW_PRIVATE_CONNECTOR_HOSTS: 'true' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isPrivateConnectorHostAllowed({ NODE_ENV: 'test', ALLOW_PRIVATE_MODEL_HOSTS: '1' } as NodeJS.ProcessEnv)).toBe(false)
  })

  it('maps guard codes to connector codes', () => {
    expect(checkConnectorBaseUrl('not a url', { allowPrivate: false })).toEqual({ ok: false, code: 'connector_invalid_url' })
    expect(checkConnectorBaseUrl('https://a.example/' + 'x'.repeat(500), { allowPrivate: false })).toEqual({
      ok: false,
      code: 'connector_url_too_long',
    })
    expect(checkConnectorBaseUrl('ftp://a.example', { allowPrivate: false })).toEqual({ ok: false, code: 'connector_https_required' })
    expect(checkConnectorBaseUrl('https://10.0.0.1', { allowPrivate: false })).toEqual({ ok: false, code: 'connector_address_blocked' })
    expect(checkConnectorBaseUrl('https://Support.Example.com/api/', { allowPrivate: false })).toEqual({
      ok: true,
      baseUrl: 'https://support.example.com/api',
      host: 'support.example.com',
      protocol: 'https:',
    })
  })

  it('uses the live flag when no option is given', () => {
    delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
    expect(checkConnectorBaseUrl('http://127.0.0.1:8080')).toEqual({ ok: false, code: 'connector_address_blocked' })
    process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS = '1'
    expect(checkConnectorBaseUrl('http://127.0.0.1:8080')).toMatchObject({ ok: true })
  })
})

describe('assertCapabilities', () => {
  it('accepts v1 with documents and search, ignores unknown strings and reads answer', () => {
    expect(assertCapabilities({ version: '1', capabilities: ['search', 'x-extra', 'documents'] })).toEqual({
      version: '1',
      capabilities: ['documents', 'search'],
      answer: false,
    })
    expect(assertCapabilities({ version: '1', capabilities: ['documents', 'search', 'answer'] }).answer).toBe(true)
  })

  it('refuses another version or a missing required capability', () => {
    expect(() => assertCapabilities({ version: '2', capabilities: ['documents', 'search'] })).toThrow('connector_version_unsupported')
    expect(() => assertCapabilities({ version: '1', capabilities: ['documents', 'answer'] })).toThrow('connector_capability_missing')
    expect(() => assertCapabilities({ version: '1', capabilities: ['search'] })).toThrow('connector_capability_missing')
  })
})

describe('signed calls against the mock backend', () => {
  it('every op succeeds with headers the mock verifies', async () => {
    const m = await mock({ capabilities: ['documents', 'search', 'answer'], answer: { message: 'Hi.', sources: ['faq.md'] } })
    const config = configFor(m)

    expect(await getHealthUnsigned(m.baseUrl)).toEqual({ version: '1', capabilities: ['documents', 'search', 'answer'] })
    expect(await getHealth(config)).toEqual({ version: '1', capabilities: ['documents', 'search', 'answer'] })

    const payload = buildDocumentPayload('faq.md', [{ content: 'You can upload PDF files.', index: 0 }], '.md')
    const created = await createDocument(config, payload)
    expect(created).toMatchObject({ filename: 'faq.md', passageCount: 1 })

    const listed = await listDocuments(config)
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({ id: created.id, filename: 'faq.md', contentType: 'text/markdown', passageCount: 1 })

    const passages = await searchPassages(config, 'upload PDF', 5)
    expect(passages).toHaveLength(1)
    expect(passages[0]).toMatchObject({ documentId: created.id, filename: 'faq.md' })

    expect(await requestAnswer(config, { question: 'upload?', passages, systemPrompt: null })).toEqual({
      message: 'Hi.',
      sources: ['faq.md'],
    })
    expect(await deleteDocument(config, created.id)).toEqual({ deleted: true })

    expect(m.requests.map((r) => `${r.method} ${r.path} ${r.signature}`)).toEqual([
      'GET /v1/health unsigned',
      'GET /v1/health valid',
      'POST /v1/documents valid',
      'GET /v1/documents valid',
      'POST /v1/search valid',
      'POST /v1/answer valid',
      `DELETE /v1/documents/${created.id} valid`,
    ])
    for (const r of m.requests) {
      expect(r.headers['user-agent']).toBe('ai-support-bot-connector-client/1')
      expect(r.headers['accept-encoding']).toBe('identity')
      expect(r.headers.accept).toBe('application/json')
      if (r.method === 'POST') {
        expect(r.headers['content-type']).toBe('application/json')
        expect(r.headers['content-length']).toBe(String(Buffer.byteLength(r.body)))
      } else {
        expect(r.headers['content-type']).toBeUndefined()
        expect(r.body).toBe('')
      }
    }
    expect(JSON.parse(m.requests[5].body)).toEqual({ question: 'upload?', passages, systemPrompt: null })
    expect(JSON.parse(m.requests[4].body)).toEqual({ query: 'upload PDF', topK: 5 })
  })

  it('signs the API path only, not the base URL path prefix', async () => {
    const m = await mock({ basePath: '/prefix' })
    const config = configFor(m)
    expect(m.baseUrl.endsWith('/prefix')).toBe(true)
    await getHealth(config)
    await searchPassages(config, 'anything', 1)
    expect(m.requests.map((r) => [r.path, r.signature])).toEqual([
      ['/prefix/v1/health', 'valid'],
      ['/prefix/v1/search', 'valid'],
    ])
    const r = m.requests[1]
    const withPrefix = signCanonical(
      SECRET,
      canonicalString({
        method: 'POST',
        path: '/prefix/v1/search',
        timestamp: String(r.headers['x-connector-timestamp']),
        nonce: String(r.headers['x-connector-nonce']),
        bodySha256: bodySha256Hex(r.body),
      }),
    )
    expect(r.headers['x-connector-signature']).not.toBe(withPrefix)
  })

  it('a wrong secret is refused by the backend as connector_auth_rejected', async () => {
    const m = await mock()
    const { code } = await codeOf(getHealth(configFor(m, { secret: 'B'.repeat(43) })))
    expect(code).toBe('connector_auth_rejected')
    expect(m.requests[0].signature).toBe('invalid')
  })
})

describe('HTTP status mapping', () => {
  it('a 3xx is not followed', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const m = await mock()
      m.options.overrides = { 'GET /v1/health': { status, redirect: `${m.baseUrl}/v1/elsewhere` } }
      const { code, error } = await codeOf(getHealthUnsigned(m.baseUrl))
      expect(code).toBe('connector_redirect')
      expect(error.httpStatus).toBeUndefined()
      expect(m.requests).toHaveLength(1)
    }
  })

  it.each([
    [401, 'connector_auth_rejected', undefined],
    [403, 'connector_auth_rejected', undefined],
    [404, 'connector_not_found', undefined],
    [413, 'connector_http_error', 413],
    [429, 'connector_http_error', 429],
    [500, 'connector_http_error', 500],
    [502, 'connector_http_error', 502],
  ] as const)('search %i -> %s', async (status, expected, httpStatus) => {
    const m = await mock({ overrides: { 'POST /v1/search': { status } } })
    const { code, error } = await codeOf(searchPassages(configFor(m), 'x', 5))
    expect(code).toBe(expected)
    expect(error.httpStatus).toBe(httpStatus)
  })

  it('404 on DELETE is connector_document_not_found', async () => {
    const m = await mock()
    expect((await codeOf(deleteDocument(configFor(m), 'missing-id'))).code).toBe('connector_document_not_found')
  })

  it('404 on the document list is connector_not_found', async () => {
    const m = await mock({ overrides: { 'GET /v1/documents': { status: 404 } } })
    expect((await codeOf(listDocuments(configFor(m)))).code).toBe('connector_not_found')
  })

  it('413 on the documents POST is connector_document_too_large', async () => {
    const m = await mock({ overrides: { 'POST /v1/documents': { status: 413 } } })
    const payload = buildDocumentPayload('a.txt', [{ content: 'x', index: 0 }], 'txt')
    expect((await codeOf(createDocument(configFor(m), payload))).code).toBe('connector_document_too_large')
  })
})

describe('timeouts', () => {
  const slow = { delayMs: 400, body: {} }
  it.each([
    ['health', (c: ConnectorConfig) => getHealth(c, { timeoutMs: 50 })],
    ['health (unsigned)', (c: ConnectorConfig) => getHealthUnsigned(c.baseUrl, { timeoutMs: 50 })],
    ['search', (c: ConnectorConfig) => searchPassages(c, 'x', 5, { timeoutMs: 50 })],
    ['answer', (c: ConnectorConfig) => requestAnswer(c, { question: 'x', passages: [], systemPrompt: null }, { timeoutMs: 50 })],
    [
      'documents POST',
      (c: ConnectorConfig) =>
        createDocument(c, buildDocumentPayload('a.txt', [{ content: 'x', index: 0 }], 'txt'), { timeoutMs: 50 }),
    ],
    ['documents GET', (c: ConnectorConfig) => listDocuments(c, { timeoutMs: 50 })],
    ['documents DELETE', (c: ConnectorConfig) => deleteDocument(c, 'abc', { timeoutMs: 50 })],
  ] as const)('%s -> connector_timeout', async (_name, call) => {
    const m = await mock({
      overrides: {
        '/v1/health': slow,
        '/v1/search': slow,
        '/v1/answer': slow,
        '/v1/documents': slow,
        '/v1/documents/abc': slow,
      },
    })
    const started = Date.now()
    expect((await codeOf(call(configFor(m)))).code).toBe('connector_timeout')
    expect(Date.now() - started).toBeLessThan(350)
  })
})

describe('response bounds and shapes', () => {
  it('a response over 1 MB is connector_bad_response', async () => {
    const m = await mock({ overrides: { 'POST /v1/search': { hugeBodyBytes: 1_048_576 + 128 * 1024 } } })
    expect((await codeOf(searchPassages(configFor(m), 'x', 5))).code).toBe('connector_bad_response')
  })

  it('invalid JSON is connector_bad_response', async () => {
    const m = await mock({ overrides: { 'GET /v1/health': { body: `not json ${SENTINEL}` } } })
    expect((await codeOf(getHealthUnsigned(m.baseUrl))).code).toBe('connector_bad_response')
  })

  const tooLong = 'x'.repeat(10_001)
  it.each([
    ['health: numeric version', 'GET /v1/health', { version: 1, capabilities: ['documents', 'search'] }],
    ['health: capabilities not an array', 'GET /v1/health', { version: '1', capabilities: 'documents,search' }],
    ['health: array body', 'GET /v1/health', []],
    ['search: more than topK', 'POST /v1/search', { passages: [PASSAGE, PASSAGE] }],
    ['search: score above 1', 'POST /v1/search', { passages: [{ ...PASSAGE, score: 1.5 }] }],
    ['search: score below -1', 'POST /v1/search', { passages: [{ ...PASSAGE, score: -1.01 }] }],
    ['search: score as string', 'POST /v1/search', { passages: [{ ...PASSAGE, score: '0.5' }] }],
    ['search: bad document id', 'POST /v1/search', { passages: [{ ...PASSAGE, documentId: 'a/b' }] }],
    ['search: text too long', 'POST /v1/search', { passages: [{ ...PASSAGE, text: tooLong }] }],
    ['search: empty filename', 'POST /v1/search', { passages: [{ ...PASSAGE, filename: '' }] }],
    ['search: missing passages', 'POST /v1/search', { results: [] }],
    ['answer: empty message', 'POST /v1/answer', { message: '', sources: [] }],
    ['answer: message too long', 'POST /v1/answer', { message: 'x'.repeat(20_001), sources: [] }],
    ['answer: too many sources', 'POST /v1/answer', { message: 'ok', sources: Array(11).fill('a.md') }],
    ['answer: source not a string', 'POST /v1/answer', { message: 'ok', sources: [1] }],
    ['list: bad createdAt', 'GET /v1/documents', { documents: [{ id: 'a', filename: 'f', contentType: 'text/plain', passageCount: 1, createdAt: 'yesterday' }] }],
    ['list: negative passageCount', 'GET /v1/documents', { documents: [{ id: 'a', filename: 'f', contentType: 'text/plain', passageCount: -1, createdAt: '2026-01-01T00:00:00Z' }] }],
    ['list: not an array', 'GET /v1/documents', { documents: {} }],
    ['create: bad id', 'POST /v1/documents', { id: 'a b', filename: 'a.txt', passageCount: 1 }],
    ['delete: deleted false', 'DELETE /v1/documents/abc', { deleted: false }],
  ] as const)('%s -> connector_bad_response', async (_name, key, body) => {
    const m = await mock({ capabilities: ['documents', 'search', 'answer'], overrides: { [key]: { body } } })
    const config = configFor(m)
    const call: Record<string, () => Promise<unknown>> = {
      'GET /v1/health': () => getHealth(config),
      'POST /v1/search': () => searchPassages(config, 'x', 1),
      'POST /v1/answer': () => requestAnswer(config, { question: 'x', passages: [], systemPrompt: null }),
      'GET /v1/documents': () => listDocuments(config),
      'POST /v1/documents': () => createDocument(config, buildDocumentPayload('a.txt', [{ content: 'x', index: 0 }], 'txt')),
      'DELETE /v1/documents/abc': () => deleteDocument(config, 'abc'),
    }
    expect((await codeOf(call[key]())).code).toBe('connector_bad_response')
  })

  it('refuses bad input before any request', async () => {
    const m = await mock()
    const config = configFor(m)
    expect((await codeOf(searchPassages(config, '', 5))).code).toBe('connector_invalid_request')
    expect((await codeOf(searchPassages(config, 'x'.repeat(2001), 5))).code).toBe('connector_invalid_request')
    expect((await codeOf(searchPassages(config, 'x', 11))).code).toBe('connector_invalid_request')
    expect((await codeOf(searchPassages(config, 'x', 0))).code).toBe('connector_invalid_request')
    expect((await codeOf(requestAnswer(config, { question: 'x', passages: Array(11).fill(PASSAGE), systemPrompt: null }))).code).toBe(
      'connector_invalid_request',
    )
    expect((await codeOf(requestAnswer(config, { question: 'x', passages: [], systemPrompt: 'x'.repeat(4001) }))).code).toBe(
      'connector_invalid_request',
    )
    expect((await codeOf(deleteDocument(config, '../etc'))).code).toBe('connector_invalid_request')
    expect((await codeOf(deleteDocument(config, 'a?b=1'))).code).toBe('connector_invalid_request')
    expect(m.requests).toHaveLength(0)
  })
})

describe('transport failures and the address guard', () => {
  it('a closed port is connector_unreachable', async () => {
    const server = http.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect((await codeOf(getHealthUnsigned(`http://127.0.0.1:${port}`))).code).toBe('connector_unreachable')
  })

  it('a token-style config on http://127.0.0.1 is refused when the flag is unset', async () => {
    const m = await mock()
    delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
    expect((await codeOf(getHealth(configFor(m)))).code).toBe('connector_address_blocked')
    expect((await codeOf(searchPassages(configFor(m), 'x', 5))).code).toBe('connector_address_blocked')
    expect(m.requests).toHaveLength(0)
  })

  // 21 of the 22 QA probes are refused as blocked or https-required; the zone-id literal fails URL parsing.
  it.each([
    ['https://127.0.0.1', 'connector_address_blocked'],
    ['https://127.1.2.3', 'connector_address_blocked'],
    ['https://169.254.169.254', 'connector_address_blocked'],
    ['https://10.0.0.1', 'connector_address_blocked'],
    ['https://192.168.1.1', 'connector_address_blocked'],
    ['https://172.16.0.1', 'connector_address_blocked'],
    ['https://100.64.0.1', 'connector_address_blocked'],
    ['https://0.0.0.0', 'connector_address_blocked'],
    ['https://2130706433', 'connector_address_blocked'],
    ['https://0x7f000001', 'connector_address_blocked'],
    ['https://0177.0.0.1', 'connector_address_blocked'],
    ['https://[::1]', 'connector_address_blocked'],
    ['https://[::ffff:127.0.0.1]', 'connector_address_blocked'],
    ['https://[64:ff9b::a9fe:a9fe]', 'connector_address_blocked'],
    ['https://[2002:a9fe:a9fe::]', 'connector_address_blocked'],
    ['https://[fe80::1%25en0]', 'connector_invalid_url'],
    ['https://localhost', 'connector_address_blocked'],
    ['https://api.localhost', 'connector_address_blocked'],
    ['https://127.0.0.1.nip.io', 'connector_address_blocked'],
    ['https://169.254.169.254.nip.io', 'connector_address_blocked'],
    ['https://localtest.me', 'connector_address_blocked'],
    ['http://93.184.216.34', 'connector_https_required'],
  ] as const)('probe %s -> %s with the flag unset', async (url, expected) => {
    delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
    const { code } = await codeOf(getHealthUnsigned(url))
    expect(code).toBe(expected)
    expect(CONNECTOR_ERROR_STATUS[code]).toBe(400)
    expect(await codeOf(getHealth({ baseUrl: url, keyId: KEY_ID, secret: SECRET }))).toMatchObject({ code: expected })
  })
})

describe('buildDocumentPayload', () => {
  const one = [{ content: 'Hello', index: 0 }]
  it('maps the four extensions', () => {
    expect(buildDocumentPayload('a.txt', one, '.txt').contentType).toBe('text/plain')
    expect(buildDocumentPayload('a.md', one, 'md').contentType).toBe('text/markdown')
    expect(buildDocumentPayload('a.pdf', one, '.PDF').contentType).toBe('application/pdf')
    expect(buildDocumentPayload('a.docx', one, 'docx').contentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(() => buildDocumentPayload('a.exe', one, 'exe')).toThrow('connector_invalid_request')
    expect(buildDocumentPayload('a.md', one, 'md')).toEqual({ filename: 'a.md', contentType: 'text/markdown', passages: [{ index: 0, text: 'Hello' }] })
  })

  it('refuses documents over the limits with connector_document_too_large', () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({ content: 'x', index: i }))
    expect(() => buildDocumentPayload('a.txt', many, 'txt')).toThrow('connector_document_too_large')
    expect(() => buildDocumentPayload('a.txt', [{ content: 'x'.repeat(1001), index: 0 }], 'txt')).toThrow(
      'connector_document_too_large',
    )
    expect(() => buildDocumentPayload('a.txt', [{ content: '', index: 0 }], 'txt')).toThrow('connector_document_too_large')
    // 1,000 passages of 1,000 three-byte characters is about 3 MB of JSON.
    const heavy = Array.from({ length: 1000 }, (_, i) => ({ content: '€'.repeat(1000), index: i }))
    expect(() => buildDocumentPayload('a.txt', heavy, 'txt')).toThrow('connector_document_too_large')
    const fits = Array.from({ length: 1000 }, (_, i) => ({ content: 'x'.repeat(1000), index: i }))
    expect(buildDocumentPayload('a.txt', fits, 'txt').passages).toHaveLength(1000)
  })

  it('shortens a long filename with basename, then refuses if still too long', () => {
    const long = 'dir/'.repeat(80) + 'faq.md'
    expect(buildDocumentPayload(long, one, 'md').filename).toBe('faq.md')
    expect(() => buildDocumentPayload('x'.repeat(256) + '.md', one, 'md')).toThrow('connector_document_too_large')
    expect(buildDocumentPayload('x'.repeat(252) + '.md', one, 'md').filename).toHaveLength(255)
  })

  it('refuses an empty document or duplicate indexes', () => {
    expect(() => buildDocumentPayload('a.txt', [], 'txt')).toThrow('connector_invalid_request')
    expect(() => buildDocumentPayload('a.txt', [{ content: 'a', index: 0 }, { content: 'b', index: 0 }], 'txt')).toThrow(
      'connector_invalid_request',
    )
  })
})

describe('no echo and one log line per call', () => {
  it('backend bodies, headers, the secret, the base URL path and the question never reach errors or logs', async () => {
    const m = await mock({
      basePath: PATH_SENTINEL,
      overrides: {
        'POST /v1/search': { status: 500, body: { error: { code: 'internal', detail: SENTINEL } }, headers: { 'x-sentinel': SENTINEL } },
        'POST /v1/answer': { status: 200, body: { message: SENTINEL, sources: SENTINEL } },
        'GET /v1/documents': { status: 302, redirect: `http://127.0.0.1/${SENTINEL}` },
        'POST /v1/documents': { status: 200, body: `${SENTINEL} not json` },
        'DELETE /v1/documents/abc': { status: 418, body: SENTINEL, headers: { 'x-sentinel': SENTINEL } },
      },
    })
    const config = configFor(m)
    const errors: unknown[] = []
    const attempts: Promise<unknown>[] = [
      searchPassages(config, QUESTION, 5),
      requestAnswer(config, { question: QUESTION, passages: [PASSAGE], systemPrompt: `prompt ${QUESTION}` }),
      listDocuments(config),
      createDocument(config, buildDocumentPayload('a.txt', [{ content: QUESTION, index: 0 }], 'txt')),
      deleteDocument(config, 'abc'),
      getHealth({ ...config, secret: 'C'.repeat(43) }),
    ]
    for (const p of attempts) {
      try {
        await p
      } catch (e) {
        errors.push(e)
      }
    }
    expect(errors).toHaveLength(6)
    expect(m.requests).toHaveLength(6)

    const forbidden = [SENTINEL, SECRET, 'C'.repeat(43), PATH_SENTINEL.slice(1), QUESTION, KEY_ID, m.baseUrl, '127.0.0.1']
    const errorText = errors
      .map((e) => {
        const err = e as ConnectorError
        return [String(err), err.message, err.stack ?? '', JSON.stringify(err)].join('\n')
      })
      .join('\n')
    const logs = consoleText()
    for (const value of forbidden) {
      expect(errorText).not.toContain(value)
      expect(logs).not.toContain(value)
    }
    expect(logs).toContain(connectorLabel(m.baseUrl))
  })

  it('writes exactly one connector call line per call, in the fixed format', async () => {
    const m = await mock({ capabilities: ['documents', 'search', 'answer'], overrides: { 'POST /v1/answer': { status: 503 } } })
    const config = configFor(m)
    const results = await Promise.allSettled([
      getHealthUnsigned(m.baseUrl),
      getHealth(config),
      searchPassages(config, 'x', 5),
      requestAnswer(config, { question: 'x', passages: [], systemPrompt: null }),
      listDocuments(config),
      deleteDocument(config, 'nope'),
      searchPassages(config, '', 5),
      getHealth({ ...config, baseUrl: 'ftp://backend.example' }),
    ])
    expect(results.map((r) => r.status)).toEqual([
      'fulfilled', 'fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'rejected', 'rejected', 'rejected',
    ])
    const lines = callLogLines()
    expect(lines).toHaveLength(8)
    for (const line of lines) expect(line).toMatch(LOG_LINE)
    expect(logSpy.mock.calls.every((args: unknown[]) => LOG_LINE.test(args.map(String).join(' ')))).toBe(true)
    const outcomes = lines.map((l) => /op=(\w+) .* outcome=(\w+)/.exec(l)!.slice(1).join(':')).sort()
    expect(outcomes).toEqual(
      [
        'health:ok',
        'health:ok',
        'search:ok',
        'answer:connector_http_error',
        'documents:ok',
        'documents:connector_document_not_found',
        'search:connector_invalid_request',
        'health:connector_https_required',
      ].sort(),
    )
  })
})
