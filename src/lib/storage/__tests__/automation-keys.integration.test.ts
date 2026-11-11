/** @jest-environment node */
// Runs only with TEST_DATABASE_URL (a disposable database with `CREATE EXTENSION vector`), like pg.integration.
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { DELETE as deleteDocument, GET as listDocuments } from '../../../app/api/storage/documents/route'
import { DELETE as revokeKey, GET as listKeys, POST as createKey } from '../../../app/api/storage/keys/route'
import { validateConnectionString } from '../connection'
import { STORAGE_TOKEN_HEADER } from '../errors'
import { discardPool, getPool } from '../pg-pool'
import { createPostgresStore } from '../pg-store'
import { ensureSchema } from '../schema'
import { sealBuilderToken } from '../token'

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip
const vec = () => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))

run('automation keys against Postgres', () => {
  const savedEnv = process.env
  let builderA: string
  let builderB: string
  let workspaceA: string
  let workspaceB: string
  const created: string[] = []
  let connection: ReturnType<typeof validateConnectionString> & { ok: true }

  const req = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new NextRequest(new URL(url, 'http://localhost'), { method: init.method ?? 'GET', headers: init.headers, body: init.body })

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    process.env = { ...savedEnv, EMBED_TOKEN_KEY: randomBytes(32).toString('base64'), ALLOW_PRIVATE_DB_HOSTS: '1' }
    const checked = validateConnectionString(process.env.TEST_DATABASE_URL, { allowPrivate: true })
    if (!checked.ok) throw new Error('bad TEST_DATABASE_URL')
    connection = checked
    await ensureSchema(await getPool(checked.connection))
    const store = createPostgresStore(checked.connection, '00000000-0000-0000-0000-000000000000')
    workspaceA = (await store.createWorkspace()).id
    workspaceB = (await store.createWorkspace()).id
    created.push(workspaceA, workspaceB)
    builderA = sealBuilderToken({ conn: checked.connection.normalized, workspaceId: workspaceA })
    builderB = sealBuilderToken({ conn: checked.connection.normalized, workspaceId: workspaceB })
    const storeA = createPostgresStore(checked.connection, workspaceA)
    await storeA.storeDocument(workspaceA, 'services.md', [{ content: 'a', embedding: vec(), index: 0 }])
    await storeA.storeDocument(workspaceA, 'old.md', [{ content: 'b', embedding: vec(), index: 0 }])
  })

  afterAll(async () => {
    try {
      const pool = await getPool(connection.connection)
      await pool.query('DELETE FROM support_bot.workspaces WHERE id = ANY($1::uuid[])', [created])
    } finally {
      await discardPool(connection.connection)
      process.env = savedEnv
      jest.restoreAllMocks()
    }
  })

  it('full lifecycle: create with the owner token, use, cannot self-manage, revoke, refused', async () => {
    const createRes = await createKey(req('/api/storage/keys', {
      method: 'POST', headers: { [STORAGE_TOKEN_HEADER]: builderA, 'content-type': 'application/json' }, body: JSON.stringify({ label: 'GitHub sync' }),
    }))
    expect(createRes.status).toBe(200)
    const { key, summary } = await createRes.json()
    expect(key.startsWith('sbk1_')).toBe(true)
    expect(summary.label).toBe('GitHub sync')
    const bearer = { authorization: `Bearer ${key}` }

    // The key lists and removes documents in its workspace.
    const list = await (await listDocuments(req('/api/storage/documents', { headers: bearer }))).json()
    expect(list.documents.map((d: { filename: string }) => d.filename).sort()).toEqual(['old.md', 'services.md'])
    const old = list.documents.find((d: { filename: string }) => d.filename === 'old.md')
    expect((await deleteDocument(req(`/api/storage/documents?id=${old.id}`, { method: 'DELETE', headers: bearer }))).status).toBe(200)

    // Use is recorded.
    const keys = await (await listKeys(req('/api/storage/keys', { headers: { [STORAGE_TOKEN_HEADER]: builderA } }))).json()
    expect(keys.keys[0].lastUsedAt).not.toBeNull()

    // A key cannot list, create or revoke keys.
    expect((await listKeys(req('/api/storage/keys', { headers: bearer }))).status).toBe(403)
    expect((await createKey(req('/api/storage/keys', { method: 'POST', headers: bearer, body: '{}' }))).status).toBe(403)

    // Another workspace's owner cannot revoke it.
    expect((await revokeKey(req(`/api/storage/keys?id=${summary.id}`, { method: 'DELETE', headers: { [STORAGE_TOKEN_HEADER]: builderB } }))).status).toBe(404)

    // Revoke, then the key is refused everywhere.
    expect((await revokeKey(req(`/api/storage/keys?id=${summary.id}`, { method: 'DELETE', headers: { [STORAGE_TOKEN_HEADER]: builderA } }))).status).toBe(200)
    const refused = await listDocuments(req('/api/storage/documents', { headers: bearer }))
    expect(refused.status).toBe(401)
    expect((await refused.json()).code).toBe('invalid_key')
  })

  it('a key cannot reach another workspace even with a valid seal', async () => {
    const res = await createKey(req('/api/storage/keys', { method: 'POST', headers: { [STORAGE_TOKEN_HEADER]: builderB }, body: '{}' }))
    const { key } = await res.json()
    const listB = await (await listDocuments(req('/api/storage/documents', { headers: { authorization: `Bearer ${key}` } }))).json()
    expect(listB.documents).toEqual([]) // B's workspace, not A's documents
    const docsA = await createPostgresStore(connection.connection, workspaceA).listDocuments(workspaceA)
    const del = await deleteDocument(req(`/api/storage/documents?id=${docsA[0].id}`, { method: 'DELETE', headers: { authorization: `Bearer ${key}` } }))
    expect(del.status).toBe(404) // A's document is invisible to B's key
    expect(await createPostgresStore(connection.connection, workspaceA).listDocuments(workspaceA)).toHaveLength(docsA.length)
  })

  it('rate-limits key creation per network', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await createKey(req('/api/storage/keys', { method: 'POST', headers: { [STORAGE_TOKEN_HEADER]: builderA, 'x-real-ip': '203.0.113.9' }, body: '{}' }))
      statuses.push(r.status)
    }
    expect(statuses.slice(0, 5).every((s) => s === 200 || s === 409)).toBe(true)
    expect(statuses[5]).toBe(429)
  })

  it('caps active keys per workspace at ten', async () => {
    const { createAutomationKey } = await import('../api-keys')
    let last: unknown = null
    for (let i = 0; i < 11; i++) last = await createAutomationKey(connection.connection, workspaceB, `k${i}`)
    expect(last).toBe('too_many')
  })
})
