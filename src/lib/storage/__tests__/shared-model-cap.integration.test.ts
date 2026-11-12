/** @jest-environment node */
// Runs only with TEST_DATABASE_URL. The shared demo model's daily cap,
// counted in the bot's own database, through the real chat route.
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST as chat } from '../../../app/api/widget/chat/route'
import { GET as getStats } from '../../../app/api/storage/stats/route'
import { generateResponse } from '../../llm'
import { getCachedEmbedding } from '../../rag'
import { claimSharedModelQuestion, resetSharedModelMemory } from '../../shared-model-cap'
import { validateConnectionString, type ParsedConnection } from '../connection'
import { STORAGE_TOKEN_HEADER } from '../errors'
import { discardPool, getPool } from '../pg-pool'
import { createPostgresStore } from '../pg-store'
import { ensureSchema } from '../schema'
import { sealBuilderToken, sealWidgetToken } from '../token'

jest.mock('../../llm', () => ({ ...jest.requireActual('../../llm'), generateResponse: jest.fn() }))
jest.mock('../../rag', () => ({ ...jest.requireActual('../../rag'), getCachedEmbedding: jest.fn() }))
const mockedAnswer = generateResponse as jest.MockedFunction<typeof generateResponse>
const mockedEmbed = getCachedEmbedding as jest.MockedFunction<typeof getCachedEmbedding>

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip
const axis = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))

run('shared model daily cap', () => {
  const savedEnv = process.env
  let conn: ParsedConnection
  const workspaces: string[] = []
  const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new NextRequest(new URL(url, 'http://localhost'), { method: init.method ?? 'GET', headers: init.headers, body: init.body })

  const newBot = async (sites: string[] = []) => {
    const ws = (await createPostgresStore(conn, '00000000-0000-0000-0000-000000000000').createWorkspace()).id
    workspaces.push(ws)
    const store = createPostgresStore(conn, ws)
    await store.storeDocument(ws, 'faq.md', [{ content: 'Answers.', embedding: axis, index: 0 }])
    const widget = await store.createWidget(ws, { name: 'w', title: 'Ask', welcome_message: 'Hi', primary_color: '#14425c', position: 'bottom-right', size: 'medium', allowed_domains: [] })
    if (sites.length) {
      await (await getPool(conn)).query('INSERT INTO support_bot.widget_prefs (widget_id, workspace_id, allowed_origins) VALUES ($1, $2, $3)', [widget.id, ws, sites])
    }
    return { ws, builder: sealBuilderToken({ conn: conn.normalized, workspaceId: ws }), embed: sealWidgetToken({ conn: conn.normalized, workspaceId: ws, widgetId: widget.id }) }
  }
  const ask = (embed: string, origin?: string) => {
    mockedEmbed.mockResolvedValueOnce(axis)
    mockedAnswer.mockResolvedValueOnce({ message: 'An answer.' })
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-real-ip': randomUUID(), ...(origin ? { origin } : {}) }
    return chat(req('/api/widget/chat', { method: 'POST', headers, body: JSON.stringify({ message: 'q', widgetKey: embed }) }))
  }
  const statuses = async (embed: string, n: number, origin?: string) => {
    const out: number[] = []
    for (let i = 0; i < n; i++) out.push((await ask(embed, origin)).status)
    return out
  }

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    process.env = { ...savedEnv, EMBED_TOKEN_KEY: randomBytes(32).toString('base64'), ALLOW_PRIVATE_DB_HOSTS: '1', SHARED_MODEL_DAILY_LIMIT: '3' }
    const v = validateConnectionString(process.env.TEST_DATABASE_URL, { allowPrivate: true })
    if (!v.ok) throw new Error('bad TEST_DATABASE_URL')
    conn = v.connection
    await ensureSchema(await getPool(conn))
  })

  beforeEach(() => { resetSharedModelMemory(); mockedAnswer.mockReset(); mockedEmbed.mockReset() })

  afterAll(async () => {
    try {
      await (await getPool(conn)).query('DELETE FROM support_bot.workspaces WHERE id = ANY($1::uuid[])', [workspaces])
    } finally {
      await discardPool(conn)
      process.env = savedEnv
      jest.restoreAllMocks()
    }
  })

  it('answers up to the cap, then refuses without calling the model, and reports it to the owner', async () => {
    const bot = await newBot()
    for (let i = 0; i < 3; i++) expect((await ask(bot.embed)).status).toBe(200)
    const refused = await ask(bot.embed)
    expect(refused.status).toBe(429)
    expect(await refused.json()).toMatchObject({ code: 'daily_limit', limit: 3, message: expect.stringContaining('try again tomorrow') })
    expect(mockedAnswer).toHaveBeenCalledTimes(3)

    // Another bot has its own allowance.
    expect((await ask((await newBot()).embed)).status).toBe(200)

    const stats = await (await getStats(req('/api/storage/stats?days=7', { headers: { [STORAGE_TOKEN_HEADER]: bot.builder } }))).json()
    expect(stats.sharedModel).toEqual({ limit: 3, usedToday: 3 })
  })

  it('holds across server instances: the database counter is the one that decides', async () => {
    const bot = await newBot()
    expect((await ask(bot.embed)).status).toBe(200)
    expect((await ask(bot.embed)).status).toBe(200)
    resetSharedModelMemory() // a fresh instance: its memory counter is empty
    expect((await ask(bot.embed)).status).toBe(200)
    expect((await ask(bot.embed)).status).toBe(429)
  })

  it("applies a site's own limit or none, only to a bot locked to that site", async () => {
    process.env.SHARED_MODEL_SITE_LIMITS = 'anujmahajan.com=off, https://shubhagya.com=5'
    try {
      // Locked to the site with no limit: past the default 3.
      const mine = await newBot(['https://anujmahajan.com'])
      expect(await statuses(mine.embed, 6, 'https://anujmahajan.com')).toEqual([200, 200, 200, 200, 200, 200])
      // Locked to the site with 5.
      const theirs = await newBot(['https://shubhagya.com'])
      expect(await statuses(theirs.embed, 6, 'https://shubhagya.com')).toEqual([200, 200, 200, 200, 200, 429])
      // Open to every site: naming anujmahajan.com does not lift its limit.
      const open = await newBot()
      expect(await statuses(open.embed, 4, 'https://anujmahajan.com')).toEqual([200, 200, 200, 429])
      // Locked to two sites: a request from the one without its own limit gets the default.
      const both = await newBot(['https://anujmahajan.com', 'https://example.com'])
      expect(await statuses(both.embed, 4, 'https://example.com')).toEqual([200, 200, 200, 429])
    } finally {
      delete process.env.SHARED_MODEL_SITE_LIMITS
    }
  })

  it('never lets concurrent questions past the cap', async () => {
    const { ws } = await newBot()
    // Distinct memory ids, as if each came to a different instance.
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      claimSharedModelQuestion({ id: randomUUID(), database: { connection: conn, workspaceId: ws } }, new Date(), { SHARED_MODEL_DAILY_LIMIT: '5' } as unknown as NodeJS.ProcessEnv)))
    expect(results.filter((r) => r.allowed)).toHaveLength(5)
  })
})
