/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { STORAGE_ERROR_MESSAGES, STORAGE_TOKEN_HEADER, StorageError } from '../errors'
import { memoryStore } from '../memory-store'
import { getPool } from '../pg-pool'
import { createPostgresStore } from '../pg-store'
import { rejectWidgetTokenHeader, resolveBuilderStore, resolveWidget, storageErrorResponse } from '../resolve'
import { sealBuilderToken, sealWidgetToken } from '../token'
import type { KnowledgeStore, WidgetRecord } from '../types'

jest.mock('../pg-pool', () => ({
  getPool: jest.fn(() => Promise.reject(new Error('getPool must not be called in unit tests'))),
}))

jest.mock('../pg-store', () => {
  const actual = jest.requireActual('../pg-store')
  return { createPostgresStore: jest.fn(actual.createPostgresStore) }
})

const KEY = randomBytes(32).toString('base64')
const CONN = 'postgresql://user:pw@db.example.com:5432/app?sslmode=verify-full'
const PRIVATE_CONN = 'postgresql://user:pw@10.0.0.5:5432/app'
// Normalised from a 999-char input; '%24' re-encoding pushes it to the 2860-char normalised cap.
const LONG_CONN = `postgresql://u:${'%24'.repeat(917)}${'p'.repeat(52)}@db.example.com:5432/d?sslmode=verify-full`

const mockedGetPool = getPool as jest.MockedFunction<typeof getPool>
const mockedCreateStore = createPostgresStore as jest.MockedFunction<typeof createPostgresStore>

function req(token?: string): Request {
  const headers = new Headers()
  if (token !== undefined) headers.set(STORAGE_TOKEN_HEADER, token)
  return new Request('http://localhost/api/chat', { method: 'POST', headers })
}

function tamper(token: string): string {
  const i = token.length - 5
  const c = token[i] === 'A' ? 'B' : 'A'
  return token.slice(0, i) + c + token.slice(i + 1)
}

function fakeWidget(id: string): WidgetRecord {
  return {
    id,
    business_id: '',
    knowledge_base_id: 'kb',
    widget_key: id,
    name: 'n',
    title: 't',
    welcome_message: 'w',
    primary_color: '#000000',
    position: 'bottom-right',
    size: 'medium',
    allowed_domains: [],
    is_active: true,
    created_at: new Date(0),
    updated_at: new Date(0),
  }
}

const savedEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...savedEnv, EMBED_TOKEN_KEY: KEY, NODE_ENV: 'test' }
  delete process.env.ALLOW_PRIVATE_DB_HOSTS
  mockedGetPool.mockClear()
  mockedCreateStore.mockClear()
})

afterAll(() => {
  process.env = savedEnv
})

describe('resolveBuilderStore', () => {
  it('uses the memory store when there is no header', () => {
    const r = resolveBuilderStore(req())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ctx.kind).toBe('memory')
      expect(r.ctx.store).toBe(memoryStore)
    }
  })

  it('uses the memory store with no header even when storage is disabled', () => {
    delete process.env.EMBED_TOKEN_KEY
    const r = resolveBuilderStore(req())
    expect(r.ok && r.ctx.kind).toBe('memory')
  })

  it('returns a postgres context for a valid builder token without any I/O', () => {
    const workspaceId = randomUUID()
    const token = sealBuilderToken({ conn: CONN, workspaceId })
    const r = resolveBuilderStore(req(token))
    expect(r.ok).toBe(true)
    if (r.ok && r.ctx.kind === 'postgres') {
      expect(r.ctx.store.kind).toBe('postgres')
      expect(r.ctx.workspaceId).toBe(workspaceId)
      expect(r.ctx.connection.normalized).toBe(CONN)
      expect(r.ctx.label).toBe('ws=' + workspaceId.slice(0, 8))
    } else {
      throw new Error('expected postgres context')
    }
    expect(mockedGetPool).not.toHaveBeenCalled()
  })

  it('resolves a builder token carrying a normalised string longer than 1000 chars', () => {
    expect(LONG_CONN).toHaveLength(2860)
    const token = sealBuilderToken({ conn: LONG_CONN, workspaceId: randomUUID() })
    const r = resolveBuilderStore(req(token))
    if (!r.ok || r.ctx.kind !== 'postgres') throw new Error('expected postgres context')
    expect(r.ctx.connection.normalized).toBe(LONG_CONN)
    expect(r.ctx.connection.password).toBe('$'.repeat(917) + 'p'.repeat(52))
    expect(mockedGetPool).not.toHaveBeenCalled()
  })

  it('rejects a widget token with token_wrong_purpose before decrypting', () => {
    const token = sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() })
    const r = resolveBuilderStore(req(token))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error.code).toBe('token_wrong_purpose')
      expect(r.error.status).toBe(403)
    }
    // A junk sbw1_ body is rejected the same way, proving no decrypt is attempted.
    const junk = resolveBuilderStore(req('sbw1_not-a-real-token'))
    expect(!junk.ok && junk.error.code).toBe('token_wrong_purpose')
    expect(mockedCreateStore).not.toHaveBeenCalled()
  })

  it('rejects a tampered builder token with invalid_token and no connection', () => {
    const token = sealBuilderToken({ conn: CONN, workspaceId: randomUUID() })
    const r = resolveBuilderStore(req(tamper(token)))
    expect(!r.ok && r.error.code).toBe('invalid_token')
    expect(!r.ok && r.error.status).toBe(401)
    expect(mockedCreateStore).not.toHaveBeenCalled()
    expect(mockedGetPool).not.toHaveBeenCalled()
  })

  it('rejects junk and empty headers with invalid_token', () => {
    expect(resolveBuilderStore(req('garbage')).ok).toBe(false)
    const r = resolveBuilderStore(req(''))
    expect(!r.ok && r.error.code).toBe('invalid_token')
  })

  it('returns storage_unavailable (503) for a token when no key is configured', () => {
    const token = sealBuilderToken({ conn: CONN, workspaceId: randomUUID() })
    delete process.env.EMBED_TOKEN_KEY
    const r = resolveBuilderStore(req(token))
    expect(!r.ok && r.error.code).toBe('storage_unavailable')
    expect(!r.ok && r.error.status).toBe(503)
  })

  it('rejects a token sealed under a different key', () => {
    const token = sealBuilderToken({ conn: CONN, workspaceId: randomUUID() }, randomBytes(32))
    const r = resolveBuilderStore(req(token))
    expect(!r.ok && r.error.code).toBe('invalid_token')
  })

  it('re-applies the private-host policy to the decrypted connection string', () => {
    process.env.ALLOW_PRIVATE_DB_HOSTS = '1'
    const token = sealBuilderToken({ conn: PRIVATE_CONN, workspaceId: randomUUID() })
    expect(resolveBuilderStore(req(token)).ok).toBe(true)
    delete process.env.ALLOW_PRIVATE_DB_HOSTS
    const r = resolveBuilderStore(req(token))
    expect(!r.ok && r.error.code).toBe('private_host_not_allowed')
  })
})

describe('rejectWidgetTokenHeader', () => {
  it('flags only widget-shaped headers', () => {
    expect(rejectWidgetTokenHeader(req('sbw1_abc'))?.code).toBe('token_wrong_purpose')
    expect(rejectWidgetTokenHeader(req('sbb1_abc'))).toBeNull()
    expect(rejectWidgetTokenHeader(req())).toBeNull()
  })
})

describe('resolveWidget', () => {
  it('routes widget- keys to the memory store', async () => {
    const spy = jest.spyOn(memoryStore, 'getWidget').mockResolvedValueOnce(fakeWidget('widget-abc'))
    const r = await resolveWidget('widget-abc')
    expect(spy).toHaveBeenCalledWith('widget-abc')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ctx.kind).toBe('memory')
      expect(r.ctx.label).toBe('widget-abc')
    }
    spy.mockRestore()
  })

  it('returns 404 for an unknown widget- key', async () => {
    const r = await resolveWidget('widget-does-not-exist')
    expect(r).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
  })

  it('rejects builder tokens with 403 without decrypting', async () => {
    const token = sealBuilderToken({ conn: CONN, workspaceId: randomUUID() })
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 403, code: 'token_wrong_purpose' })
    expect(await resolveWidget('sbb1_junk')).toEqual({ ok: false, status: 403, code: 'token_wrong_purpose' })
    expect(mockedCreateStore).not.toHaveBeenCalled()
  })

  it.each([undefined, null, 42, {}, 'junk', '', 'sbw1_' + 'x'.repeat(5000)])('returns 404 for invalid key #%#', async (key) => {
    expect(await resolveWidget(key)).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
  })

  it('returns 503 for a widget token when no key is configured', async () => {
    const token = sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() })
    delete process.env.EMBED_TOKEN_KEY
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 503, code: 'storage_unavailable' })
  })

  it('returns 404 for a tampered widget token with no connection', async () => {
    const token = sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() })
    expect(await resolveWidget(tamper(token))).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
    expect(mockedCreateStore).not.toHaveBeenCalled()
    expect(mockedGetPool).not.toHaveBeenCalled()
  })

  it('returns 403 when the decrypted connection fails the current policy', async () => {
    const token = sealWidgetToken({ conn: PRIVATE_CONN, workspaceId: randomUUID(), widgetId: randomUUID() })
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 403, code: 'private_host_not_allowed' })
    expect(mockedCreateStore).not.toHaveBeenCalled()
  })

  it('maps store errors to 503 with a fixed code', async () => {
    const token = sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() })
    mockedGetPool.mockRejectedValueOnce(Object.assign(new Error('password authentication failed for user "x"'), { code: '28P01' }))
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 503, code: 'auth_failed' })
  })

  it('returns a postgres context with the token as widget_key', async () => {
    const widgetId = randomUUID()
    const workspaceId = randomUUID()
    const token = sealWidgetToken({ conn: CONN, workspaceId, widgetId })
    const getWidget = jest.fn().mockResolvedValue(fakeWidget(widgetId))
    mockedCreateStore.mockReturnValueOnce({ kind: 'postgres', getWidget } as unknown as KnowledgeStore)
    const r = await resolveWidget(token)
    expect(mockedCreateStore.mock.calls[0][1]).toBe(workspaceId)
    expect(getWidget).toHaveBeenCalledWith(widgetId)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.ctx.kind).toBe('postgres')
      expect(r.ctx.widget.widget_key).toBe(token)
      expect(r.ctx.widget.id).toBe(widgetId)
      expect(r.ctx.label).toMatch(/^sbw1_#[0-9a-f]{8}$/)
      expect(r.ctx.label).not.toContain(token.slice(5, 20))
    }
  })

  it('resolves a widget token carrying a normalised string longer than 1000 chars', async () => {
    const widgetId = randomUUID()
    const token = sealWidgetToken({ conn: LONG_CONN, workspaceId: randomUUID(), widgetId })
    const getWidget = jest.fn().mockResolvedValue(fakeWidget(widgetId))
    mockedCreateStore.mockReturnValueOnce({ kind: 'postgres', getWidget } as unknown as KnowledgeStore)
    const r = await resolveWidget(token)
    expect(r.ok && r.ctx.kind).toBe('postgres')
    expect(mockedCreateStore.mock.calls[0][0].normalized).toBe(LONG_CONN)
  })

  it('returns 404 when the widget is not in the database', async () => {
    const token = sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() })
    const getWidget = jest.fn().mockResolvedValue(null)
    mockedCreateStore.mockReturnValueOnce({ kind: 'postgres', getWidget } as unknown as KnowledgeStore)
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
  })
})

describe('storageErrorResponse', () => {
  it('returns the fixed body and status', async () => {
    const res = storageErrorResponse(new StorageError('invalid_token'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: STORAGE_ERROR_MESSAGES.invalid_token,
      code: 'invalid_token',
      details: STORAGE_ERROR_MESSAGES.invalid_token,
    })
  })
})
