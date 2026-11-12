/** @jest-environment node */
// Runs only with TEST_DATABASE_URL. "Your assistants": edits to an assistant
// already on a site take effect through the SAME embed code.
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { GET as listWidgets, PATCH as editWidget } from '../../../app/api/storage/widgets/route'
import { GET as widgetScript } from '../../../app/api/widget/script/[key]/route'
import { validateConnectionString, type ParsedConnection } from '../connection'
import { STORAGE_TOKEN_HEADER } from '../errors'
import { MODEL_TOKEN_HEADER } from '../../model/shared'
import { discardPool, getPool } from '../pg-pool'
import { createPostgresStore } from '../pg-store'
import { resolveWidget } from '../resolve'
import { ensureSchema } from '../schema'
import { sealAutomationKey, sealBuilderToken, sealModelToken, sealWidgetToken, sealWidgetTokenV2 } from '../token'

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip

run('Your assistants: edit in place, same embed code', () => {
  const savedEnv = process.env
  let conn: ParsedConnection
  let ws: string
  let otherWs: string
  let widgetId: string
  let builder: string
  let otherBuilder: string
  let embed: string
  const workspaces: string[] = []

  const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new NextRequest(new URL(url, 'http://localhost'), { method: init.method ?? 'GET', headers: init.headers, body: init.body })
  const edit = (body: Record<string, unknown>, headers: Record<string, string> = { [STORAGE_TOKEN_HEADER]: builder }, id = widgetId) =>
    editWidget(req(`/api/storage/widgets?id=${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }))
  const base = { title: 'Ask Anuj', welcomeMessage: 'Hi there', primaryColor: '#14425C', position: 'bottom-left', size: 'large', instructions: 'Call him Anuj, never I.' }

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    process.env = { ...savedEnv, EMBED_TOKEN_KEY: randomBytes(32).toString('base64'), ALLOW_PRIVATE_DB_HOSTS: '1' }
    const v = validateConnectionString(process.env.TEST_DATABASE_URL, { allowPrivate: true })
    if (!v.ok) throw new Error('bad TEST_DATABASE_URL')
    conn = v.connection
    await ensureSchema(await getPool(conn))
    const store = createPostgresStore(conn, '00000000-0000-0000-0000-000000000000')
    ws = (await store.createWorkspace()).id
    otherWs = (await store.createWorkspace()).id
    workspaces.push(ws, otherWs)
    const widget = await createPostgresStore(conn, ws).createWidget(ws, {
      name: 'site', title: 'Old title', welcome_message: 'Old welcome', primary_color: '#3b82f6', position: 'bottom-right', size: 'medium', allowed_domains: [],
    })
    widgetId = widget.id
    builder = sealBuilderToken({ conn: conn.normalized, workspaceId: ws })
    otherBuilder = sealBuilderToken({ conn: conn.normalized, workspaceId: otherWs })
    embed = sealWidgetToken({ conn: conn.normalized, workspaceId: ws, widgetId })
  })

  afterAll(async () => {
    try {
      await (await getPool(conn)).query('DELETE FROM support_bot.workspaces WHERE id = ANY($1::uuid[])', [workspaces])
    } finally {
      await discardPool(conn)
      process.env = savedEnv
      jest.restoreAllMocks()
    }
  })

  it('lists the assistant, with nothing saved over the embed code yet', async () => {
    const res = await listWidgets(req('/api/storage/widgets', { headers: { [STORAGE_TOKEN_HEADER]: builder } }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.settingsAvailable).toBe(true)
    expect(body.assistants).toHaveLength(1)
    expect(body.assistants[0]).toMatchObject({ id: widgetId, title: 'Old title', starterQuestions: null, allowedOrigins: null, model: 'embed' })
  })

  it('an edit is served by the existing embed code: appearance, questions, sites, instructions', async () => {
    const res = await edit({ ...base, starterQuestions: ['What do you offer?', '  '], allowedOrigins: ['https://anujmahajan.com'] })
    expect(res.status).toBe(200)
    const script = await (await widgetScript(req(`/api/widget/script/${embed}`, { headers: { referer: 'https://anujmahajan.com/' } }), { params: Promise.resolve({ key: embed }) })).text()
    expect(script).toContain('"Ask Anuj"')
    expect(script).toContain('"Hi there"')
    expect(script).toContain('"#14425c"')
    expect(script).toContain('"bottom-left"')
    expect(script).toContain('const savedStarters = ["What do you offer?"]')
    const resolved = await resolveWidget(embed)
    if (!resolved.ok || resolved.ctx.kind === 'connector') throw new Error('widget did not resolve')
    expect(resolved.ctx.access).toEqual({ kind: 'exact', origins: ['https://anujmahajan.com'] })
    expect(resolved.ctx.widget.system_prompt).toBe('Call him Anuj, never I.')
    // And another site is now refused the script.
    const refused = await widgetScript(req(`/api/widget/script/${embed}`, { headers: { referer: 'https://elsewhere.example/' } }), { params: Promise.resolve({ key: embed }) })
    expect(refused.status).toBe(403)
  })

  it('saved sites win over the sites sealed in the embed code', async () => {
    const v2 = sealWidgetTokenV2({ source: { kind: 'postgres', conn: conn.normalized, workspaceId: ws, widgetId }, origins: ['https://old.example'] })
    const resolved = await resolveWidget(v2)
    if (!resolved.ok || resolved.ctx.kind === 'connector') throw new Error('widget did not resolve')
    expect(resolved.ctx.access).toEqual({ kind: 'exact', origins: ['https://anujmahajan.com'] })
  })

  it('switches to the builder model, and never opens an own-model assistant to every site', async () => {
    const model = sealModelToken({ baseUrl: 'https://api.example.com/v1', model: 'm1', apiKey: 'k' })
    expect((await edit({ ...base, model: 'builder', allowedOrigins: [] }, { [STORAGE_TOKEN_HEADER]: builder, [MODEL_TOKEN_HEADER]: model })).status).toBe(400)
    expect((await edit({ ...base, model: 'builder' })).status).toBe(400) // no model connected in the builder
    expect((await edit({ ...base, model: 'builder', allowedOrigins: ['https://anujmahajan.com'] }, { [STORAGE_TOKEN_HEADER]: builder, [MODEL_TOKEN_HEADER]: model })).status).toBe(200)
    const v2 = sealWidgetTokenV2({ source: { kind: 'postgres', conn: conn.normalized, workspaceId: ws, widgetId }, origins: ['https://old.example'] })
    let r = await resolveWidget(v2)
    if (!r.ok || r.ctx.kind === 'connector') throw new Error('widget did not resolve')
    expect(r.ctx.model).toEqual({ baseUrl: 'https://api.example.com/v1', model: 'm1', apiKey: 'k' })
    // Emptying the list later (model kept) falls back to the sealed sites, not "any site".
    expect((await edit({ ...base, model: 'keep', allowedOrigins: [] })).status).toBe(200)
    r = await resolveWidget(v2)
    if (!r.ok || r.ctx.kind === 'connector') throw new Error('widget did not resolve')
    expect(r.ctx.access).toEqual({ kind: 'exact', origins: ['https://old.example'] })
    // Back to the demo model: no owner model, and the empty list now means any site.
    expect((await edit({ ...base, model: 'demo', allowedOrigins: [] })).status).toBe(200)
    r = await resolveWidget(v2)
    if (!r.ok || r.ctx.kind === 'connector') throw new Error('widget did not resolve')
    expect(r.ctx.model).toBeNull()
    expect(r.ctx.access).toEqual({ kind: 'any' })
    // The sealed model link is never sent back to the browser.
    const listed = await (await listWidgets(req('/api/storage/widgets', { headers: { [STORAGE_TOKEN_HEADER]: builder } }))).json()
    expect(JSON.stringify(listed)).not.toContain('sbm1_')
  })

  it('only the owner of this workspace can edit', async () => {
    const key = sealAutomationKey({ conn: conn.normalized, workspaceId: ws, keyId: '00000000-0000-4000-8000-000000000000' })
    expect((await edit(base, { authorization: `Bearer ${key}` })).status).toBe(403)
    expect((await edit(base, {})).status).toBeGreaterThanOrEqual(400)
    expect((await edit(base, { [STORAGE_TOKEN_HEADER]: otherBuilder })).status).toBe(404)
    expect((await edit(base, { [STORAGE_TOKEN_HEADER]: embed })).status).toBeGreaterThanOrEqual(400)
  })

  it('rejects bad values without saving any of them', async () => {
    expect((await edit({ ...base, title: '' })).status).toBe(400)
    expect((await edit({ ...base, primaryColor: 'red;}' })).status).toBe(400)
    expect((await edit({ ...base, allowedOrigins: ['javascript:alert(1)'] })).status).toBe(400)
    const listed = await (await listWidgets(req('/api/storage/widgets', { headers: { [STORAGE_TOKEN_HEADER]: builder } }))).json()
    expect(listed.assistants[0].title).toBe('Ask Anuj')
  })
})
