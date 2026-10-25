/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { STORAGE_TOKEN_HEADER } from '../../storage/errors'
import {
  BUILDER_TOKEN_PREFIX,
  MAX_TOKEN_LENGTH,
  MAX_WIDGET_TOKEN_V2_LENGTH,
  MODEL_TOKEN_PREFIX,
  WIDGET_TOKEN_PREFIX,
  WIDGET_TOKEN_V2_PREFIX,
  isBuilderTokenShape,
  isModelTokenShape,
  isWidgetTokenShape,
  openBuilderToken,
  openModelToken,
  openWidgetToken,
  openWidgetTokenV2,
  sealBuilderToken,
  sealModelToken,
  sealWidgetToken,
  sealWidgetTokenV2,
  type WidgetTokenV2Payload,
} from '../../storage/token'
import { resolveBuilderModel, modelErrorResponse } from '../resolve'
import {
  MODEL_ERROR_MESSAGES,
  MODEL_LIMITS,
  MODEL_TOKEN_HEADER,
  ModelError,
  type OwnerModelConfig,
} from '../shared'
import { checkModelBaseUrl } from '../url-guard'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
const CONN = 'postgresql://user:pw@db.example.com:5432/app?sslmode=verify-full'
const MODEL: OwnerModelConfig = {
  baseUrl: 'https://api.example.com/secret-path/v1',
  model: 'openai/gpt-oss-20b',
  apiKey: 'sk-test-PLAINTEXTKEY0123456789',
}

const key = randomBytes(32)

function replaceAt(s: string, i: number): string {
  const replacement = ALPHABET[(ALPHABET.indexOf(s[i]) + 1) % ALPHABET.length]
  return s.slice(0, i) + replacement + s.slice(i + 1)
}

function rewritePrefix(token: string, from: string, to: string): string {
  return to + token.slice(from.length)
}

describe('sbm1_ model token', () => {
  it('round-trips and is recognised only as a model token', () => {
    const token = sealModelToken(MODEL, key)
    expect(token).toMatch(/^sbm1_[A-Za-z0-9_-]+$/)
    expect(isModelTokenShape(token)).toBe(true)
    expect(isBuilderTokenShape(token)).toBe(false)
    expect(isWidgetTokenShape(token)).toBe(false)
    expect(openModelToken(token, key)).toEqual(MODEL)
  })

  it('does not reveal the key, the host or the base URL path', () => {
    const token = sealModelToken(MODEL, key)
    expect(token).not.toContain('PLAINTEXTKEY')
    expect(token).not.toContain('secret-path')
    expect(token).not.toContain('api.example.com')
  })

  it('rejects every single-character change, truncation and a different key', () => {
    const token = sealModelToken(MODEL, key)
    for (let i = 0; i < token.length; i++) {
      const tampered = replaceAt(token, i)
      expect(tampered).not.toBe(token)
      expect(openModelToken(tampered, key)).toBeNull()
    }
    expect(openModelToken(token.slice(0, -1), key)).toBeNull()
    expect(openModelToken(token, randomBytes(32))).toBeNull()
  })

  it('rejects non-strings, junk and oversized input without throwing', () => {
    expect(openModelToken(undefined, key)).toBeNull()
    expect(openModelToken(42, key)).toBeNull()
    expect(openModelToken('sbm1_', key)).toBeNull()
    expect(openModelToken('sbm1_!!!', key)).toBeNull()
    expect(openModelToken('sbm1_' + 'A'.repeat(MAX_TOKEN_LENGTH), key)).toBeNull()
  })

  it.each([
    ['a non-http URL', { ...MODEL, baseUrl: 'ftp://api.example.com/v1' }],
    ['a URL with a query', { ...MODEL, baseUrl: 'https://api.example.com/v1?x=1' }],
    ['an over-long URL', { ...MODEL, baseUrl: 'https://api.example.com/' + 'a'.repeat(MODEL_LIMITS.baseUrl) }],
    ['a model ID with a space', { ...MODEL, model: 'gpt 4' }],
    ['an over-long model ID', { ...MODEL, model: 'm'.repeat(MODEL_LIMITS.modelId + 1) }],
    ['an empty key', { ...MODEL, apiKey: '' }],
    ['a key with a space', { ...MODEL, apiKey: 'sk test' }],
    ['an over-long key', { ...MODEL, apiKey: 'k'.repeat(MODEL_LIMITS.apiKey + 1) }],
  ])('seals but refuses to open %s', (_name, config) => {
    expect(openModelToken(sealModelToken(config, key), key)).toBeNull()
  })

  it('accepts a private base URL as a shape (the SSRF guard runs again at call time)', () => {
    const config = { ...MODEL, baseUrl: 'http://127.0.0.1:11434/v1' }
    expect(openModelToken(sealModelToken(config, key), key)).toEqual(config)
  })
})

describe('purpose binding across sbm1_, sbb1_, sbw1_ and sbw2_', () => {
  const builder = sealBuilderToken({ conn: CONN, workspaceId: randomUUID() }, key)
  const widgetV1 = sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() }, key)
  const widgetV2 = sealWidgetTokenV2(
    { source: { kind: 'memory', widgetKey: 'widget-abc' }, origins: ['https://shop.example.com'], model: MODEL },
    key,
  )
  const model = sealModelToken(MODEL, key)

  it('refuses each other token as a model token, as-is and with the prefix rewritten', () => {
    for (const [token, prefix] of [
      [builder, BUILDER_TOKEN_PREFIX],
      [widgetV1, WIDGET_TOKEN_PREFIX],
      [widgetV2, WIDGET_TOKEN_V2_PREFIX],
    ] as const) {
      expect(openModelToken(token, key)).toBeNull()
      expect(openModelToken(rewritePrefix(token, prefix, MODEL_TOKEN_PREFIX), key)).toBeNull()
    }
  })

  it('refuses a model token as every other token, as-is and with the prefix rewritten', () => {
    expect(openBuilderToken(model, key)).toBeNull()
    expect(openWidgetToken(model, key)).toBeNull()
    expect(openWidgetTokenV2(model, key)).toBeNull()
    expect(openBuilderToken(rewritePrefix(model, MODEL_TOKEN_PREFIX, BUILDER_TOKEN_PREFIX), key)).toBeNull()
    expect(openWidgetToken(rewritePrefix(model, MODEL_TOKEN_PREFIX, WIDGET_TOKEN_PREFIX), key)).toBeNull()
    expect(openWidgetTokenV2(rewritePrefix(model, MODEL_TOKEN_PREFIX, WIDGET_TOKEN_V2_PREFIX), key)).toBeNull()
  })
})

describe('sbw2_ with a model', () => {
  const source = { kind: 'postgres' as const, conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() }

  it('round-trips the model next to the source and origins', () => {
    const payload: WidgetTokenV2Payload = { source, origins: ['https://shop.example.com'], model: MODEL }
    const token = sealWidgetTokenV2(payload, key)
    expect(openWidgetTokenV2(token, key)).toEqual(payload)
    expect(token).not.toContain('PLAINTEXTKEY')
    expect(token).not.toContain('secret-path')
  })

  it('leaves model unset when the token has none', () => {
    const opened = openWidgetTokenV2(sealWidgetTokenV2({ source, origins: [] }, key), key)
    expect(opened).toEqual({ source, origins: [] })
    expect(opened && 'model' in opened).toBe(false)
  })

  it('rejects every single-character change of a token carrying a model', () => {
    const token = sealWidgetTokenV2({ source: { kind: 'memory', widgetKey: 'widget-abc' }, origins: [], model: MODEL }, key)
    for (let i = 0; i < token.length; i++) expect(openWidgetTokenV2(replaceAt(token, i), key)).toBeNull()
  })

  it.each([
    ['a bad base URL', { ...MODEL, baseUrl: 'not a url' }],
    ['a bad model ID', { ...MODEL, model: 'has space' }],
    ['an over-long key', { ...MODEL, apiKey: 'k'.repeat(MODEL_LIMITS.apiKey + 1) }],
    ['a missing key', { baseUrl: MODEL.baseUrl, model: MODEL.model }],
  ])('seals but refuses to open %s', (_name, model) => {
    const token = sealWidgetTokenV2({ source, origins: [], model: model as OwnerModelConfig }, key)
    expect(openWidgetTokenV2(token, key)).toBeNull()
  })
})

describe('AC 34: worst-case embed token size', () => {
  const SEEDS = 200

  it('fits every seeded worst case under the cap and in an 8,000-char script URL', () => {
    let maxToken = 0
    let maxUrl = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = seededRandom(seed)
      const payload: WidgetTokenV2Payload = {
        source: { kind: 'postgres', conn: worstCaseConnection(rand), workspaceId: seededUuid(rand), widgetId: seededUuid(rand) },
        origins: Array.from({ length: 10 }, () => worstCaseOrigin(rand)),
        model: worstCaseModel(rand),
      }
      expect(payload.source.kind === 'postgres' && payload.source.conn).toHaveLength(3000)
      for (const o of payload.origins) expect(o).toHaveLength(255)
      expect(payload.model?.baseUrl).toHaveLength(MODEL_LIMITS.baseUrl)
      expect(payload.model?.model).toHaveLength(MODEL_LIMITS.modelId)
      expect(payload.model?.apiKey).toHaveLength(MODEL_LIMITS.apiKey)

      const token = sealWidgetTokenV2(payload, key)
      const url = `https://${'a'.repeat(80)}.example/api/widget/script/${token}`
      maxToken = Math.max(maxToken, token.length)
      maxUrl = Math.max(maxUrl, url.length)
      expect(token.length).toBeLessThanOrEqual(MAX_WIDGET_TOKEN_V2_LENGTH)
      expect(url.length).toBeLessThanOrEqual(8000)
      if (seed === 1) expect(openWidgetTokenV2(token, key)).toEqual(payload)
    }
    console.log(
      `AC 34 worst case over ${SEEDS} seeds: sbw2_ token ${maxToken} chars, script URL ${maxUrl} chars ` +
        `(cap ${MAX_WIDGET_TOKEN_V2_LENGTH}, URL limit 8000)`,
    )
  })

  it('keeps the worst-case sbm1_ model token under the plain token cap', () => {
    let maxToken = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      const config = worstCaseModel(seededRandom(seed))
      const token = sealModelToken(config, key)
      maxToken = Math.max(maxToken, token.length)
      expect(openModelToken(token, key)).toEqual(config)
    }
    expect(maxToken).toBeLessThanOrEqual(MAX_TOKEN_LENGTH)
    console.log(`Worst-case sbm1_ model token over ${SEEDS} seeds: ${maxToken} chars (cap ${MAX_TOKEN_LENGTH})`)
  })
})

describe('resolveBuilderModel', () => {
  const savedEnv = { ...process.env }

  function req(token?: string): Request {
    const headers = new Headers()
    if (token !== undefined) headers.set(MODEL_TOKEN_HEADER, token)
    return new Request('http://localhost/api/chat', { method: 'POST', headers })
  }

  beforeEach(() => {
    process.env = { ...savedEnv, EMBED_TOKEN_KEY: key.toString('base64') }
  })

  afterAll(() => {
    process.env = savedEnv
  })

  it('returns no model when there is no header, even with storage disabled', () => {
    expect(resolveBuilderModel(req())).toEqual({ ok: true, model: null })
    delete process.env.EMBED_TOKEN_KEY
    expect(resolveBuilderModel(req())).toEqual({ ok: true, model: null })
  })

  it('opens a model token', () => {
    expect(resolveBuilderModel(req(sealModelToken(MODEL)))).toEqual({ ok: true, model: MODEL })
  })

  it('returns model_unavailable when no key is configured', () => {
    const token = sealModelToken(MODEL)
    delete process.env.EMBED_TOKEN_KEY
    const r = resolveBuilderModel(req(token))
    expect(!r.ok && r.error.code).toBe('model_unavailable')
  })

  it.each(['sbb1_junk', 'sbw1_junk', 'sbw2_junk'])('refuses %s as wrong purpose before decrypting', (header) => {
    const r = resolveBuilderModel(req(header))
    expect(!r.ok && r.error.code).toBe('model_token_wrong_purpose')
  })

  it('refuses real builder and widget tokens as wrong purpose', () => {
    for (const token of [
      sealBuilderToken({ conn: CONN, workspaceId: randomUUID() }),
      sealWidgetToken({ conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() }),
      sealWidgetTokenV2({ source: { kind: 'memory', widgetKey: 'widget-abc' }, origins: [], model: MODEL }),
    ]) {
      const r = resolveBuilderModel(req(token))
      expect(!r.ok && r.error.code).toBe('model_token_wrong_purpose')
    }
  })

  it.each([
    ['tampered', () => replaceAt(sealModelToken(MODEL), 30)],
    ['sealed under another key', () => sealModelToken(MODEL, randomBytes(32))],
    ['junk', () => 'garbage'],
    ['empty', () => ''],
  ])('returns model_token_invalid for a %s token', (_name, make) => {
    const r = resolveBuilderModel(req(make()))
    expect(!r.ok && r.error.code).toBe('model_token_invalid')
  })

  it('does not read the storage header', () => {
    const headers = new Headers({ [STORAGE_TOKEN_HEADER]: sealModelToken(MODEL) })
    expect(resolveBuilderModel(new Request('http://localhost/api/chat', { headers }))).toEqual({ ok: true, model: null })
  })
})

describe('modelErrorResponse', () => {
  it('returns the fixed body and status', async () => {
    const res = modelErrorResponse(new ModelError('model_token_wrong_purpose'))
    expect(res.status).toBe(403)
    const msg = MODEL_ERROR_MESSAGES.model_token_wrong_purpose
    expect(await res.json()).toEqual({ error: msg, code: 'model_token_wrong_purpose', details: msg })
  })

  it('includes the HTTP status only for model_http_error', async () => {
    const res = modelErrorResponse(new ModelError('model_http_error', 418))
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('The provider returned an error (HTTP 418).')
  })
})

const CONN_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~%'
const HOST_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789'
// Every printable character the URL parser keeps as-is in a path, minus '/' so no dot segments form.
const PATH_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@[]|%"
const MODEL_ID_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:/@-'
const API_KEY_CHARSET = Array.from({ length: 0x7e - 0x21 + 1 }, (_, i) => String.fromCharCode(0x21 + i)).join('')

function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomChars(rand: () => number, charset: string, n: number): string {
  let out = ''
  for (let i = 0; i < n; i++) out += charset[Math.floor(rand() * charset.length)]
  return out
}

function seededUuid(rand: () => number): string {
  const h = randomChars(rand, '0123456789abcdef', 32)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`
}

function worstCaseConnection(rand: () => number): string {
  const head = 'postgresql://'
  const tail = '@db.example.com:5432/app?sslmode=verify-full'
  const user = randomChars(rand, CONN_CHARSET, 60)
  return head + user + ':' + randomChars(rand, CONN_CHARSET, 3000 - head.length - user.length - 1 - tail.length) + tail
}

function worstCaseOrigin(rand: () => number): string {
  const head = 'https://'
  const labels: string[] = []
  let length = head.length
  while (length < 255) {
    const room = 255 - length - (labels.length ? 1 : 0)
    const n = Math.min(63, room)
    labels.push(randomChars(rand, HOST_CHARSET, n))
    length += n + (labels.length > 1 ? 1 : 0)
  }
  return head + labels.join('.')
}

// Already in the normalised form validateModelInput would seal.
function worstCaseModel(rand: () => number): OwnerModelConfig {
  const head = `https://${randomChars(rand, HOST_CHARSET, 63)}.example/`
  const baseUrl = head + randomChars(rand, PATH_CHARSET, MODEL_LIMITS.baseUrl - head.length)
  const checked = checkModelBaseUrl(baseUrl, { allowPrivate: false })
  if (!checked.ok || checked.baseUrl !== baseUrl) throw new Error('worst-case base URL does not normalise to itself')
  return {
    baseUrl,
    model: randomChars(rand, MODEL_ID_CHARSET, MODEL_LIMITS.modelId),
    apiKey: randomChars(rand, API_KEY_CHARSET, MODEL_LIMITS.apiKey),
  }
}
