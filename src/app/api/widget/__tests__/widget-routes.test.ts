/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../chat/route'
import { GET } from '../script/[key]/route'
import { generateResponse } from '../../../../lib/llm'
import { getCachedEmbedding } from '../../../../lib/rag'
import { memoryStore } from '../../../../lib/storage/memory-store'
import type { WidgetSettings } from '../../../../lib/storage/types'

jest.mock('../../../../lib/llm', () => ({
  generateResponse: jest.fn(async () => ({ message: 'Answer from the model' })),
}))

jest.mock('../../../../lib/rag', () => ({
  getCachedEmbedding: jest.fn(),
}))

jest.mock('../../../../lib/embeddings', () => {
  const actual = jest.requireActual('../../../../lib/embeddings')
  return {
    ...actual,
    generateEmbeddings: jest.fn(() => Promise.reject(new Error('generateEmbeddings must not be called'))),
    generateEmbeddingsBatch: jest.fn(() => Promise.reject(new Error('generateEmbeddingsBatch must not be called'))),
  }
})

const mockedGenerate = generateResponse as jest.MockedFunction<typeof generateResponse>
const mockedEmbedding = getCachedEmbedding as jest.MockedFunction<typeof getCachedEmbedding>

const VECTOR = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))
const TITLE = 'Acme Secret Title'

let exactKey: string
let legacyKey: string
let openKey: string
let ipCounter = 0

function settings(extra: Partial<WidgetSettings>): WidgetSettings {
  return {
    name: 'Acme',
    title: TITLE,
    welcome_message: 'Hello from Acme',
    primary_color: '#123456',
    position: 'bottom-right',
    size: 'medium',
    allowed_domains: [],
    ...extra,
  }
}

function nextIp(): string {
  ipCounter += 1
  return `test-client-${ipCounter}`
}

function chatRequest(widgetKey: string, origin?: string): NextRequest {
  const headers = new Headers({ 'content-type': 'application/json', 'x-real-ip': nextIp() })
  if (origin !== undefined) headers.set('origin', origin)
  return new NextRequest('http://localhost/api/widget/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({ message: 'What are your opening hours?', widgetKey, sessionId: 's1' }),
  })
}

function scriptRequest(key: string, headers: Record<string, string> = {}): [NextRequest, { params: Promise<{ key: string }> }] {
  const h = new Headers({ 'x-real-ip': nextIp(), ...headers })
  return [
    new NextRequest(`http://localhost/api/widget/script/${key}`, { headers: h }),
    { params: Promise.resolve({ key }) },
  ]
}

// A demo widget takes over its session's chunks, so each widget gets its own session.
async function widgetWithDocument(extra: Partial<WidgetSettings>): Promise<string> {
  const workspace = await memoryStore.createWorkspace()
  await memoryStore.storeDocument(workspace.id, 'hours.md', [
    { content: 'We are open 9 to 5 on weekdays.', embedding: VECTOR, index: 0 },
  ])
  return (await memoryStore.createWidget(workspace.id, settings(extra))).widget_key
}

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  exactKey = await widgetWithDocument({ allowed_origins: ['https://example.com'] })
  legacyKey = await widgetWithDocument({ allowed_domains: ['example.com'] })
  openKey = await widgetWithDocument({})
})

beforeEach(() => {
  mockedGenerate.mockClear()
  mockedEmbedding.mockReset()
  mockedEmbedding.mockResolvedValue(VECTOR)
})

afterAll(() => {
  jest.restoreAllMocks()
})

describe('widget chat route', () => {
  describe('exact list', () => {
    it.each([
      ['a different site', 'https://evil.example.net'],
      ['a subdomain', 'https://www.example.com'],
      ['http instead of https', 'http://example.com'],
      ['another port', 'https://example.com:8443'],
      ['a suffix attack', 'https://example.com.evil.com'],
      ['the literal null', 'null'],
      ['a missing Origin', undefined],
    ])('refuses %s with 403 before retrieval or any model call', async (_label, origin) => {
      const hasDocs = jest.spyOn(memoryStore, 'widgetHasDocuments')
      const search = jest.spyOn(memoryStore, 'searchWidgetChunks')

      const res = await POST(chatRequest(exactKey, origin))

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({
        error: 'This widget is not enabled for this site',
        code: 'origin_not_allowed',
      })
      expect(res.headers.get('access-control-allow-origin')).toBeNull()
      expect(res.headers.get('vary')).toBe('Origin')
      expect(hasDocs).not.toHaveBeenCalled()
      expect(search).not.toHaveBeenCalled()
      expect(mockedEmbedding).not.toHaveBeenCalled()
      expect(mockedGenerate).not.toHaveBeenCalled()
      hasDocs.mockRestore()
      search.mockRestore()
    })

    it.each(['https://example.com', 'https://example.com:443'])(
      'answers %s and echoes the origin with Vary: Origin',
      async (origin) => {
        const res = await POST(chatRequest(exactKey, origin))

        expect(res.status).toBe(200)
        expect(res.headers.get('access-control-allow-origin')).toBe(origin)
        expect(res.headers.get('vary')).toBe('Origin')
        const body = await res.json()
        expect(body.message).toBe('Answer from the model')
        expect(body.isEnhanced).toBe(true)
        expect(mockedGenerate).toHaveBeenCalledTimes(1)
      },
    )

    it('keeps the policy headers on a 500 after resolution', async () => {
      mockedGenerate.mockRejectedValueOnce(new Error('boom'))
      const error = jest.spyOn(console, 'error').mockImplementation(() => {})

      const res = await POST(chatRequest(exactKey, 'https://example.com'))

      expect(res.status).toBe(500)
      expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com')
      expect(res.headers.get('vary')).toBe('Origin')
      error.mockRestore()
    })
  })

  describe('no list', () => {
    it.each(['https://anywhere.example.org', undefined])('answers origin %s with ACAO *', async (origin) => {
      const res = await POST(chatRequest(openKey, origin))

      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      expect(res.headers.get('vary')).toBeNull()
      expect(mockedGenerate).toHaveBeenCalledTimes(1)
    })
  })

  describe('legacy allowed_domains', () => {
    it.each(['https://example.com', 'https://shop.example.com'])('accepts %s with ACAO *', async (origin) => {
      const res = await POST(chatRequest(legacyKey, origin))

      expect(res.status).toBe(200)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
    })

    it.each(['https://example.com.evil.com', 'https://notexample.com', undefined])(
      'refuses %s before any model call',
      async (origin) => {
        const res = await POST(chatRequest(legacyKey, origin))

        expect(res.status).toBe(403)
        expect((await res.json()).code).toBe('origin_not_allowed')
        expect(mockedGenerate).not.toHaveBeenCalled()
      },
    )
  })

  it('keeps ACAO * for an unknown widget', async () => {
    const res = await POST(chatRequest('widget-does-not-exist', 'https://example.com'))

    expect(res.status).toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('widget script route', () => {
  async function expectRefused(res: Response) {
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    const body = await res.text()
    expect(body).toBe('// This widget is not enabled for this site')
    expect(body).not.toContain(TITLE)
    expect(body).not.toContain('#123456')
    expect(body).not.toContain(exactKey)
  }

  it('refuses a disallowed Referer', async () => {
    await expectRefused(await GET(...scriptRequest(exactKey, { referer: 'https://evil.example.net/page?x=1' })))
  })

  it('refuses a disallowed Origin', async () => {
    await expectRefused(await GET(...scriptRequest(exactKey, { origin: 'https://www.example.com' })))
  })

  it('checks Origin before Referer', async () => {
    await expectRefused(
      await GET(...scriptRequest(exactKey, { origin: 'https://evil.example.net', referer: 'https://example.com/' })),
    )
  })

  it('serves the script for an allowed Referer', async () => {
    const res = await GET(...scriptRequest(exactKey, { referer: 'https://example.com/pricing' }))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain(TITLE)
  })

  it('serves the script when neither header is present (D2)', async () => {
    const res = await GET(...scriptRequest(exactKey))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.text()
    expect(body).toContain(TITLE)
    expect(body).toContain("This assistant isn't available on this site.")
    expect(() => new Function(body)).not.toThrow()
  })

  it('serves a no-list widget to any site', async () => {
    const res = await GET(...scriptRequest(openKey, { referer: 'https://anywhere.example.org/' }))

    expect(res.status).toBe(200)
  })

  it('does not apply exact matching to a legacy list', async () => {
    const res = await GET(...scriptRequest(legacyKey, { referer: 'https://elsewhere.example.org/' }))

    expect(res.status).toBe(200)
  })

  it('marks a 404 no-store', async () => {
    const res = await GET(...scriptRequest('widget-does-not-exist'))

    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('marks a builder-token 403 no-store', async () => {
    const res = await GET(...scriptRequest('sbb1_abc'))

    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})
