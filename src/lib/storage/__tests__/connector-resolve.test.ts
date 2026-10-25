/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { sealConnectorToken, sealWidgetTokenV3 } from '../../connector/token'
import { CONNECTOR_ERROR_MESSAGES, type ConnectorConfig, type ConnectorWidgetSettings } from '../../connector/shared'
import type { OwnerModelConfig } from '../../model/shared'
import { STORAGE_TOKEN_HEADER, StorageError } from '../errors'
import { builderErrorResponse, resolveBuilderStore, resolveWidget } from '../resolve'
import {
  MAX_WIDGET_TOKEN_V3_LENGTH,
  sealBuilderToken,
  sealModelToken,
  sealWidgetToken,
  sealWidgetTokenV2,
} from '../token'

const KEY = randomBytes(32)
const CONN = 'postgresql://user:pw@db.example.com:5432/app?sslmode=verify-full'
const MODEL: OwnerModelConfig = { baseUrl: 'https://api.example.com/v1', model: 'm-1', apiKey: 'sk-test-SENTINEL-1' }
const CONNECTOR: ConnectorConfig = {
  baseUrl: 'https://support.example.com',
  keyId: 'ck_0123456789abcdef',
  secret: 'SECRETsentinel_'.padEnd(43, 'A'),
}
const LOCAL_CONNECTOR: ConnectorConfig = { ...CONNECTOR, baseUrl: 'http://127.0.0.1:8080' }
const SETTINGS: ConnectorWidgetSettings = {
  title: 'Help desk',
  welcomeMessage: 'Hi there',
  primaryColor: '#123456',
  position: 'bottom-left',
  size: 'large',
  systemPrompt: 'Answer briefly.',
  roleContext: 'Shop assistant',
}
const ORIGINS = ['https://shop.example.com', 'http://localhost:5500']

const savedEnv = { ...process.env }

function req(token?: string): Request {
  const headers = new Headers()
  if (token !== undefined) headers.set(STORAGE_TOKEN_HEADER, token)
  return new Request('http://localhost/api/chat', { method: 'POST', headers })
}

function tamper(token: string): string {
  const i = token.length - 5
  return token.slice(0, i) + (token[i] === 'A' ? 'B' : 'A') + token.slice(i + 1)
}

function widgetToken(overrides: Partial<Parameters<typeof sealWidgetTokenV3>[0]> = {}): string {
  return sealWidgetTokenV3({ connector: CONNECTOR, origins: ORIGINS, answer: true, settings: SETTINGS, ...overrides }, KEY)
}

let logSpy: jest.SpyInstance

beforeEach(() => {
  process.env = { ...savedEnv, EMBED_TOKEN_KEY: KEY.toString('base64') }
  delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  logSpy.mockRestore()
})

afterAll(() => {
  process.env = savedEnv
})

describe('resolveBuilderStore with an sbc1_ token', () => {
  it('resolves to the connector context with no store', () => {
    const token = sealConnectorToken({ ...CONNECTOR, answer: true }, KEY)
    const r = resolveBuilderStore(req(token))
    if (!r.ok || r.ctx.kind !== 'connector') throw new Error('expected connector context')
    expect(r.ctx.connector).toEqual(CONNECTOR)
    expect(r.ctx.answer).toBe(true)
    expect(r.ctx.label).toMatch(/^backend=#[0-9a-f]{8}$/)
    expect(r.ctx.store).toBeUndefined()
  })

  it('returns connector_unavailable (503) when the server has no key', () => {
    const token = sealConnectorToken({ ...CONNECTOR, answer: false }, KEY)
    delete process.env.EMBED_TOKEN_KEY
    const r = resolveBuilderStore(req(token))
    expect(!r.ok && r.error.code).toBe('connector_unavailable')
    expect(!r.ok && r.error.status).toBe(503)
  })

  it('still returns storage_unavailable for an sbb1_ token without a key', () => {
    const token = sealBuilderToken({ conn: CONN, workspaceId: randomUUID() }, KEY)
    delete process.env.EMBED_TOKEN_KEY
    const r = resolveBuilderStore(req(token))
    expect(!r.ok && r.error.code).toBe('storage_unavailable')
  })

  it('returns connector_token_invalid (401) for a tampered sbc1_ token', async () => {
    const token = tamper(sealConnectorToken({ ...CONNECTOR, answer: true }, KEY))
    const r = resolveBuilderStore(req(token))
    expect(!r.ok && r.error.code).toBe('connector_token_invalid')
    if (r.ok) return
    const res = builderErrorResponse(r.error)
    expect(res.status).toBe(401)
    const msg = CONNECTOR_ERROR_MESSAGES.connector_token_invalid
    expect(await res.json()).toEqual({ error: msg, code: 'connector_token_invalid', details: msg })
  })

  it('refuses a private address on a flag-off server, and accepts it with the flag', () => {
    const token = sealConnectorToken({ ...LOCAL_CONNECTOR, answer: false }, KEY)
    const refused = resolveBuilderStore(req(token))
    expect(!refused.ok && refused.error.code).toBe('connector_address_blocked')
    expect(!refused.ok && refused.error.status).toBe(400)
    process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS = '1'
    const allowed = resolveBuilderStore(req(token))
    expect(allowed.ok && allowed.ctx.kind).toBe('connector')
  })

  it.each([
    ['sbw1_', () => sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() }, KEY)],
    ['sbw2_', () => sealWidgetTokenV2({ source: { kind: 'memory', widgetKey: 'widget-abc' }, origins: ORIGINS }, KEY)],
    ['sbw3_', () => widgetToken()],
    ['sbm1_', () => sealModelToken(MODEL, KEY)],
  ])('refuses a %s token with token_wrong_purpose (403)', async (_prefix, make) => {
    const r = resolveBuilderStore(req(make()))
    expect(!r.ok && r.error.code).toBe('token_wrong_purpose')
    if (!r.ok) expect(builderErrorResponse(r.error).status).toBe(403)
  })

  it('builderErrorResponse keeps StorageError bodies unchanged', async () => {
    const res = builderErrorResponse(new StorageError('invalid_token'))
    expect(res.status).toBe(401)
    expect((await res.json()).code).toBe('invalid_token')
  })
})

describe('resolveWidget with an sbw3_ token', () => {
  it('resolves with the exact origin policy and the sealed settings', async () => {
    const token = widgetToken()
    const r = await resolveWidget(token)
    if (!r.ok || r.ctx.kind !== 'connector') throw new Error('expected connector widget')
    const { ctx } = r
    expect(ctx.access).toEqual({ kind: 'exact', origins: ORIGINS })
    expect(ctx.connector).toEqual(CONNECTOR)
    expect(ctx.answer).toBe(true)
    expect(ctx.model).toBeNull()
    expect(ctx.settings).toEqual(SETTINGS)
    expect(ctx.store).toBeUndefined()
    expect(ctx.label).toMatch(/^sbw3_#[0-9a-f]{8}$/)
    expect(ctx.widget).toMatchObject({
      widget_key: token,
      name: 'Help desk',
      title: 'Help desk',
      welcome_message: 'Hi there',
      primary_color: '#123456',
      position: 'bottom-left',
      size: 'large',
      allowed_domains: [],
      allowed_origins: ORIGINS,
      is_active: true,
      business_id: '',
      knowledge_base_id: '',
      system_prompt: 'Answer briefly.',
      role_context: 'Shop assistant',
    })
    expect(ctx.widget.id).toMatch(/^[0-9a-f]{8}$/)
    expect(ctx.widget.created_at).toEqual(new Date(0))
  })

  it('carries the owner model only when the backend does not answer', async () => {
    const r = await resolveWidget(widgetToken({ answer: false, model: MODEL }))
    expect(r.ok && r.ctx.kind === 'connector' && r.ctx.model).toEqual(MODEL)
    const backend = await resolveWidget(widgetToken({ answer: true, model: MODEL }))
    expect(backend.ok && backend.ctx.kind === 'connector' && backend.ctx.model).toBeNull()
  })

  it('returns 404 for a tampered token', async () => {
    expect(await resolveWidget(tamper(widgetToken()))).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
  })

  it('returns 404 for a token sealed under another key', async () => {
    const other = sealWidgetTokenV3({ connector: CONNECTOR, origins: ORIGINS, answer: true, settings: SETTINGS }, randomBytes(32))
    expect(await resolveWidget(other)).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
  })

  it('returns 404 for an over-length token', async () => {
    const long = 'sbw3_' + 'A'.repeat(MAX_WIDGET_TOKEN_V3_LENGTH)
    expect(await resolveWidget(long)).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
  })

  it('returns 404 when an origin is not in normalised form', async () => {
    const token = widgetToken({ origins: ['https://Shop.Example.com/'] })
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
  })

  it('returns 404 for http://127.0.0.1 on a flag-off server and logs only the mapped code', async () => {
    const token = widgetToken({ connector: LOCAL_CONNECTOR })
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 404, code: 'widget_not_found' })
    const lines = logSpy.mock.calls.map((c) => c.join(' '))
    expect(lines).toEqual([expect.stringMatching(/^widget connector refused code=connector_address_blocked key=sbw3_#[0-9a-f]{8}$/)])
    expect(lines.join('\n')).not.toContain('127.0.0.1')

    process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS = '1'
    const allowed = await resolveWidget(token)
    expect(allowed.ok && allowed.ctx.kind).toBe('connector')
  })

  it('returns 503 without a server key', async () => {
    const token = widgetToken()
    delete process.env.EMBED_TOKEN_KEY
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 503, code: 'storage_unavailable' })
  })

  it('refuses an sbc1_ token as a widget key with 403', async () => {
    const token = sealConnectorToken({ ...CONNECTOR, answer: true }, KEY)
    expect(await resolveWidget(token)).toEqual({ ok: false, status: 403, code: 'token_wrong_purpose' })
    expect(await resolveWidget('sbc1_junk')).toEqual({ ok: false, status: 403, code: 'token_wrong_purpose' })
  })
})
