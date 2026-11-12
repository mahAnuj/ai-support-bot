/** @jest-environment node */
// Runs only with TEST_DATABASE_URL. Projects: one per site, in one database.
import { randomBytes, randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { GET as listProjects, POST as projectAction } from '../../../app/api/storage/projects/route'
import { GET as listDocuments } from '../../../app/api/storage/documents/route'
import { GET as listAssistants } from '../../../app/api/storage/widgets/route'
import { validateConnectionString, type ParsedConnection } from '../connection'
import { STORAGE_TOKEN_HEADER } from '../errors'
import { discardPool, getPool } from '../pg-pool'
import { createPostgresStore } from '../pg-store'
import { ensureSchema } from '../schema'
import { openBuilderToken, sealAutomationKey, sealBuilderToken, sealWidgetToken } from '../token'

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip
const vec = () => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))

run('projects', () => {
  const savedEnv = process.env
  let conn: ParsedConnection
  let siteA: string
  let builderA: string
  const created: string[] = []
  const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new NextRequest(new URL(url, 'http://localhost'), { method: init.method ?? 'GET', headers: init.headers, body: init.body })
  const act = (token: string, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    projectAction(req('/api/storage/projects', { method: 'POST', headers: { [STORAGE_TOKEN_HEADER]: token, 'content-type': 'application/json', 'x-real-ip': randomUUID(), ...headers }, body: JSON.stringify(body) }))
  const docsOf = async (token: string) => (await (await listDocuments(req('/api/storage/documents', { headers: { [STORAGE_TOKEN_HEADER]: token } }))).json()).documents.map((d: { filename: string }) => d.filename)

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    process.env = { ...savedEnv, EMBED_TOKEN_KEY: randomBytes(32).toString('base64'), ALLOW_PRIVATE_DB_HOSTS: '1' }
    const v = validateConnectionString(process.env.TEST_DATABASE_URL, { allowPrivate: true })
    if (!v.ok) throw new Error('bad TEST_DATABASE_URL')
    conn = v.connection
    await ensureSchema(await getPool(conn))
    siteA = (await createPostgresStore(conn, '00000000-0000-0000-0000-000000000000').createWorkspace()).id
    created.push(siteA)
    const store = createPostgresStore(conn, siteA)
    await store.storeDocument(siteA, 'anujmahajan-services.md', [{ content: 'Services.', embedding: vec(), index: 0 }])
    await store.createWidget(siteA, { name: 'a', title: 'Ask Anuj', welcome_message: 'Hi', primary_color: '#14425c', position: 'bottom-right', size: 'medium', allowed_domains: [] })
    builderA = sealBuilderToken({ conn: conn.normalized, workspaceId: siteA })
  })

  afterAll(async () => {
    try {
      await (await getPool(conn)).query('DELETE FROM support_bot.workspaces WHERE id = ANY($1::uuid[])', [created])
    } finally {
      await discardPool(conn)
      process.env = savedEnv
      jest.restoreAllMocks()
    }
  })

  it('creates a new project with its own, empty documents and assistants', async () => {
    const res = await act(builderA, { action: 'create', name: '  shubhagya.com  ' })
    expect(res.status).toBe(200)
    const body = await res.json()
    created.push(body.id)
    expect(openBuilderToken(body.token)?.workspaceId).toBe(body.id)
    expect(await docsOf(body.token)).toEqual([])
    const assistants = await (await listAssistants(req('/api/storage/widgets', { headers: { [STORAGE_TOKEN_HEADER]: body.token } }))).json()
    expect(assistants.assistants).toEqual([])
    // ...and the first project is untouched.
    expect(await docsOf(builderA)).toEqual(['anujmahajan-services.md'])

    const list = await (await listProjects(req('/api/storage/projects', { headers: { [STORAGE_TOKEN_HEADER]: body.token } }))).json()
    const mine = list.projects.filter((p: { id: string }) => created.includes(p.id))
    expect(list.namesAvailable).toBe(true)
    // The database is identified by its address only: never the login or password.
    expect(list.database.key).toMatch(/^[0-9a-f]{8}$/)
    expect(list.database.label).toBe(`${conn.database} on ${conn.host}`)
    expect(JSON.stringify(list.database)).not.toContain(conn.password)
    expect(mine.find((p: { id: string }) => p.id === siteA)).toMatchObject({ documents: 1, assistants: 1, current: false })
    expect(mine.find((p: { id: string }) => p.id === body.id)).toMatchObject({ name: 'shubhagya.com', documents: 0, assistants: 0, current: true })
  })

  it('switches back, renames, and refuses unknown projects and empty names', async () => {
    const other = created[1]
    const tokenB = sealBuilderToken({ conn: conn.normalized, workspaceId: other })
    const back = await (await act(tokenB, { action: 'switch', id: siteA })).json()
    expect(openBuilderToken(back.token)?.workspaceId).toBe(siteA)
    expect(await docsOf(back.token)).toEqual(['anujmahajan-services.md'])
    expect((await act(back.token, { action: 'rename', id: siteA, name: 'anujmahajan.com' })).status).toBe(200)
    const list = await (await listProjects(req('/api/storage/projects', { headers: { [STORAGE_TOKEN_HEADER]: back.token } }))).json()
    expect(list.projects.find((p: { id: string }) => p.id === siteA).name).toBe('anujmahajan.com')
    expect((await act(back.token, { action: 'switch', id: randomUUID() })).status).toBe(404)
    expect((await act(back.token, { action: 'create', name: '   ' })).status).toBe(400)
  })

  it('is the owner\'s only: automation keys and embed codes are refused', async () => {
    const key = sealAutomationKey({ conn: conn.normalized, workspaceId: siteA, keyId: randomUUID() })
    const keyRes = await projectAction(req('/api/storage/projects', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'create', name: 'x' }) }))
    expect(keyRes.status).toBe(403)
    const embed = sealWidgetToken({ conn: conn.normalized, workspaceId: siteA, widgetId: randomUUID() })
    expect((await listProjects(req('/api/storage/projects', { headers: { [STORAGE_TOKEN_HEADER]: embed } }))).status).toBeGreaterThanOrEqual(400)
  })
})
