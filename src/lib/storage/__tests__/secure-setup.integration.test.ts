/** @jest-environment node */
// Runs only with TEST_DATABASE_URL: a disposable database with pgvector, as a
// login that can create roles (a superuser locally; neondb_owner on Neon).
import { randomBytes } from 'node:crypto'
import { NextRequest } from 'next/server'
import { POST as connect } from '../../../app/api/storage/connect/route'
import { GET as listDocuments } from '../../../app/api/storage/documents/route'
import { validateConnectionString, type ParsedConnection } from '../connection'
import { STORAGE_TOKEN_HEADER } from '../errors'
import { discardPool, getPool } from '../pg-pool'
import { revokeStatements, secureSetup } from '../secure-setup'
import { openBuilderToken } from '../token'

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip

run('one-click secure setup against Postgres', () => {
  const savedEnv = process.env
  let owner: ParsedConnection
  const extraPools: ParsedConnection[] = []
  const workspaces: string[] = []
  // Logins this run created; only these are dropped afterwards.
  const createdRoles: string[] = []

  const post = (body: Record<string, unknown>, ip: string) =>
    connect(new NextRequest(new URL('/api/storage/connect', 'http://localhost'), {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify(body),
    }))

  const connOf = (token: string) => {
    const opened = openBuilderToken(token)
    if (!opened) throw new Error('token did not open')
    workspaces.push(opened.workspaceId)
    const v = validateConnectionString(opened.conn, { allowPrivate: true, maxLength: 3000 })
    if (!v.ok) throw new Error('token conn invalid')
    extraPools.push(v.connection)
    return v.connection
  }

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    process.env = { ...savedEnv, EMBED_TOKEN_KEY: randomBytes(32).toString('base64'), ALLOW_PRIVATE_DB_HOSTS: '1' }
    const v = validateConnectionString(process.env.TEST_DATABASE_URL, { allowPrivate: true })
    if (!v.ok) throw new Error('bad TEST_DATABASE_URL')
    owner = v.connection
  })

  afterAll(async () => {
    try {
      const pool = await getPool(owner)
      await pool.query('DELETE FROM support_bot.workspaces WHERE id = ANY($1::uuid[])', [workspaces])
      for (const c of extraPools) await discardPool(c)
      // One of those may have been the admin pool itself, so take a fresh one.
      const admin = await getPool(owner)
      for (const role of createdRoles) {
        for (const sql of revokeStatements(role, false)) await admin.query(sql)
      }
      await admin.query('DROP TABLE IF EXISTS public.secure_setup_probe')
    } finally {
      await discardPool(owner)
      process.env = savedEnv
      jest.restoreAllMocks()
    }
  })

  it('connects through a new limited login and keeps no trace of the admin one', async () => {
    const res = await post({ connectionString: process.env.TEST_DATABASE_URL, secureSetup: true }, '198.51.100.21')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.setup.status).toBe('created')
    createdRoles.push(body.setup.role)
    expect(body.setup.role).toMatch(/^support_bot_app(_[0-9a-f]{6})?$/)
    const limited = connOf(body.token)
    expect(limited.user).toBe(body.setup.role)
    expect(limited.password).not.toBe(owner.password)
    expect(limited.password).toMatch(/^[0-9a-f]{48}$/)

    // The builder works with it.
    const docs = await listDocuments(new NextRequest(new URL('/api/storage/documents', 'http://localhost'), { headers: { [STORAGE_TOKEN_HEADER]: body.token } }))
    expect(docs.status).toBe(200)

    // And it reaches nothing outside support_bot, and can change no structure.
    const admin = await getPool(owner)
    await admin.query('CREATE TABLE IF NOT EXISTS public.secure_setup_probe (secret text)')
    const pool = await getPool(limited)
    await expect(pool.query('SELECT * FROM public.secure_setup_probe')).rejects.toMatchObject({ code: '42501' })
    await expect(pool.query('DROP TABLE support_bot.chunks')).rejects.toMatchObject({ code: '42501' })
    await expect(pool.query('DELETE FROM support_bot.workspaces')).rejects.toMatchObject({ code: '42501' })
    await expect(pool.query('CREATE TABLE support_bot.extra (i int)')).rejects.toMatchObject({ code: '42501' })
  })

  it('leaves an existing support_bot_app alone and makes a suffixed login', async () => {
    const res = await post({ connectionString: process.env.TEST_DATABASE_URL, secureSetup: true }, '198.51.100.22')
    const body = await res.json()
    expect(body.setup.status).toBe('created')
    createdRoles.push(body.setup.role)
    expect(body.setup.role).toMatch(/^support_bot_app_[0-9a-f]{6}$/)
  })

  it('uses an already limited login as it is', async () => {
    const first = await (await post({ connectionString: process.env.TEST_DATABASE_URL, secureSetup: true }, '198.51.100.23')).json()
    createdRoles.push(first.setup.role)
    const limited = connOf(first.token)
    const before = (await (await getPool(owner)).query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE 'support_bot_app%'")).rows[0].n
    const again = await post({ connectionString: limited.normalized, secureSetup: true }, '198.51.100.24')
    const body = await again.json()
    expect(again.status).toBe(200)
    expect(body.setup).toEqual({ status: 'already_limited' })
    expect(connOf(body.token).user).toBe(limited.user)
    const after = (await (await getPool(owner)).query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE 'support_bot_app%'")).rows[0].n
    expect(after).toBe(before)
  })

  it('is off unless asked for', async () => {
    const res = await post({ connectionString: process.env.TEST_DATABASE_URL }, '198.51.100.25')
    const body = await res.json()
    expect(body.setup).toBeUndefined()
    expect(connOf(body.token).user).toBe(owner.user)
  })

  it('rolls back completely when the new login cannot be used', async () => {
    const admin = await getPool(owner)
    const count = async () => (await admin.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname LIKE 'support_bot_app%'")).rows[0].n
    const before = await count()
    // With private hosts disallowed, the rebuilt 127.0.0.1 string fails validation, so verification fails.
    const result = await secureSetup(owner, false)
    expect(result).toEqual({ status: 'not_possible', reason: 'new_login_failed' })
    expect(await count()).toBe(before)
  })
})
