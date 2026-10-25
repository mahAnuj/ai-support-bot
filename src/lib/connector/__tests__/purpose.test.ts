/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { resolveBuilderModel, modelErrorResponse } from '../../model/resolve'
import { MODEL_TOKEN_HEADER, type OwnerModelConfig } from '../../model/shared'
import { STORAGE_TOKEN_HEADER } from '../../storage/errors'
import { keyLabel } from '../../storage/log'
import { resolveBuilderStore } from '../../storage/resolve'
import {
  openPrefixed,
  sealBuilderToken,
  sealModelToken,
  sealWidgetToken,
  sealWidgetTokenV2,
} from '../../storage/token'
import { connectorErrorResponse, openConnectorHeader, resolveBuilderConnector } from '../resolve'
import { CONNECTOR_ERROR_MESSAGES, ConnectorError, type ConnectorConfig } from '../shared'
import { sealConnectorToken, sealWidgetTokenV3 } from '../token'

// Wrap the shared opener so the test can see whether anything was decrypted.
jest.mock('../../storage/token', () => {
  const actual = jest.requireActual('../../storage/token')
  return { ...actual, openPrefixed: jest.fn(actual.openPrefixed) }
})
const openSpy = openPrefixed as jest.MockedFunction<typeof openPrefixed>

const key = randomBytes(32)
const otherKey = randomBytes(32)
const CONN = 'postgresql://user:pw@db.example.com:5432/app?sslmode=verify-full'
const MODEL: OwnerModelConfig = { baseUrl: 'https://api.example.com/v1', model: 'm-1', apiKey: 'sk-test-SENTINEL-1' }
const CONNECTOR: ConnectorConfig = {
  baseUrl: 'https://support.example.com',
  keyId: 'ck_0123456789abcdef',
  secret: 'SECRETsentinel_'.padEnd(43, 'A'),
}
const SETTINGS = { title: 'Help', welcomeMessage: 'Hi', primaryColor: '#123456', position: 'bottom-right' as const, size: 'small' as const }

const savedEnv = { ...process.env }

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/connector/test', { method: 'POST', headers })
}

function otherPurposeTokens(k: Buffer): [string, string][] {
  return [
    ['sbb1_', sealBuilderToken({ conn: CONN, workspaceId: randomUUID() }, k)],
    ['sbm1_', sealModelToken(MODEL, k)],
    ['sbw1_', sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() }, k)],
    ['sbw2_', sealWidgetTokenV2({ source: { kind: 'memory', widgetKey: 'widget-abc' }, origins: ['https://a.example'] }, k)],
    ['sbw3_', sealWidgetTokenV3({ connector: CONNECTOR, origins: ['https://a.example'], answer: true, settings: SETTINGS }, k)],
  ]
}

beforeEach(() => {
  process.env = { ...savedEnv, EMBED_TOKEN_KEY: key.toString('base64') }
  delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
  openSpy.mockClear()
})

afterAll(() => {
  process.env = savedEnv
})

describe('x-model-token refuses sbc1_', () => {
  it('returns 403 model_token_wrong_purpose for a real connector token, before decrypting', async () => {
    const token = sealConnectorToken({ ...CONNECTOR, answer: true })
    openSpy.mockClear()
    const r = resolveBuilderModel(new Request('http://localhost/api/chat', { headers: { [MODEL_TOKEN_HEADER]: token } }))
    expect(!r.ok && r.error.code).toBe('model_token_wrong_purpose')
    expect(openSpy).not.toHaveBeenCalled()
    if (!r.ok) expect(modelErrorResponse(r.error).status).toBe(403)
  })

  it('refuses a bare sbc1_ shape and an sbw3_ token too', () => {
    for (const header of ['sbc1_junk', 'sbw3_junk']) {
      const r = resolveBuilderModel(new Request('http://localhost/api/chat', { headers: { [MODEL_TOKEN_HEADER]: header } }))
      expect(!r.ok && r.error.code).toBe('model_token_wrong_purpose')
    }
  })
})

describe('x-storage-token on builder storage routes refuses sbw3_', () => {
  it('returns token_wrong_purpose for a real sbw3_', () => {
    const token = sealWidgetTokenV3({ connector: CONNECTOR, origins: ['https://a.example'], answer: true, settings: SETTINGS })
    const r = resolveBuilderStore(req({ [STORAGE_TOKEN_HEADER]: token }))
    expect(!r.ok && r.error.code).toBe('token_wrong_purpose')
  })
})

describe('resolveBuilderConnector', () => {
  it.each(otherPurposeTokens(key))('refuses a real %s token with 403 before any decryption', async (_prefix, token) => {
    openSpy.mockClear()
    const r = resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: token }))
    expect(!r.ok && r.error.code).toBe('connector_token_wrong_purpose')
    expect(openSpy).not.toHaveBeenCalled()
    if (!r.ok) {
      const res = connectorErrorResponse(r.error)
      expect(res.status).toBe(403)
      const msg = CONNECTOR_ERROR_MESSAGES.connector_token_wrong_purpose
      expect(await res.json()).toEqual({ error: msg, code: 'connector_token_wrong_purpose', details: msg })
    }
  })

  it.each(otherPurposeTokens(otherKey))('refuses %s sealed under another key as wrong purpose, not invalid', (_prefix, token) => {
    const r = resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: token }))
    expect(!r.ok && r.error.code).toBe('connector_token_wrong_purpose')
  })

  it('opens an sbc1_ token into the connector, answer flag and a fingerprint label', () => {
    const token = sealConnectorToken({ ...CONNECTOR, answer: true })
    const r = resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: token }))
    expect(r.ok).toBe(true)
    // Proves the spy sees decryption, so the not-called assertions above mean something.
    expect(openSpy).toHaveBeenCalledTimes(1)
    if (!r.ok) return
    expect(r.connector).toEqual(CONNECTOR)
    expect(r.answer).toBe(true)
    expect(r.label).toMatch(/^backend=#[0-9a-f]{8}$/)
    expect(r.label).not.toContain('support.example.com')
  })

  it('returns connector_token_invalid (401) for a missing header, junk, a tampered token and another key', () => {
    const token = sealConnectorToken({ ...CONNECTOR, answer: false })
    const tampered = token.slice(0, 20) + (token[20] === 'A' ? 'B' : 'A') + token.slice(21)
    const cases = [
      resolveBuilderConnector(req({})),
      resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: 'garbage' })),
      resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: tampered })),
      resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: sealConnectorToken({ ...CONNECTOR, answer: false }, otherKey) })),
    ]
    for (const r of cases) {
      expect(!r.ok && r.error.code).toBe('connector_token_invalid')
      if (!r.ok) expect(connectorErrorResponse(r.error).status).toBe(401)
    }
  })

  it('returns connector_unavailable (503) when the server has no key', () => {
    const token = sealConnectorToken({ ...CONNECTOR, answer: true })
    delete process.env.EMBED_TOKEN_KEY
    const r = resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: token }))
    expect(!r.ok && r.error.code).toBe('connector_unavailable')
    if (!r.ok) expect(connectorErrorResponse(r.error).status).toBe(503)
  })

  it('applies the live private-host policy: a flag-off server refuses an sbc1_ holding http://127.0.0.1:8080', async () => {
    process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS = '1'
    const token = sealConnectorToken({ ...CONNECTOR, baseUrl: 'http://127.0.0.1:8080', answer: true })
    expect(resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: token })).ok).toBe(true)

    delete process.env.ALLOW_PRIVATE_CONNECTOR_HOSTS
    const r = resolveBuilderConnector(req({ [STORAGE_TOKEN_HEADER]: token }))
    expect(!r.ok && r.error.code).toBe('connector_address_blocked')
    if (!r.ok) {
      const res = connectorErrorResponse(r.error)
      expect(res.status).toBe(400)
      expect(JSON.stringify(await res.json())).not.toContain('127.0.0.1')
    }
  })

  it('openConnectorHeader is the same check without a request', () => {
    expect(openConnectorHeader(sealConnectorToken({ ...CONNECTOR, answer: false })).ok).toBe(true)
    const r = openConnectorHeader('sbb1_junk')
    expect(!r.ok && r.error.code).toBe('connector_token_wrong_purpose')
  })
})

describe('connectorErrorResponse', () => {
  it('includes the HTTP status only for connector_http_error', async () => {
    const res = connectorErrorResponse(new ConnectorError('connector_http_error', 500))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toEqual({
      error: 'Your backend returned an error (HTTP 500).',
      code: 'connector_http_error',
      details: 'Your backend returned an error (HTTP 500).',
    })
  })
})

describe('log labels', () => {
  it('labels sbc1_ and sbw3_ by prefix and fingerprint only', () => {
    const c = sealConnectorToken({ ...CONNECTOR, answer: true })
    const w = sealWidgetTokenV3({ connector: CONNECTOR, origins: ['https://a.example'], answer: true, settings: SETTINGS })
    expect(keyLabel(c)).toMatch(/^sbc1_#[0-9a-f]{8}$/)
    expect(keyLabel(w)).toMatch(/^sbw3_#[0-9a-f]{8}$/)
  })
})
