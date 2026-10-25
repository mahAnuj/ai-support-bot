/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST as widgetChat } from '../chat/route'
import { POST as generate } from '../generate/route'
import { POST as previewChat } from '../../chat/route'
import { createWidgetFromSession } from '../../../../lib/database'
import { demoProvider, ownerProvider, type ChatCompletionRequest, type ChatProvider } from '../../../../lib/model/provider'
import { ModelError, MODEL_TOKEN_HEADER, type OwnerModelConfig } from '../../../../lib/model/shared'
import { memoryStore } from '../../../../lib/storage/memory-store'
import { sealModelToken, sealWidgetTokenV2 } from '../../../../lib/storage/token'

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

jest.mock('../../../../lib/database', () => {
  const actual = jest.requireActual('../../../../lib/database')
  return { ...actual, createWidgetFromSession: jest.fn(actual.createWidgetFromSession) }
})

jest.mock('../../../../lib/embeddings', () => {
  const actual = jest.requireActual('../../../../lib/embeddings')
  const vector = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))
  return {
    ...actual,
    generateEmbeddings: jest.fn(async () => vector),
    generateEmbeddingsBatch: jest.fn(() => Promise.reject(new Error('generateEmbeddingsBatch must not be called'))),
  }
})

const mockedOwner = ownerProvider as jest.MockedFunction<typeof ownerProvider>
const mockedDemo = demoProvider as jest.MockedFunction<typeof demoProvider>
const mockedCreate = createWidgetFromSession as jest.MockedFunction<typeof createWidgetFromSession>

const VECTOR = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))
const TEST_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64')
const MODEL: OwnerModelConfig = {
  baseUrl: 'https://models.example/pathsentinel-q9z4/v1',
  model: 'sentinel-model-7',
  apiKey: 'sk-test-SENTINEL-abc123',
}
const ALLOWED = 'https://shop.example.com'

let savedTokenKey: string | undefined
let ipCounter = 0
let providerCounter = 0

function nextIp(): string {
  ipCounter += 1
  return `owner-model-client-${ipCounter}`
}

type FakeProvider = ChatProvider & { complete: jest.Mock<Promise<string>, [ChatCompletionRequest]> }

function fakeOwner(complete: (req: ChatCompletionRequest) => Promise<string>): FakeProvider {
  providerCounter += 1
  return { kind: 'owner', model: MODEL.model, cacheKey: `fake-${providerCounter}`, complete: jest.fn(complete) }
}

function answerOrReword(req: ChatCompletionRequest): Promise<string> {
  return Promise.resolve(req.jsonObject ? '{"variations": ["When do you open?"]}' : 'Owner model answer')
}

async function sessionWithDocument(): Promise<string> {
  const workspace = await memoryStore.createWorkspace()
  await memoryStore.storeDocument(workspace.id, 'hours.md', [
    { content: 'We are open 9 to 5 on weekdays.', embedding: VECTOR, index: 0 },
  ])
  return workspace.id
}

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-real-ip': nextIp(), ...headers }),
    body: JSON.stringify(body),
  })
}

async function sealedModelWidget(): Promise<string> {
  const sessionId = await sessionWithDocument()
  const { widget_key } = await memoryStore.createWidget(sessionId, {
    name: 'Acme',
    title: 'Acme',
    welcome_message: 'Hi',
    primary_color: '#123456',
    position: 'bottom-right',
    size: 'medium',
    allowed_domains: [],
    allowed_origins: [ALLOWED],
    sealed: true,
  })
  return sealWidgetTokenV2({ source: { kind: 'memory', widgetKey: widget_key }, origins: [ALLOWED], model: MODEL })
}

beforeAll(() => {
  savedTokenKey = process.env.EMBED_TOKEN_KEY
  process.env.EMBED_TOKEN_KEY = TEST_TOKEN_KEY
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

beforeEach(() => {
  mockedOwner.mockClear()
  mockedDemo.mockClear()
  mockedCreate.mockClear()
})

afterAll(() => {
  if (savedTokenKey === undefined) delete process.env.EMBED_TOKEN_KEY
  else process.env.EMBED_TOKEN_KEY = savedTokenKey
  jest.restoreAllMocks()
})

describe('widget chat with an owner model', () => {
  it('answers with the owner model and never the demo model', async () => {
    const owner = fakeOwner(answerOrReword)
    mockedOwner.mockReturnValue(owner)
    const key = await sealedModelWidget()

    const res = await widgetChat(
      jsonRequest('http://localhost/api/widget/chat', { message: 'Opening hours?', widgetKey: key }, { origin: ALLOWED }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).message).toBe('Owner model answer')
    expect(mockedOwner).toHaveBeenCalledWith(MODEL)
    expect(owner.complete).toHaveBeenCalledTimes(1)
    expect(mockedDemo).not.toHaveBeenCalled()
  })

  it('returns 503 with the policy CORS headers when the owner model fails, without falling back', async () => {
    const owner = fakeOwner(() => Promise.reject(new ModelError('model_unreachable')))
    mockedOwner.mockReturnValue(owner)
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    const key = await sealedModelWidget()

    const res = await widgetChat(
      jsonRequest('http://localhost/api/widget/chat', { message: 'Opening hours?', widgetKey: key }, { origin: ALLOWED }),
    )

    expect(res.status).toBe(503)
    expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED)
    expect(res.headers.get('vary')).toBe('Origin')
    const body = await res.json()
    expect(body.error).toBe('Widget unavailable')
    expect(body.message).toBe('Sorry, I encountered an error. Please try again.')
    expect(mockedDemo).not.toHaveBeenCalled()
    const logged = error.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('code=model_unreachable')
    expect(logged).not.toContain(MODEL.baseUrl)
    expect(logged).not.toContain(MODEL.apiKey)
    error.mockRestore()
  })
})

describe('widget generate with an owner model', () => {
  const modelToken = () => sealModelToken(MODEL)

  it('refuses a model without allowed sites before creating anything', async () => {
    const sessionId = await sessionWithDocument()

    const res = await generate(
      jsonRequest('http://localhost/api/widget/generate', { sessionId, title: 't' }, { [MODEL_TOKEN_HEADER]: modelToken() }),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'Add at least one allowed site before generating an embed that uses your own model.',
      code: 'origins_required',
    })
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('issues a sealed sbw2_ token and returns no model fields', async () => {
    const sessionId = await sessionWithDocument()

    const res = await generate(
      jsonRequest(
        'http://localhost/api/widget/generate',
        { sessionId, title: 't', allowed_origins: [ALLOWED] },
        { [MODEL_TOKEN_HEADER]: modelToken() },
      ),
    )

    expect(res.status).toBe(200)
    const text = await res.text()
    for (const secret of [MODEL.apiKey, MODEL.baseUrl, 'models.example', 'pathsentinel-q9z4', MODEL.model]) {
      expect(text).not.toContain(secret)
    }
    const body = JSON.parse(text)
    expect(mockedCreate).toHaveBeenCalledTimes(1)
    expect(mockedCreate.mock.calls[0][1]).toMatchObject({ sealed: true, allowed_origins: [ALLOWED] })
    expect(body.widgetKey).toMatch(/^sbw2_/)
    expect(body.widget.widget_key).toBe(body.widgetKey)
    expect(text).not.toMatch(/"widget-[0-9a-f]{32}"/)

    // The token resolves to the owner model, and the plain memory key behind it is sealed
    const owner = fakeOwner(answerOrReword)
    mockedOwner.mockReturnValue(owner)
    const chat = await widgetChat(
      jsonRequest('http://localhost/api/widget/chat', { message: 'Hours?', widgetKey: body.widgetKey }, { origin: ALLOWED }),
    )
    expect(chat.status).toBe(200)
    expect(mockedOwner).toHaveBeenCalledWith(MODEL)
    expect(mockedDemo).not.toHaveBeenCalled()
  })

  it('refuses a wrong-purpose model header', async () => {
    const sessionId = await sessionWithDocument()
    const res = await generate(
      jsonRequest(
        'http://localhost/api/widget/generate',
        { sessionId, title: 't', allowed_origins: [ALLOWED] },
        { [MODEL_TOKEN_HEADER]: 'sbb1_abc' },
      ),
    )
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('model_token_wrong_purpose')
  })
})

describe('preview chat with an owner model', () => {
  it('sends both the rewording and the answer to the owner model (D9)', async () => {
    const owner = fakeOwner(answerOrReword)
    mockedOwner.mockReturnValue(owner)
    const sessionId = await sessionWithDocument()

    const res = await previewChat(
      jsonRequest('http://localhost/api/chat', { message: 'Opening hours?', sessionId }, { [MODEL_TOKEN_HEADER]: sealModelToken(MODEL) }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).message).toBe('Owner model answer')
    expect(mockedOwner).toHaveBeenCalledWith(MODEL)
    expect(owner.complete).toHaveBeenCalledTimes(2)
    expect(owner.complete.mock.calls.map(([req]) => !!req.jsonObject)).toEqual([true, false])
    expect(mockedDemo).not.toHaveBeenCalled()
  })

  it('returns 502 with the code and a fixed message when the owner model fails', async () => {
    const owner = fakeOwner((req) =>
      req.jsonObject ? answerOrReword(req) : Promise.reject(new ModelError('model_http_error', 500)),
    )
    mockedOwner.mockReturnValue(owner)
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    const sessionId = await sessionWithDocument()

    const res = await previewChat(
      jsonRequest('http://localhost/api/chat', { message: 'Opening hours?', sessionId }, { [MODEL_TOKEN_HEADER]: sealModelToken(MODEL) }),
    )

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({
      error: 'Failed to generate response',
      code: 'model_http_error',
      details: 'The provider returned an error (HTTP 500).',
    })
    expect(mockedDemo).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('keeps the demo missing-key response unchanged', async () => {
    const savedGroq = process.env.GROQ_API_KEY
    delete process.env.GROQ_API_KEY
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await previewChat(jsonRequest('http://localhost/api/chat', { message: 'Hello?' }))

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Failed to generate response', details: 'GROQ_API_KEY is not set' })
      expect(mockedDemo).toHaveBeenCalled()
      expect(mockedOwner).not.toHaveBeenCalled()
    } finally {
      if (savedGroq !== undefined) process.env.GROQ_API_KEY = savedGroq
      error.mockRestore()
    }
  })
})
