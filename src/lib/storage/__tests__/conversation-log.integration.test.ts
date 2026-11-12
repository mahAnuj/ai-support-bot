/** @jest-environment node */
// Runs only with TEST_DATABASE_URL. The conversation log through the real
// widget and builder routes; the model and embeddings are stubbed.
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST as chat } from '../../../app/api/widget/chat/route'
import { POST as widgetStatus } from '../../../app/api/widget/status/route'
import { DELETE as deleteLog, GET as listLog } from '../../../app/api/storage/conversations/route'
import { GET as getSettings, PUT as putSettings } from '../../../app/api/storage/conversations/settings/route'
import { validateConnectionString, type ParsedConnection } from '../connection'
import { STORAGE_TOKEN_HEADER } from '../errors'
import { discardPool, getPool } from '../pg-pool'
import { createPostgresStore } from '../pg-store'
import { ensureSchema } from '../schema'
import { sealAutomationKey, sealBuilderToken, sealWidgetToken } from '../token'

jest.mock('../../llm', () => ({ ...jest.requireActual('../../llm'), generateResponse: jest.fn(async () => ({ message: 'Pricing is fixed per deliverable.' })) }))
jest.mock('../../rag', () => ({ ...jest.requireActual('../../rag'), getCachedEmbedding: jest.fn(async () => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))) }))

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip
const vec = () => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))

run('conversation log', () => {
  const savedEnv = process.env
  let conn: ParsedConnection
  let ws: string
  let builder: string
  let embed: string
  const owner = () => ({ [STORAGE_TOKEN_HEADER]: builder })
  const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new NextRequest(new URL(url, 'http://localhost'), { method: init.method ?? 'GET', headers: init.headers, body: init.body })
  const ask = (message: string, logNotice: boolean, chatId: string = randomUUID()) =>
    chat(req('/api/widget/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': randomUUID() }, body: JSON.stringify({ message, widgetKey: embed, chatId, logNotice }) }))
  const setLog = (enabled: boolean, retentionDays: unknown = 90) =>
    putSettings(req('/api/storage/conversations/settings', { method: 'PUT', headers: { ...owner(), 'content-type': 'application/json' }, body: JSON.stringify({ enabled, retentionDays }) }))
  const rows = async () => (await (await getPool(conn)).query('SELECT question, matched, chat_id FROM support_bot.conversations WHERE workspace_id = $1 ORDER BY created_at', [ws])).rows
  const settle = () => new Promise((r) => setTimeout(r, 150))

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    process.env = { ...savedEnv, EMBED_TOKEN_KEY: randomBytes(32).toString('base64'), ALLOW_PRIVATE_DB_HOSTS: '1' }
    const v = validateConnectionString(process.env.TEST_DATABASE_URL, { allowPrivate: true })
    if (!v.ok) throw new Error('bad TEST_DATABASE_URL')
    conn = v.connection
    await ensureSchema(await getPool(conn))
    ws = (await createPostgresStore(conn, '00000000-0000-0000-0000-000000000000').createWorkspace()).id
    const store = createPostgresStore(conn, ws)
    await store.storeDocument(ws, 'pricing.md', [{ content: 'Pricing is fixed per deliverable.', embedding: vec(), index: 0 }])
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

  it('is off by default: nothing is logged, and the widget is told so', async () => {
    expect(await (await getSettings(req('/api/storage/conversations/settings', { headers: owner() }))).json()).toEqual({ enabled: false, retentionDays: 90, available: true })
    expect(await (await widgetStatus(req('/api/widget/status', { method: 'POST', body: JSON.stringify({ widgetKey: embed }) }))).json()).toEqual({ logging: false })
    expect((await ask('How does pricing work?', true)).status).toBe(200)
    await settle()
    expect(await rows()).toHaveLength(0)
  })

  it('once on, logs a question only when the widget showed the notice', async () => {
    const saved = await (await setLog(true, '30')).json()
    expect(saved).toEqual({ enabled: true, retentionDays: 30, available: true })
    expect(await (await widgetStatus(req('/api/widget/status', { method: 'POST', body: JSON.stringify({ widgetKey: embed }) }))).json()).toEqual({ logging: true })
    const chatId = randomUUID()
    await ask('How does pricing work?', true, chatId)
    await ask('Sent before the notice appeared', false)
    await settle()
    const r = await rows()
    expect(r.map((x) => x.question)).toEqual(['How does pricing work?'])
    expect(r[0]).toMatchObject({ matched: true, chat_id: chatId })
  })

  it('lists entries newest first, filters unmatched, and exports a formula-safe CSV', async () => {
    const pool = await getPool(conn)
    await pool.query("INSERT INTO support_bot.conversations (id, workspace_id, question, answer, matched) VALUES ($1, $2, '=HYPERLINK(\"x\")', 'no idea', false)", [randomUUID(), ws])
    const all = await (await listLog(req('/api/storage/conversations', { headers: owner() }))).json()
    expect(all.turns.map((t: { question: string }) => t.question)).toEqual(['=HYPERLINK("x")', 'How does pricing work?'])
    const unmatched = await (await listLog(req('/api/storage/conversations?unmatched=1', { headers: owner() }))).json()
    expect(unmatched.turns).toHaveLength(1)
    const csv = await (await listLog(req('/api/storage/conversations?format=csv', { headers: owner() }))).text()
    expect(csv.split('\r\n')[0]).toBe('time,chat,question,answer,matched_documents,match_score,sources')
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m)
  })

  it('deletes entries older than the retention period', async () => {
    const pool = await getPool(conn)
    await pool.query("INSERT INTO support_bot.conversations (id, workspace_id, question, answer, matched, created_at) VALUES ($1, $2, 'ancient', 'a', true, now() - interval '40 days')", [randomUUID(), ws])
    await ask('A new question', true)
    await settle()
    expect((await rows()).map((x) => x.question)).not.toContain('ancient')
    // Shortening the period applies at once.
    await pool.query("UPDATE support_bot.conversations SET created_at = now() - interval '10 days' WHERE workspace_id = $1 AND question = 'A new question'", [ws])
    await setLog(true, 7)
    expect((await rows()).map((x) => x.question)).not.toContain('A new question')
  })

  it('is the owner\'s only: keys and embed codes are refused', async () => {
    const key = sealAutomationKey({ conn: conn.normalized, workspaceId: ws, keyId: randomUUID() })
    expect((await listLog(req('/api/storage/conversations', { headers: { authorization: `Bearer ${key}` } }))).status).toBe(403)
    expect((await listLog(req('/api/storage/conversations', { headers: { [STORAGE_TOKEN_HEADER]: embed } }))).status).toBeGreaterThanOrEqual(400)
    expect((await deleteLog(req('/api/storage/conversations', { method: 'DELETE', headers: { authorization: `Bearer ${key}` } }))).status).toBe(403)
  })

  it('delete all empties the log; turning it off stops logging', async () => {
    expect((await (await deleteLog(req('/api/storage/conversations', { method: 'DELETE', headers: owner() }))).json()).deleted).toBeGreaterThan(0)
    await setLog(false)
    await ask('After switching off', true)
    await settle()
    expect(await rows()).toHaveLength(0)
  })
})
