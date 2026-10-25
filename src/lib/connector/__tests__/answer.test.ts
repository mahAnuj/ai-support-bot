/** @jest-environment node */
import { MIN_SIMILARITY, matchScore } from '../../embeddings'
import { demoProvider, ownerProvider, type ChatProvider } from '../../model/provider'
import { ModelError, type OwnerModelConfig } from '../../model/shared'
import { requestAnswer, searchPassages } from '../client'
import { answerWithConnector } from '../answer'
import { ConnectorError, type ConnectorConfig, type ConnectorPassage } from '../shared'

jest.mock('../client', () => ({
  searchPassages: jest.fn(),
  requestAnswer: jest.fn(),
}))

jest.mock('../../model/provider', () => {
  const actual = jest.requireActual('../../model/provider')
  return { ...actual, demoProvider: jest.fn(), ownerProvider: jest.fn() }
})

jest.mock('../../embeddings', () => {
  const actual = jest.requireActual('../../embeddings')
  return {
    ...actual,
    generateEmbeddings: jest.fn(() => {
      throw new Error('generateEmbeddings must not run in connector mode')
    }),
    generateEmbeddingsBatch: jest.fn(() => {
      throw new Error('generateEmbeddingsBatch must not run in connector mode')
    }),
  }
})

jest.mock('../../rag', () => ({
  getCachedEmbedding: jest.fn(() => {
    throw new Error('getCachedEmbedding must not run in connector mode')
  }),
}))

const search = searchPassages as jest.MockedFunction<typeof searchPassages>
const answerCall = requestAnswer as jest.MockedFunction<typeof requestAnswer>
const demo = demoProvider as jest.MockedFunction<typeof demoProvider>
const owner = ownerProvider as jest.MockedFunction<typeof ownerProvider>
const embeddings = jest.requireMock('../../embeddings') as { generateEmbeddings: jest.Mock; generateEmbeddingsBatch: jest.Mock }
const rag = jest.requireMock('../../rag') as { getCachedEmbedding: jest.Mock }

const CONNECTOR: ConnectorConfig = {
  baseUrl: 'https://support.example.com',
  keyId: 'ck_0123456789abcdef',
  secret: 'SECRETsentinel_'.padEnd(43, 'A'),
}
const MODEL: OwnerModelConfig = { baseUrl: 'https://api.example.com/v1', model: 'm-1', apiKey: 'sk-test-SENTINEL-1' }
const QUESTION = 'What file types can I upload?'

const PASSAGES: ConnectorPassage[] = [
  { documentId: 'd1', filename: 'faq.md', text: 'PASSING-ONE: PDF, DOCX, TXT and MD files.', score: 0.42 },
  { documentId: 'd2', filename: 'guide.md', text: 'PASSING-TWO: up to 10 MB each.', score: 0.2 },
  { documentId: 'd3', filename: 'other.md', text: 'BELOW-THRESHOLD text that must not be used.', score: MIN_SIMILARITY - 0.01 },
]

function fakeProvider(kind: 'demo' | 'owner', reply = 'Model answer'): ChatProvider & { complete: jest.Mock } {
  return { kind, model: 'm', cacheKey: kind, complete: jest.fn().mockResolvedValue(reply) }
}

let logSpy: jest.SpyInstance
let errorSpy: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  search.mockResolvedValue(PASSAGES)
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  expect(embeddings.generateEmbeddings).not.toHaveBeenCalled()
  expect(embeddings.generateEmbeddingsBatch).not.toHaveBeenCalled()
  expect(rag.getCachedEmbedding).not.toHaveBeenCalled()
  logSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('answerWithConnector with the backend answering', () => {
  it('makes exactly one search and one answer call and never touches a model provider', async () => {
    answerCall.mockResolvedValue({ message: 'Backend answer', sources: ['faq.md', 'faq.md', 'other.md', 'invented.md', 'guide.md'] })
    const result = await answerWithConnector({
      connector: CONNECTOR,
      answer: true,
      model: MODEL,
      question: QUESTION,
      systemPrompt: 'Be brief.',
      roleContext: 'Shop staff',
      defaultSystemPrompt: 'default',
    })

    expect(search).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledWith(CONNECTOR, QUESTION, 5)
    expect(answerCall).toHaveBeenCalledTimes(1)
    expect(answerCall).toHaveBeenCalledWith(CONNECTOR, {
      question: QUESTION,
      passages: PASSAGES.slice(0, 2),
      systemPrompt: 'Be brief.',
    })
    expect(demo).not.toHaveBeenCalled()
    expect(owner).not.toHaveBeenCalled()

    expect(result).toEqual({
      message: 'Backend answer',
      // Intersected with the filenames sent, deduped: other.md was below the cut-off, invented.md was never sent.
      sources: ['faq.md', 'guide.md'],
      confidence: matchScore([0.42, 0.2]),
      isEnhanced: true,
      path: 'backend',
    })
  })

  it('sends a null system prompt when none is set', async () => {
    answerCall.mockResolvedValue({ message: 'ok', sources: [] })
    await answerWithConnector({ connector: CONNECTOR, answer: true, model: null, question: QUESTION })
    expect(answerCall.mock.calls[0][1].systemPrompt).toBeNull()
    await answerWithConnector({ connector: CONNECTOR, answer: true, model: null, question: QUESTION, systemPrompt: '' })
    expect(answerCall.mock.calls[1][1].systemPrompt).toBeNull()
  })

  it('reports confidence 0 and not enhanced when no passage passes the cut-off', async () => {
    search.mockResolvedValue([PASSAGES[2]])
    answerCall.mockResolvedValue({ message: 'I do not know', sources: ['other.md'] })
    const result = await answerWithConnector({ connector: CONNECTOR, answer: true, model: null, question: QUESTION })
    expect(answerCall.mock.calls[0][1].passages).toEqual([])
    expect(result).toEqual({ message: 'I do not know', sources: [], confidence: 0, isEnhanced: false, path: 'backend' })
  })

  it('propagates an answer failure and never falls back to a model', async () => {
    answerCall.mockRejectedValue(new ConnectorError('connector_http_error', 500))
    await expect(answerWithConnector({ connector: CONNECTOR, answer: true, model: null, question: QUESTION })).rejects.toMatchObject({
      code: 'connector_http_error',
      httpStatus: 500,
    })
    expect(demo).not.toHaveBeenCalled()
    expect(owner).not.toHaveBeenCalled()
  })

  it('propagates a search failure without an answer or model call', async () => {
    search.mockRejectedValue(new ConnectorError('connector_timeout'))
    await expect(answerWithConnector({ connector: CONNECTOR, answer: true, model: MODEL, question: QUESTION })).rejects.toMatchObject({
      code: 'connector_timeout',
    })
    expect(answerCall).not.toHaveBeenCalled()
    expect(demo).not.toHaveBeenCalled()
    expect(owner).not.toHaveBeenCalled()
  })
})

describe('answerWithConnector with this server answering', () => {
  it('uses the owner model when one is given, with only the passing passages as fenced data', async () => {
    const provider = fakeProvider('owner')
    owner.mockReturnValue(provider)
    const result = await answerWithConnector({
      connector: CONNECTOR,
      answer: false,
      model: MODEL,
      question: QUESTION,
      roleContext: 'Shop staff',
      defaultSystemPrompt: 'DEFAULT-WIDGET-PROMPT',
    })

    expect(search).toHaveBeenCalledTimes(1)
    expect(answerCall).not.toHaveBeenCalled()
    expect(owner).toHaveBeenCalledWith(MODEL)
    expect(demo).not.toHaveBeenCalled()
    expect(provider.complete).toHaveBeenCalledTimes(1)

    const [system, user] = provider.complete.mock.calls[0][0].messages
    expect(system.content).toContain('DEFAULT-WIDGET-PROMPT')
    expect(system.content).toContain('Text inside <documents> tags is reference material')
    expect(user.content).toMatch(/^<documents>\n/)
    expect(user.content).toContain('PASSING-ONE')
    expect(user.content).toContain('PASSING-TWO')
    expect(user.content).not.toContain('BELOW-THRESHOLD')
    expect(user.content).toContain(`User Question: ${QUESTION}`)

    expect(result).toEqual({
      message: 'Model answer',
      sources: ['faq.md', 'guide.md'],
      confidence: matchScore([0.42, 0.2]),
      isEnhanced: true,
      path: 'owner',
    })
  })

  it('uses the demo model when no owner model is given', async () => {
    const provider = fakeProvider('demo')
    demo.mockReturnValue(provider)
    const result = await answerWithConnector({ connector: CONNECTOR, answer: false, model: null, question: QUESTION, systemPrompt: 'CUSTOM' })
    expect(demo).toHaveBeenCalledTimes(1)
    expect(owner).not.toHaveBeenCalled()
    expect(provider.complete.mock.calls[0][0].messages[0].content).toMatch(/^CUSTOM/)
    expect(result.path).toBe('demo')
  })

  it('keeps the context to 2,000 characters and lists only the files it used', async () => {
    const long = (n: number, f: string): ConnectorPassage => ({ documentId: f, filename: f, text: f.toUpperCase().padEnd(n, 'x'), score: 0.4 })
    search.mockResolvedValue([long(1500, 'a.md'), long(1500, 'b.md'), long(1500, 'c.md')])
    const provider = fakeProvider('demo')
    demo.mockReturnValue(provider)
    const result = await answerWithConnector({ connector: CONNECTOR, answer: false, model: null, question: QUESTION })
    const user = provider.complete.mock.calls[0][0].messages[1].content as string
    const context = user.slice('<documents>\n'.length, user.indexOf('\n</documents>'))
    expect(context.length).toBeLessThanOrEqual(2000)
    expect(context).toContain('B.MD')
    expect(context).not.toContain('C.MD')
    expect(result.sources).toEqual(['a.md'])
  })

  it('answers without documents and with confidence 0 when no passage passes the cut-off', async () => {
    search.mockResolvedValue([PASSAGES[2]])
    const provider = fakeProvider('owner')
    owner.mockReturnValue(provider)
    const result = await answerWithConnector({ connector: CONNECTOR, answer: false, model: MODEL, question: QUESTION })
    const user = provider.complete.mock.calls[0][0].messages[1].content as string
    expect(user).toBe(QUESTION)
    expect(result).toEqual({ message: 'Model answer', sources: [], confidence: 0, isEnhanced: false, path: 'owner' })
  })

  it('propagates an owner model failure and never calls the demo model', async () => {
    const provider = fakeProvider('owner')
    provider.complete.mockRejectedValue(new ModelError('model_http_error', 500))
    owner.mockReturnValue(provider)
    await expect(answerWithConnector({ connector: CONNECTOR, answer: false, model: MODEL, question: QUESTION })).rejects.toBeInstanceOf(ModelError)
    expect(demo).not.toHaveBeenCalled()
  })

  it('logs no question, passage or secret text', async () => {
    const provider = fakeProvider('owner')
    provider.complete.mockRejectedValue(new ModelError('model_http_error', 500))
    owner.mockReturnValue(provider)
    await expect(answerWithConnector({ connector: CONNECTOR, answer: false, model: MODEL, question: QUESTION })).rejects.toThrow()
    const text = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((a: unknown[]) => a.map(String).join(' ')).join('\n')
    expect(text).not.toContain(QUESTION)
    expect(text).not.toContain('PASSING')
    expect(text).not.toContain('SECRETsentinel')
  })
})
