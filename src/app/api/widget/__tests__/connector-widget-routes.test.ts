/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { POST as widgetChat } from '../chat/route'
import { POST as generate } from '../generate/route'
import { GET as script } from '../script/[key]/route'
import { POST as previewChat } from '../../chat/route'
import { POST as upload } from '../../upload/route'
import { GET as storageDocuments } from '../../storage/documents/route'
import { getInMemoryDatabase } from '../../../../lib/database'
import { generateEmbeddings, matchScore } from '../../../../lib/embeddings'
import { getCachedEmbedding } from '../../../../lib/rag'
import { demoProvider, ownerProvider, type ChatCompletionRequest, type ChatProvider } from '../../../../lib/model/provider'
import { ModelError, MODEL_TOKEN_HEADER, type OwnerModelConfig } from '../../../../lib/model/shared'
import { checkConnectorBaseUrl } from '../../../../lib/connector/client'
import { generateKeyId, generateSecret } from '../../../../lib/connector/signing'
import { CONNECTOR_ERROR_MESSAGES, type ConnectorConfig } from '../../../../lib/connector/shared'
import { sealConnectorToken, sealWidgetTokenV3 } from '../../../../lib/connector/token'
import { STORAGE_TOKEN_HEADER } from '../../../../lib/storage/errors'
import { sealModelToken } from '../../../../lib/storage/token'
import { SENTINEL, startMockBackend, type MockBackend, type MockDocument } from '../../../../../test/helpers/connector-mock-backend'

jest.mock('../../../../lib/model/provider', () => {
  const actual = jest.requireActual('../../../../lib/model/provider')
  return {
    ...actual,
    ownerProvider: jest.fn(() => {
      throw new Error('ownerProvider must be set up by the test')
    }),
    demoProvider: jest.fn(() => actual.demoProvider()),
  }
})

jest.mock('../../../../lib/embeddings', () => {
  const actual = jest.requireActual('../../../../lib/embeddings')
  return {
    ...actual,
    generateEmbeddings: jest.fn(() => Promise.reject(new Error('generateEmbeddings must not run in connector mode'))),
    generateEmbeddingsBatch: jest.fn(() => Promise.reject(new Error('generateEmbeddingsBatch must not run in connector mode'))),
  }
})

jest.mock('../../../../lib/rag', () => {
  const actual = jest.requireActual('../../../../lib/rag')
  return {
    ...actual,
    getCachedEmbedding: jest.fn(() => Promise.reject(new Error('getCachedEmbedding must not run in connector mode'))),
  }
})

const mockedOwner = ownerProvider as jest.MockedFunction<typeof ownerProvider>
const mockedDemo = demoProvider as jest.MockedFunction<typeof demoProvider>
const mockedEmbed = generateEmbeddings as jest.MockedFunction<typeof generateEmbeddings>
const mockedCachedEmbed = getCachedEmbedding as jest.MockedFunction<typeof getCachedEmbedding>

const TEST_TOKEN_KEY = Buffer.alloc(32, 9).toString('base64')
const MODEL: OwnerModelConfig = {
  baseUrl: 'https://models.example/pathsentinel-q9z4/v1',
  model: 'sentinel-model-7',
  apiKey: 'sk-test-SENTINEL-conn-001',
}
const ALLOWED = 'https://shop.example.com'
const QUESTION = 'What file types can I upload?'
const SEARCH_RESULTS = [
  { documentId: 'doc-1', filename: 'faq.md', text: 'You can upload PDF, DOCX, TXT and MD files.', score: 0.82 },
  { documentId: 'doc-2', filename: 'pricing.md', text: 'Plans start at ten dollars.', score: 0.31 },
  { documentId: 'doc-3', filename: 'about.md', text: 'We are a small team.', score: 0.05 },
]
const STORED_DOC: MockDocument = {
  id: 'doc-1',
  filename: 'faq.md',
  contentType: 'text/markdown',
  passages: [{ index: 0, text: 'You can upload PDF, DOCX, TXT and MD files.' }],
  createdAt: '2026-01-01T00:00:00.000Z',
}

const savedEnv = { ...process.env }
let ipCounter = 0
let providerCounter = 0
let logs: string[] = []
let backend: MockBackend
let connector: ConnectorConfig
let consoleSpies: jest.SpyInstance[] = []

function nextIp(): string {
  ipCounter += 1
  return `connector-client-${ipCounter}`
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-real-ip': nextIp(), ...headers }),
    body: JSON.stringify(body),
  })
}

function scriptRequest(key: string, headers: Record<string, string> = {}): [NextRequest, { params: Promise<{ key: string }> }] {
  return [
    new NextRequest(`http://localhost/api/widget/script/${key}`, { headers: new Headers({ 'x-real-ip': nextIp(), ...headers }) }),
    { params: Promise.resolve({ key }) },
  ]
}

function uploadRequest(files: File[], token: string): NextRequest {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  return new NextRequest('http://localhost/api/upload', {
    method: 'POST',
    headers: new Headers({ [STORAGE_TOKEN_HEADER]: token, 'x-real-ip': nextIp() }),
    body: form,
  })
}

type FakeProvider = ChatProvider & { complete: jest.Mock<Promise<string>, [ChatCompletionRequest]> }

function fakeProvider(kind: 'owner' | 'demo', complete: (req: ChatCompletionRequest) => Promise<string>): FakeProvider {
  providerCounter += 1
  return { kind, model: 'fake', cacheKey: `fake-${providerCounter}`, complete: jest.fn(complete) }
}

function builderToken(answer: boolean): string {
  return sealConnectorToken({ ...connector, answer })
}

function widgetKey(answer: boolean, model?: OwnerModelConfig, origins = [ALLOWED]): string {
  return sealWidgetTokenV3({
    connector,
    origins,
    answer,
    settings: { title: 'Help', welcomeMessage: 'Hi', primaryColor: '#123456', position: 'bottom-right', size: 'medium' },
    ...(model ? { model } : {}),
  })
}

function tamper(token: string): string {
  const i = token.length - 5
  return token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1)
}

function calls(method: string, route: string) {
  return backend.requests.filter((r) => r.method === method && r.path.split('?')[0] === route)
}

function memorySizes(): Record<string, number> {
  const db = getInMemoryDatabase() as unknown as Record<string, unknown>
  const sizes: Record<string, number> = {}
  for (const [name, value] of Object.entries(db)) if (value instanceof Map) sizes[name] = value.size
  return sizes
}

function expectNoLeak(text: string): void {
  for (const secret of [connector.secret, connector.keyId, connector.baseUrl, `:${backend.port}`, SENTINEL, MODEL.apiKey]) {
    expect(text).not.toContain(secret)
  }
}

beforeEach(async () => {
  process.env = { ...savedEnv, EMBED_TOKEN_KEY: TEST_TOKEN_KEY, ALLOW_PRIVATE_CONNECTOR_HOSTS: '1' }
  delete process.env.GROQ_API_KEY
  delete process.env.NEXT_PUBLIC_BASE_URL
  const keyId = generateKeyId()
  const secret = generateSecret()
  backend = await startMockBackend({
    keyId,
    secret,
    capabilities: ['documents', 'search', 'answer'],
    searchResults: SEARCH_RESULTS,
    answer: { message: 'Backend answer.', sources: ['faq.md', 'not-sent.md', 'faq.md'] },
    documents: [STORED_DOC],
  })
  const checked = checkConnectorBaseUrl(backend.baseUrl)
  if (!checked.ok) throw new Error('mock base URL must pass with the flag set')
  connector = { baseUrl: checked.baseUrl, keyId, secret }

  logs = []
  const capture = (...args: unknown[]) => {
    logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }
  consoleSpies = [
    jest.spyOn(console, 'log').mockImplementation(capture),
    jest.spyOn(console, 'warn').mockImplementation(capture),
    jest.spyOn(console, 'error').mockImplementation(capture),
  ]
  mockedOwner.mockClear()
  mockedDemo.mockClear()
  mockedEmbed.mockClear()
  mockedCachedEmbed.mockClear()
})

afterEach(async () => {
  await backend.close()
  for (const spy of consoleSpies) spy.mockRestore()
  mockedOwner.mockReset()
  mockedOwner.mockImplementation(() => {
    throw new Error('ownerProvider must be set up by the test')
  })
})

afterAll(() => {
  process.env = savedEnv
})

describe('C1: upload in connector mode', () => {
  it('sends faq.md to POST /v1/documents only, with no embedding and no memory write', async () => {
    const before = memorySizes()
    const text = fs.readFileSync(path.join(process.cwd(), 'faq.md'), 'utf8')
    const file = new File([text], 'faq.md', { type: 'text/markdown' })

    const res = await upload(uploadRequest([file], builderToken(true)))
    expect(res.status).toBe(200)
    const body = await res.json()

    const posts = calls('POST', '/v1/documents')
    expect(backend.requests).toHaveLength(1)
    expect(posts).toHaveLength(1)
    expect(posts[0].signature).toBe('valid')
    const sent = JSON.parse(posts[0].body)
    expect(sent.filename).toBe('faq.md')
    expect(sent.contentType).toBe('text/markdown')
    expect(sent.passages.length).toBe(Math.ceil(text.length / 1000))
    for (const p of sent.passages) expect(p.text.length).toBeLessThanOrEqual(1000)
    expect(sent.passages.map((p: { text: string }) => p.text).join('')).toBe(text)

    expect(body).not.toHaveProperty('sessionId')
    expect(body.success).toBe(true)
    expect(body.documents).toEqual([
      {
        filename: 'faq.md',
        chunks: sent.passages.length,
        chunkCount: sent.passages.length,
        wordCount: text.split(/\s+/).length,
        documentId: backend.documents[backend.documents.length - 1].id,
      },
    ])
    expect(body.details).toEqual({ documentsProcessed: 1, totalChunks: sent.passages.length, totalWords: text.split(/\s+/).length })

    expect(mockedCachedEmbed).not.toHaveBeenCalled()
    expect(mockedEmbed).not.toHaveBeenCalled()
    expect(memorySizes()).toEqual(before)
    expect(logs.some((l) => l.includes('DB - storeDocument called') || l.includes('Created RAG session'))).toBe(false)
    expectNoLeak(logs.join('\n'))
  })

  it('refuses a 1,001-passage document with 413 before any backend call', async () => {
    const before = memorySizes()
    const big = new File(['x'.repeat(1001 * 1000)], 'big.txt', { type: 'text/plain' })
    const small = new File(['hello'], 'small.txt', { type: 'text/plain' })

    const res = await upload(uploadRequest([small, big], builderToken(true)))
    expect(res.status).toBe(413)
    expect((await res.json()).code).toBe('connector_document_too_large')
    expect(backend.requests).toHaveLength(0)
    expect(memorySizes()).toEqual(before)
    expect(mockedCachedEmbed).not.toHaveBeenCalled()
  })

  it('maps a backend failure to the fixed connector error without echoing it', async () => {
    backend.options.overrides = { 'POST /v1/documents': { status: 500, headers: { 'x-sentinel': SENTINEL } } }
    const res = await upload(uploadRequest([new File(['hello'], 'a.txt', { type: 'text/plain' })], builderToken(true)))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toEqual({
      error: 'Your backend returned an error (HTTP 500).',
      code: 'connector_http_error',
      details: 'Your backend returned an error (HTTP 500).',
    })
    expectNoLeak(JSON.stringify(body) + logs.join('\n'))
  })
})

describe('C2/C3: preview chat in connector mode', () => {
  const expectedConfidence = matchScore([0.82, 0.31])

  it('with answer: one search (topK 5) and one answer call, no provider, no embedding', async () => {
    const before = memorySizes()
    const res = await previewChat(
      jsonRequest('http://localhost/api/chat', { message: QUESTION, sessionId: 's-1' }, { [STORAGE_TOKEN_HEADER]: builderToken(true) }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ message: 'Backend answer.', confidence: expectedConfidence, sources: ['faq.md'], isEnhanced: true, sessionId: 's-1' })

    const searches = calls('POST', '/v1/search')
    expect(searches).toHaveLength(1)
    expect(JSON.parse(searches[0].body)).toEqual({ query: QUESTION, topK: 5 })
    const answers = calls('POST', '/v1/answer')
    expect(answers).toHaveLength(1)
    const answerBody = JSON.parse(answers[0].body)
    expect(answerBody.question).toBe(QUESTION)
    expect(answerBody.passages.map((p: { filename: string }) => p.filename)).toEqual(['faq.md', 'pricing.md'])
    expect(backend.requests).toHaveLength(2)
    expect(backend.requests.every((r) => r.signature === 'valid')).toBe(true)

    expect(mockedOwner).not.toHaveBeenCalled()
    expect(mockedDemo).not.toHaveBeenCalled()
    expect(mockedEmbed).not.toHaveBeenCalled()
    expect(mockedCachedEmbed).not.toHaveBeenCalled()
    expect(memorySizes()).toEqual(before)
    expect(logs).toContain(`Chat API connector path=backend confidence=${expectedConfidence}`)
  })

  it('with answer: an owner model token is ignored and never called', async () => {
    const res = await previewChat(
      jsonRequest(
        'http://localhost/api/chat',
        { message: QUESTION },
        { [STORAGE_TOKEN_HEADER]: builderToken(true), [MODEL_TOKEN_HEADER]: sealModelToken(MODEL) },
      ),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).sessionId).toBeNull()
    expect(mockedOwner).not.toHaveBeenCalled()
    expect(mockedDemo).not.toHaveBeenCalled()
  })

  it('without answer: uses the owner model when one is attached, with filtered passages only', async () => {
    const owner = fakeProvider('owner', () => Promise.resolve('Owner answer'))
    mockedOwner.mockReturnValue(owner)
    const res = await previewChat(
      jsonRequest(
        'http://localhost/api/chat',
        { message: QUESTION },
        { [STORAGE_TOKEN_HEADER]: builderToken(false), [MODEL_TOKEN_HEADER]: sealModelToken(MODEL) },
      ),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Owner answer')
    expect(body.confidence).toBe(expectedConfidence)
    expect(body.sources).toEqual(['faq.md', 'pricing.md'])
    expect(owner.complete).toHaveBeenCalledTimes(1)
    const prompt = JSON.stringify(owner.complete.mock.calls[0][0])
    expect(prompt).not.toContain('We are a small team.')
    expect(mockedDemo).not.toHaveBeenCalled()
    expect(calls('POST', '/v1/search')).toHaveLength(1)
    expect(calls('POST', '/v1/answer')).toHaveLength(0)
  })

  it('without answer and without a model: uses the demo model', async () => {
    const demo = fakeProvider('demo', () => Promise.resolve('Demo answer'))
    mockedDemo.mockReturnValueOnce(demo)
    const res = await previewChat(jsonRequest('http://localhost/api/chat', { message: QUESTION }, { [STORAGE_TOKEN_HEADER]: builderToken(false) }))
    expect(res.status).toBe(200)
    expect((await res.json()).message).toBe('Demo answer')
    expect(mockedDemo).toHaveBeenCalledTimes(1)
    expect(mockedOwner).not.toHaveBeenCalled()
    expect(calls('POST', '/v1/search')).toHaveLength(1)
  })

  it('gives confidence 0 and isEnhanced false when no passage passes the threshold', async () => {
    backend.options.searchResults = [{ ...SEARCH_RESULTS[2] }]
    backend.options.answer = { message: 'No idea.', sources: [] }
    const res = await previewChat(
      jsonRequest('http://localhost/api/chat', { message: 'What is the capital of France?' }, { [STORAGE_TOKEN_HEADER]: builderToken(true) }),
    )
    const body = await res.json()
    expect(body).toEqual({ message: 'No idea.', confidence: 0, sources: [], isEnhanced: false, sessionId: null })
  })

  it('a failed answer call is a 502 with the fixed message and no demo fallback', async () => {
    backend.options.overrides = { 'POST /v1/answer': { status: 500, headers: { 'x-sentinel': SENTINEL } } }
    const res = await previewChat(jsonRequest('http://localhost/api/chat', { message: QUESTION }, { [STORAGE_TOKEN_HEADER]: builderToken(true) }))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toEqual({
      error: 'Failed to generate response',
      code: 'connector_http_error',
      details: 'Your backend returned an error (HTTP 500).',
    })
    expect(mockedDemo).not.toHaveBeenCalled()
    expect(mockedOwner).not.toHaveBeenCalled()
    expect(logs.some((l) => l.includes('provider=demo'))).toBe(false)
    expectNoLeak(JSON.stringify(body) + logs.join('\n'))
  })

  it('a failed owner model call is a 502, never a Groq answer', async () => {
    mockedOwner.mockReturnValue(fakeProvider('owner', () => Promise.reject(new ModelError('model_http_error', 500))))
    const res = await previewChat(
      jsonRequest(
        'http://localhost/api/chat',
        { message: QUESTION },
        { [STORAGE_TOKEN_HEADER]: builderToken(false), [MODEL_TOKEN_HEADER]: sealModelToken(MODEL) },
      ),
    )
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('model_http_error')
    expect(mockedDemo).not.toHaveBeenCalled()
    expect(logs.some((l) => l.includes('provider=demo'))).toBe(false)
  })

  it('a blocked address on a flag-off server is refused before any backend call', async () => {
    const token = builderToken(true)
    delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
    const res = await previewChat(jsonRequest('http://localhost/api/chat', { message: QUESTION }, { [STORAGE_TOKEN_HEADER]: token }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('connector_address_blocked')
    expect(backend.requests).toHaveLength(0)
  })
})

describe('C5: generate in connector mode', () => {
  it('refuses without allowed sites before any backend call', async () => {
    const res = await generate(jsonRequest('http://localhost/api/widget/generate', { title: 'Help' }, { [STORAGE_TOKEN_HEADER]: builderToken(true) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('origins_required')
    expect(body.error).toMatch(/your backend/)
    expect(backend.requests).toHaveLength(0)
  })

  it('refuses an invalid colour or an over-long title before any backend call', async () => {
    for (const config of [
      { title: 'Help', primary_color: 'red', allowed_origins: [ALLOWED] },
      { title: 'x'.repeat(101), allowed_origins: [ALLOWED] },
      { title: 'Help', welcome_message: 'x'.repeat(501), allowed_origins: [ALLOWED] },
      { title: 'Help', position: 'top', allowed_origins: [ALLOWED] },
    ]) {
      const res = await generate(jsonRequest('http://localhost/api/widget/generate', config, { [STORAGE_TOKEN_HEADER]: builderToken(true) }))
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('Invalid widget configuration')
    }
    expect(backend.requests).toHaveLength(0)
  })

  it('refuses with connector_no_documents when the backend is empty', async () => {
    backend.documents.splice(0)
    const res = await generate(
      jsonRequest('http://localhost/api/widget/generate', { title: 'Help', allowed_origins: [ALLOWED] }, { [STORAGE_TOKEN_HEADER]: builderToken(true) }),
    )
    expect(res.status).toBe(400)
    const msg = CONNECTOR_ERROR_MESSAGES.connector_no_documents
    expect(await res.json()).toEqual({ error: msg, code: 'connector_no_documents', details: msg })
    expect(calls('GET', '/v1/health')).toHaveLength(1)
    expect(calls('GET', '/v1/documents')).toHaveLength(1)
  })

  it('seals an sbw3_ embed from a signed health call and echoes no connector or model field', async () => {
    // The builder token says no answer; the signed health call at generate decides.
    const res = await generate(
      jsonRequest(
        'http://localhost/api/widget/generate',
        { title: 'Help', welcome_message: 'Hello', allowed_origins: [ALLOWED], system_prompt: 'Be brief.' },
        { [STORAGE_TOKEN_HEADER]: builderToken(false), [MODEL_TOKEN_HEADER]: sealModelToken(MODEL) },
      ),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body.widgetKey).toMatch(/^sbw3_/)
    expect(body.answerPath).toBe('backend')
    expect(body.persistent).toBe(true)
    expect(body.scriptUrl).toBe(`http://localhost/api/widget/script/${body.widgetKey}`)
    expect(body.scriptUrl.length).toBeLessThanOrEqual(8000)
    expect(body.embedCode).toBe(`<script src="${body.scriptUrl}" async></script>`)
    expect(body.widget).toEqual({
      widget_key: body.widgetKey,
      title: 'Help',
      welcome_message: 'Hello',
      primary_color: '#3B82F6',
      position: 'bottom-right',
      size: 'medium',
      is_active: true,
    })
    expectNoLeak(text)
    expect(text).not.toContain(MODEL.baseUrl)
    const health = calls('GET', '/v1/health')
    expect(health).toHaveLength(1)
    expect(health[0].signature).toBe('valid')
    expectNoLeak(logs.join('\n'))

    // The embed answers through the backend from an allowed site.
    const chat = await widgetChat(
      jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: body.widgetKey }, { origin: ALLOWED }),
    )
    expect(chat.status).toBe(200)
    expect((await chat.json()).message).toBe('Backend answer.')
    const answers = calls('POST', '/v1/answer')
    expect(answers).toHaveLength(1)
    expect(JSON.parse(answers[0].body).systemPrompt).toBe('Be brief.')
  })

  it('seals the owner model when the backend does not answer', async () => {
    backend.options.capabilities = ['documents', 'search']
    const res = await generate(
      jsonRequest(
        'http://localhost/api/widget/generate',
        { title: 'Help', allowed_origins: [ALLOWED] },
        { [STORAGE_TOKEN_HEADER]: builderToken(true), [MODEL_TOKEN_HEADER]: sealModelToken(MODEL) },
      ),
    )
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text).answerPath).toBe('owner')
    expectNoLeak(text)

    const demoRes = await generate(
      jsonRequest('http://localhost/api/widget/generate', { title: 'Help', allowed_origins: [ALLOWED] }, { [STORAGE_TOKEN_HEADER]: builderToken(true) }),
    )
    expect((await demoRes.json()).answerPath).toBe('demo')
  })

  it('refuses with embed_too_large when the script address would pass 8,000 characters', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://' + 'h'.repeat(7700) + '.example.com'
    const res = await generate(
      jsonRequest(
        'http://localhost/api/widget/generate',
        { title: 'Help', allowed_origins: [ALLOWED], system_prompt: 'Be brief. '.repeat(300) },
        { [STORAGE_TOKEN_HEADER]: builderToken(true) },
      ),
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('embed_too_large')
  })

  it('maps a rejected signature at generate to connector_auth_rejected', async () => {
    backend.options.secret = generateSecret()
    const res = await generate(
      jsonRequest('http://localhost/api/widget/generate', { title: 'Help', allowed_origins: [ALLOWED] }, { [STORAGE_TOKEN_HEADER]: builderToken(true) }),
    )
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('connector_auth_rejected')
  })
})

describe('C2/C3: widget chat in connector mode', () => {
  it('with answer: one search and one answer, no provider, unchanged response shape', async () => {
    const key = widgetKey(true)
    const res = await widgetChat(jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: key }, { origin: ALLOWED }))
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(await res.json()).toEqual({
      message: 'Backend answer.',
      confidence: matchScore([0.82, 0.31]),
      sources: ['faq.md'],
      isEnhanced: true,
      sessionId: 'widget-session',
      widgetKey: key,
    })
    expect(JSON.parse(calls('POST', '/v1/search')[0].body)).toEqual({ query: QUESTION, topK: 5 })
    expect(calls('POST', '/v1/search')).toHaveLength(1)
    expect(calls('POST', '/v1/answer')).toHaveLength(1)
    expect(mockedOwner).not.toHaveBeenCalled()
    expect(mockedDemo).not.toHaveBeenCalled()
    expect(mockedCachedEmbed).not.toHaveBeenCalled()
  })

  it('without answer: owner model when sealed, demo otherwise, with the default widget prompt', async () => {
    const owner = fakeProvider('owner', () => Promise.resolve('Owner answer'))
    mockedOwner.mockReturnValue(owner)
    const res = await widgetChat(
      jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: widgetKey(false, MODEL) }, { origin: ALLOWED }),
    )
    expect((await res.json()).message).toBe('Owner answer')
    expect(JSON.stringify(owner.complete.mock.calls[0][0])).toContain('embedded in a website widget')
    expect(mockedDemo).not.toHaveBeenCalled()

    const demo = fakeProvider('demo', () => Promise.resolve('Demo answer'))
    mockedDemo.mockReturnValueOnce(demo)
    const demoRes = await widgetChat(
      jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: widgetKey(false) }, { origin: ALLOWED }),
    )
    expect((await demoRes.json()).message).toBe('Demo answer')
    expect(calls('POST', '/v1/answer')).toHaveLength(0)
  })

  it('a failed answer call is a 503 with the unavailable body and no demo fallback', async () => {
    backend.options.overrides = { 'POST /v1/answer': { status: 500, headers: { 'x-sentinel': SENTINEL } } }
    const res = await widgetChat(jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: widgetKey(true) }, { origin: ALLOWED }))
    expect(res.status).toBe(503)
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    const body = await res.json()
    expect(body).toEqual({
      error: 'Widget unavailable',
      message: 'Sorry, I encountered an error. Please try again.',
      confidence: 0,
      sources: [],
      isEnhanced: false,
      sessionId: 'error-session',
    })
    expect(mockedDemo).not.toHaveBeenCalled()
    expect(logs).toContain('Widget chat connector error code=connector_http_error')
    expect(logs.some((l) => l.includes('provider=demo'))).toBe(false)
    expectNoLeak(logs.join('\n'))
  })

  it('a failed owner model call is a 503', async () => {
    mockedOwner.mockReturnValue(fakeProvider('owner', () => Promise.reject(new ModelError('model_unreachable'))))
    const res = await widgetChat(
      jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: widgetKey(false, MODEL) }, { origin: ALLOWED }),
    )
    expect(res.status).toBe(503)
    expect(mockedDemo).not.toHaveBeenCalled()
  })
})

describe('D4: sbw3_ on the script and chat routes', () => {
  it('a tampered token is 404 on both routes with no backend call', async () => {
    const bad = tamper(widgetKey(true))
    const s = await script(...scriptRequest(bad, { origin: ALLOWED }))
    expect(s.status).toBe(404)
    const c = await widgetChat(jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: bad }, { origin: ALLOWED }))
    expect(c.status).toBe(404)
    expect(backend.requests).toHaveLength(0)
  })

  it('an unlisted origin is 403 before any backend call', async () => {
    const key = widgetKey(true)
    const c = await widgetChat(
      jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: key }, { origin: 'https://evil.example.net' }),
    )
    expect(c.status).toBe(403)
    expect((await c.json()).code).toBe('origin_not_allowed')
    const s = await script(...scriptRequest(key, { origin: 'https://evil.example.net' }))
    expect(s.status).toBe(403)
    expect(backend.requests).toHaveLength(0)
  })

  it('serves the script on an allowed origin without the secret or address', async () => {
    const key = widgetKey(true)
    const s = await script(...scriptRequest(key, { origin: ALLOWED }))
    expect(s.status).toBe(200)
    const js = await s.text()
    expect(js).toContain(key)
    expect(js).toContain('Help')
    expectNoLeak(js)
    expect(backend.requests).toHaveLength(0)
  })

  it('an sbc1_ token as a widget key is 403 on both routes', async () => {
    const token = builderToken(true)
    expect((await script(...scriptRequest(token))).status).toBe(403)
    const c = await widgetChat(jsonRequest('http://localhost/api/widget/chat', { message: QUESTION, widgetKey: token }, { origin: ALLOWED }))
    expect(c.status).toBe(403)
  })
})

describe('storage documents route', () => {
  it('refuses an sbc1_ token with token_wrong_purpose', async () => {
    const res = await storageDocuments(
      new NextRequest('http://localhost/api/storage/documents', {
        headers: new Headers({ [STORAGE_TOKEN_HEADER]: builderToken(true), 'x-real-ip': nextIp() }),
      }),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('token_wrong_purpose')
    expect(backend.requests).toHaveLength(0)
  })
})
