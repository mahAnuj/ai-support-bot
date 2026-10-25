/** @jest-environment node */
import * as http from 'node:http'
import * as dns from 'node:dns'
import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { ModelError } from '../shared'
import { buildRequestBody, createOpenAICompatibleProvider } from '../openai-compatible'
import {
  CHAT_TIMEOUT_MS,
  GROQ_BASE_URL,
  MAX_OUTPUT_TOKENS,
  MAX_RESPONSE_BYTES,
  VALIDATE_TIMEOUT_MS,
  demoProvider,
  ownerProvider,
  type ChatCompletionRequest,
} from '../provider'

// Test hostnames resolve to fixed addresses; anything else would need the network, so it fails.
jest.mock('node:dns', () => {
  const actual = jest.requireActual<typeof import('node:dns')>('node:dns')
  return { ...actual, lookup: jest.fn() }
})
const FAKE_DNS: Record<string, { address: string; family: number }[]> = {
  'private.example': [{ address: '10.0.0.5', family: 4 }],
  'loopback.example': [{ address: '127.0.0.1', family: 4 }],
}
const lookupMock = dns.lookup as unknown as jest.Mock

const SENTINEL = `SENTINEL-${randomBytes(6).toString('hex')}`
const API_KEY = 'sk-test-SENTINEL'

type Handler = (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void
interface Received {
  method?: string
  url?: string
  headers: http.IncomingHttpHeaders
  body: string
}

let server: http.Server
let port: number
let handler: Handler
let received: Received[] = []
let savedFlag: string | undefined
let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance
let warnSpy: jest.SpyInstance

function okCompletion(content: unknown = 'Hello there'): string {
  return JSON.stringify({
    id: SENTINEL,
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  })
}

function reply(status: number, body: string, headers: Record<string, string> = {}): Handler {
  return (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json', 'x-sentinel': SENTINEL, ...headers })
    res.end(body)
  }
}

function errorBody(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ error: { message: `Bad thing ${SENTINEL}`, type: SENTINEL, ...extra } })
}

const request: ChatCompletionRequest = {
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hi' },
  ],
  maxTokens: 1024,
  temperature: 0.3,
}

function mockBase(): string {
  return `http://127.0.0.1:${port}/v1`
}

function provider(model = 'llama-x', baseUrl = mockBase()) {
  return createOpenAICompatibleProvider({ baseUrl, model, apiKey: API_KEY }, { kind: 'owner' })
}

async function capture(promise: Promise<unknown>): Promise<ModelError> {
  try {
    await promise
  } catch (e) {
    return e as ModelError
  }
  throw new Error('expected a rejection')
}

function capturedOutput(): string {
  return [logSpy, errorSpy, warnSpy]
    .flatMap((spy) => spy.mock.calls)
    .map((args) => args.map((a: unknown) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '))
    .join('\n')
}

function expectNoLeak(err: ModelError): void {
  const surfaces = [err.message, JSON.stringify(err), String(err.stack), capturedOutput()]
  for (const text of surfaces) {
    expect(text).not.toContain(SENTINEL)
    expect(text).not.toContain(API_KEY)
  }
}

beforeAll(async () => {
  savedFlag = process.env.ALLOW_PRIVATE_MODEL_HOSTS
  process.env.ALLOW_PRIVATE_MODEL_HOSTS = '1'
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      received.push({ method: req.method, url: req.url, headers: req.headers, body })
      res.on('error', () => {})
      handler(req, res, body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  if (savedFlag === undefined) delete process.env.ALLOW_PRIVATE_MODEL_HOSTS
  else process.env.ALLOW_PRIVATE_MODEL_HOSTS = savedFlag
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  process.env.ALLOW_PRIVATE_MODEL_HOSTS = '1'
  received = []
  handler = reply(200, okCompletion())
  lookupMock.mockReset()
  lookupMock.mockImplementation((host: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
    const answer = FAKE_DNS[host]
    if (!answer) {
      process.nextTick(() => cb(Object.assign(new Error(`getaddrinfo ENOTFOUND ${host} ${SENTINEL}`), { code: 'ENOTFOUND' })))
      return
    }
    process.nextTick(() => cb(null, answer))
  })
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('constants', () => {
  it('match the spec bounds', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(1024)
    expect(CHAT_TIMEOUT_MS).toBe(30_000)
    expect(VALIDATE_TIMEOUT_MS).toBe(10_000)
    expect(MAX_RESPONSE_BYTES).toBe(1_048_576)
    expect(GROQ_BASE_URL).toBe('https://api.groq.com/openai/v1')
  })
})

describe('success', () => {
  it('posts to /chat/completions and returns the content', async () => {
    await expect(provider().complete(request)).resolves.toBe('Hello there')
    expect(received).toHaveLength(1)
    const [r] = received
    expect(r.method).toBe('POST')
    expect(r.url).toBe('/v1/chat/completions')
    expect(r.headers.authorization).toBe(`Bearer ${API_KEY}`)
    expect(r.headers['content-type']).toBe('application/json')
    expect(r.headers.accept).toBe('application/json')
    expect(r.headers['accept-encoding']).toBe('identity')
    expect(r.headers['content-length']).toBe(String(Buffer.byteLength(r.body)))
  })

  it('accepts null or empty content (reasoning used the whole budget)', async () => {
    handler = reply(200, okCompletion(null))
    await expect(provider().complete(request)).resolves.toBe('')
    handler = reply(200, okCompletion(''))
    await expect(provider().complete(request)).resolves.toBe('')
  })

  it('logs one line with provider, fingerprint, outcome and duration only', async () => {
    await provider().complete(request)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toMatch(/^model call provider=owner model=#[0-9a-f]{8} outcome=ok ms=\d+$/)
    expect(capturedOutput()).not.toContain('127.0.0.1')
    expect(capturedOutput()).not.toContain('llama-x')
  })

  it('pins the connection to the guarded DNS answer for a hostname', async () => {
    const base = `http://loopback.example:${port}/v1`
    await expect(provider('llama-x', base).complete(request)).resolves.toBe('Hello there')
    expect(lookupMock).toHaveBeenCalled()
    expect(received[0].headers.host).toBe(`loopback.example:${port}`)
  })

  it('ownerProvider uses the OpenAI-compatible adapter', async () => {
    const p = ownerProvider({ baseUrl: mockBase(), model: 'llama-x', apiKey: API_KEY })
    expect(p.kind).toBe('owner')
    expect(p.model).toBe('llama-x')
    await expect(p.complete(request)).resolves.toBe('Hello there')
    expect(logSpy.mock.calls[0][0]).toMatch(/^model call provider=owner /)
  })

  it('gives owners with the same model ID on different endpoints different cache keys', () => {
    const a = ownerProvider({ baseUrl: 'https://a.example/v1', model: 'llama-x', apiKey: API_KEY })
    const b = ownerProvider({ baseUrl: 'https://b.example/v1', model: 'llama-x', apiKey: API_KEY })
    expect(a.cacheKey).toMatch(/^[0-9a-f]{8}$/)
    expect(a.cacheKey).not.toBe(b.cacheKey)
    expect(a.cacheKey).not.toContain('a.example')
    expect(a.cacheKey).not.toContain(API_KEY)
  })
})

describe('error mapping (AC 15)', () => {
  const cases: [string, () => Handler, string, number | undefined][] = [
    ['401', () => reply(401, errorBody()), 'model_auth_rejected', undefined],
    ['403', () => reply(403, errorBody()), 'model_auth_rejected', undefined],
    ['404', () => reply(404, errorBody()), 'model_not_found', undefined],
    ['400 model_not_found code', () => reply(400, errorBody({ code: 'model_not_found' })), 'model_not_found', undefined],
    [
      '400 model-not-found message',
      () => reply(400, JSON.stringify({ error: { message: `The model \`${SENTINEL}\` does not exist` } })),
      'model_not_found',
      undefined,
    ],
    ['422 model_not_found code', () => reply(422, errorBody({ code: 'model_not_found' })), 'model_not_found', undefined],
    ['429', () => reply(429, errorBody(), { 'retry-after': SENTINEL }), 'model_rate_limited', undefined],
    ['400', () => reply(400, errorBody({ code: 'invalid_request_error' })), 'model_bad_params', undefined],
    ['400 non-JSON', () => reply(400, `<html>${SENTINEL}</html>`), 'model_bad_params', undefined],
    ['422', () => reply(422, errorBody()), 'model_bad_params', undefined],
    ['500', () => reply(500, errorBody()), 'model_http_error', 500],
    ['503', () => reply(503, `upstream ${SENTINEL}`), 'model_http_error', 503],
    ['200 not JSON', () => reply(200, `not json ${SENTINEL}`), 'model_bad_response', undefined],
    ['200 wrong shape', () => reply(200, JSON.stringify({ result: SENTINEL })), 'model_bad_response', undefined],
    ['200 empty choices', () => reply(200, JSON.stringify({ choices: [] })), 'model_bad_response', undefined],
    ['200 content not a string', () => reply(200, okCompletion({ text: SENTINEL })), 'model_bad_response', undefined],
  ]

  it.each(cases)('%s maps to its fixed code without leaking', async (_name, makeHandler, code, httpStatus) => {
    handler = makeHandler()
    const err = await capture(provider().complete(request))
    expect(err).toBeInstanceOf(ModelError)
    expect(err.code).toBe(code)
    expect(err.message).toBe(code)
    expect(err.httpStatus).toBe(httpStatus)
    expect(received).toHaveLength(1)
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toMatch(new RegExp(`^model call provider=owner model=#[0-9a-f]{8} outcome=${code} ms=\\d+$`))
    expectNoLeak(err)
  })

  it('connection refused maps to unreachable', async () => {
    const closed = http.createServer()
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve))
    const closedPort = (closed.address() as AddressInfo).port
    await new Promise<void>((resolve) => closed.close(() => resolve()))

    const err = await capture(provider('llama-x', `http://127.0.0.1:${closedPort}/v1`).complete(request))
    expect(err).toBeInstanceOf(ModelError)
    expect(err.code).toBe('model_unreachable')
    expectNoLeak(err)
    expect(capturedOutput()).not.toContain('ECONNREFUSED')
  })

  it('a DNS failure maps to unreachable', async () => {
    const err = await capture(provider('llama-x', `http://nowhere.example:${port}/v1`).complete(request))
    expect(err.code).toBe('model_unreachable')
    expect(received).toHaveLength(0)
    expectNoLeak(err)
  })

  it('a timeout maps to unreachable', async () => {
    handler = () => {}
    const started = Date.now()
    const err = await capture(provider().complete({ ...request, timeoutMs: 200 }))
    expect(err.code).toBe('model_unreachable')
    expect(Date.now() - started).toBeLessThan(5000)
    expectNoLeak(err)
  })

  it('a body over 1 MB maps to bad response', async () => {
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-sentinel': SENTINEL })
      res.end(`{"choices":[{"message":{"content":"${SENTINEL}${'x'.repeat(2 * 1024 * 1024)}"}}]}`)
    }
    const err = await capture(provider().complete(request))
    expect(err.code).toBe('model_bad_response')
    expectNoLeak(err)
  })

  it('does not follow a redirect', async () => {
    handler = reply(302, errorBody(), { location: 'http://10.0.0.1/' })
    const err = await capture(provider().complete(request))
    expect(err.code).toBe('model_http_error')
    expect(err.httpStatus).toBe(302)
    expect(received).toHaveLength(1)
    expectNoLeak(err)
  })
})

describe('request parameters (AC 24)', () => {
  it('gpt-oss gets the same body the demo sent through the SDK', async () => {
    await provider('openai/gpt-oss-20b').complete(request)
    expect(received[0].body).toBe(
      JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: request.messages,
        max_completion_tokens: 1024,
        temperature: 0.3,
        reasoning_effort: 'low',
      }),
    )
  })

  it('gpt-oss with JSON mode matches the query rewording body', async () => {
    await provider('openai/gpt-oss-20b').complete({ ...request, maxTokens: 512, temperature: 0.7, jsonObject: true })
    expect(received[0].body).toBe(
      JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: request.messages,
        response_format: { type: 'json_object' },
        max_completion_tokens: 512,
        temperature: 0.7,
        reasoning_effort: 'low',
      }),
    )
  })

  it('other models get standard parameters only, with max_tokens capped at 1024', async () => {
    await provider('llama-x').complete({ ...request, maxTokens: 50_000, jsonObject: true })
    const body = JSON.parse(received[0].body)
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'temperature'])
    expect(body).toEqual({ model: 'llama-x', messages: request.messages, max_tokens: 1024, temperature: 0.3 })
  })

  it('caps gpt-oss output tokens at 1024', () => {
    expect(buildRequestBody('some/gpt-oss-120b', { ...request, maxTokens: 9999 })).toMatchObject({
      max_completion_tokens: 1024,
      reasoning_effort: 'low',
    })
    expect(buildRequestBody('llama-x', { ...request, maxTokens: 16 })).toMatchObject({ max_tokens: 16 })
  })
})

describe('SSRF guard on every call (AC 22)', () => {
  it('refuses a loopback literal with the flag off and sends nothing', async () => {
    delete process.env.ALLOW_PRIVATE_MODEL_HOSTS
    for (const base of [`https://127.0.0.1:${port}/v1`, `http://127.0.0.1:${port}/v1`]) {
      const err = await capture(provider('llama-x', base).complete(request))
      expect(err).toBeInstanceOf(ModelError)
      expect(['model_address_blocked', 'model_https_required']).toContain(err.code)
    }
    const err = await capture(provider('llama-x', `https://127.0.0.1:${port}/v1`).complete(request))
    expect(err.code).toBe('model_address_blocked')
    expect(received).toHaveLength(0)
  })

  it('refuses a hostname whose DNS answer is private with the flag off', async () => {
    delete process.env.ALLOW_PRIVATE_MODEL_HOSTS
    const err = await capture(provider('llama-x', 'https://private.example/v1').complete(request))
    expect(err.code).toBe('model_address_blocked')
    expect(received).toHaveLength(0)
    expectNoLeak(err)
  })

  it('reads the flag on every call', async () => {
    const p = provider()
    await expect(p.complete(request)).resolves.toBe('Hello there')
    delete process.env.ALLOW_PRIVATE_MODEL_HOSTS
    await expect(p.complete(request)).rejects.toMatchObject({ code: 'model_address_blocked' })
    expect(received).toHaveLength(1)
  })
})

describe('demoProvider', () => {
  it('reads the env only when used and fails loudly without a key', async () => {
    const savedKey = process.env.GROQ_API_KEY
    const savedModel = process.env.GROQ_MODEL
    try {
      delete process.env.GROQ_API_KEY
      delete process.env.GROQ_MODEL
      const p = demoProvider()
      expect(p.kind).toBe('demo')
      expect(p.model).toBe('openai/gpt-oss-20b')
      expect(p.cacheKey).toBe('demo:openai/gpt-oss-20b')
      process.env.GROQ_MODEL = 'llama-x'
      expect(p.model).toBe('llama-x')
      expect(p.cacheKey).toBe('demo:llama-x')
      await expect(p.complete(request)).rejects.toThrow('GROQ_API_KEY is not set')
      expect(lookupMock).not.toHaveBeenCalled()
    } finally {
      if (savedKey === undefined) delete process.env.GROQ_API_KEY
      else process.env.GROQ_API_KEY = savedKey
      if (savedModel === undefined) delete process.env.GROQ_MODEL
      else process.env.GROQ_MODEL = savedModel
    }
  })
})
