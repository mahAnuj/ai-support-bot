/** @jest-environment node */
// Runs only with TEST_DATABASE_URL. Daily counts and match scores through the
// real chat route; embeddings and the model are stubbed per question.
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST as chat } from '../../../app/api/widget/chat/route'
import { GET as listLog } from '../../../app/api/storage/conversations/route'
import { PUT as putLog } from '../../../app/api/storage/conversations/settings/route'
import { GET as getStats, PUT as putStats } from '../../../app/api/storage/stats/route'
import { generateResponse } from '../../llm'
import { getCachedEmbedding } from '../../rag'
import { ModelError } from '../../model/shared'
import { validateConnectionString, type ParsedConnection } from '../connection'
import { STORAGE_TOKEN_HEADER } from '../errors'
import { discardPool, getPool } from '../pg-pool'
import { createPostgresStore } from '../pg-store'
import { ensureSchema } from '../schema'
import { sealAutomationKey, sealBuilderToken, sealWidgetToken } from '../token'

jest.mock('../../llm', () => ({ ...jest.requireActual('../../llm'), generateResponse: jest.fn() }))
jest.mock('../../rag', () => ({ ...jest.requireActual('../../rag'), getCachedEmbedding: jest.fn() }))
const mockedAnswer = generateResponse as jest.MockedFunction<typeof generateResponse>
const mockedEmbed = getCachedEmbedding as jest.MockedFunction<typeof getCachedEmbedding>

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip
// The stored document points along axis 0; a question's similarity is its first component.
const along = (similarity: number) => Array.from({ length: 384 }, (_, i) => (i === 0 ? similarity : i === 1 ? Math.sqrt(1 - similarity * similarity) : 0))

run('daily stats and match scores', () => {
  const savedEnv = process.env
  let conn: ParsedConnection
  let ws: string
  let builder: string
  let embed: string
  const owner = () => ({ [STORAGE_TOKEN_HEADER]: builder })
  const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new NextRequest(new URL(url, 'http://localhost'), { method: init.method ?? 'GET', headers: init.headers, body: init.body })
  const ask = async (similarity: number, answer: string | Error) => {
    mockedEmbed.mockResolvedValueOnce(along(similarity))
    if (answer instanceof Error) mockedAnswer.mockRejectedValueOnce(answer)
    else mockedAnswer.mockResolvedValueOnce({ message: answer })
    return chat(req('/api/widget/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': randomUUID() }, body: JSON.stringify({ message: 'q', widgetKey: embed, chatId: randomUUID(), logNotice: true }) }))
  }
  const stats = async () => (await getStats(req('/api/storage/stats?days=7', { headers: owner() }))).json()
  const settle = () => new Promise((r) => setTimeout(r, 200))

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    process.env = { ...savedEnv, EMBED_TOKEN_KEY: randomBytes(32).toString('base64'), ALLOW_PRIVATE_DB_HOSTS: '1' }
    const v = validateConnectionString(process.env.TEST_DATABASE_URL, { allowPrivate: true })
    if (!v.ok) throw new Error('bad TEST_DATABASE_URL')
    conn = v.connection
    await ensureSchema(await getPool(conn))
    ws = (await createPostgresStore(conn, '00000000-0000-0000-0000-000000000000').createWorkspace()).id
    const store = createPostgresStore(conn, ws)
    await store.storeDocument(ws, 'pricing.md', [{ content: 'Pricing is fixed per deliverable.', embedding: along(1), index: 0 }])
    const widget = await store.createWidget(ws, { name: 'w', title: 'Ask', welcome_message: 'Hi', primary_color: '#14425c', position: 'bottom-right', size: 'medium', allowed_domains: [] })
    builder = sealBuilderToken({ conn: conn.normalized, workspaceId: ws })
    embed = sealWidgetToken({ conn: conn.normalized, workspaceId: ws, widgetId: widget.id })
  })

  afterAll(async () => {
    try {
      await (await getPool(conn)).query('DELETE FROM support_bot.workspaces WHERE id = $1', [ws])
    } finally {
      await discardPool(conn)
      process.env = savedEnv
      jest.restoreAllMocks()
    }
  })

  it('counts each kind of reply, with mean, lowest and low-match scores', async () => {
    expect((await ask(1, 'Pricing is fixed per deliverable.')).status).toBe(200) // strong match: 100
    expect((await ask(0.2, 'Probably fixed per deliverable.')).status).toBe(200) // weak match: 14, low
    expect((await ask(0, "I don't have that information. Please contact Anuj directly.")).status).toBe(200) // no match, don't know
    expect((await ask(1, new ModelError('model_unavailable'))).status).toBe(503) // failure
    await settle()
    const s = await stats()
    expect(s.available).toBe(true)
    expect(s.enabled).toBe(true)
    expect(s.days).toHaveLength(7)
    expect(s.totals).toEqual({ questions: 4, matched: 2, noMatch: 1, dontKnow: 1, failures: 1, meanScore: 57, minScore: 14, lowScore: 1 })
    const today = s.days[s.days.length - 1]
    expect(today).toMatchObject({ questions: 4, meanScore: 57, minScore: 14 })
  })

  it('records each answer\'s match score in the log, with a low-match filter', async () => {
    await putLog(req('/api/storage/conversations/settings', { method: 'PUT', headers: { ...owner(), 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true }) }))
    await ask(1, 'Strong answer')
    await ask(0.2, 'Weak answer')
    await settle()
    const all = await (await listLog(req('/api/storage/conversations', { headers: owner() }))).json()
    expect(all.turns.map((t: { answer: string; matchScore: number | null }) => [t.answer, t.matchScore])).toEqual([['Weak answer', 14], ['Strong answer', 100]])
    const low = await (await listLog(req('/api/storage/conversations?low=1', { headers: owner() }))).json()
    expect(low.turns.map((t: { answer: string }) => t.answer)).toEqual(['Weak answer'])
    const csv = await (await listLog(req('/api/storage/conversations?format=csv', { headers: owner() }))).text()
    expect(csv.split('\r\n')[0]).toContain('match_score')
  })

  it('stops counting when switched off, and is the owner\'s only', async () => {
    const key = sealAutomationKey({ conn: conn.normalized, workspaceId: ws, keyId: randomUUID() })
    expect((await getStats(req('/api/storage/stats', { headers: { authorization: `Bearer ${key}` } }))).status).toBe(403)
    const before = (await stats()).totals.questions
    expect((await putStats(req('/api/storage/stats', { method: 'PUT', headers: { ...owner(), 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) }))).status).toBe(200)
    await ask(1, 'Not counted')
    await settle()
    const s = await stats()
    expect(s.enabled).toBe(false)
    expect(s.totals.questions).toBe(before)
  })

  it('keeps logging on a log table made before match_score existed', async () => {
    const pool = await getPool(conn)
    await pool.query('ALTER TABLE support_bot.conversations DROP COLUMN match_score')
    try {
      await ask(1, 'Logged without a score column')
      await settle()
      const all = await (await listLog(req('/api/storage/conversations', { headers: owner() }))).json()
      expect(all.turns[0]).toMatchObject({ answer: 'Logged without a score column', matchScore: null })
    } finally {
      await pool.query('ALTER TABLE support_bot.conversations ADD COLUMN IF NOT EXISTS match_score smallint')
    }
  })
})
