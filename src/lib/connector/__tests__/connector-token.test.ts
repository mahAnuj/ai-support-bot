/** @jest-environment node */
import { randomBytes } from 'node:crypto'
import { MODEL_LIMITS, type OwnerModelConfig } from '../../model/shared'
import { checkModelBaseUrl } from '../../model/url-guard'
import { StorageError } from '../../storage/errors'
import {
  BUILDER_TOKEN_PREFIX,
  CONNECTOR_TOKEN_PREFIX,
  MAX_TOKEN_LENGTH,
  MAX_WIDGET_TOKEN_V3_LENGTH,
  MODEL_TOKEN_PREFIX,
  WIDGET_TOKEN_V2_PREFIX,
  WIDGET_TOKEN_V3_PREFIX,
  isBuilderTokenShape,
  isConnectorTokenShape,
  isModelTokenShape,
  isWidgetTokenShape,
  openBuilderToken,
  openModelToken,
  openWidgetTokenV2,
  sealPrefixed,
  sealWidgetTokenV2,
} from '../../storage/token'
import { CONNECTOR_LIMITS, type ConnectorConfig, type WidgetTokenV3Payload } from '../shared'
import {
  MAX_WIDGET_TOKEN_V3_PLAINTEXT_BYTES,
  openConnectorToken,
  openWidgetTokenV3,
  sealConnectorToken,
  sealWidgetTokenV3,
  type ConnectorTokenPayload,
} from '../token'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
const key = randomBytes(32)

const CONNECTOR: ConnectorConfig = {
  baseUrl: 'https://support.example.com/pathsentinel-q9z4',
  keyId: 'ck_0123456789abcdef',
  secret: 'SECRETsentinel_'.padEnd(43, 'A'),
}
const MODEL: OwnerModelConfig = {
  baseUrl: 'https://api.example.com/model-path/v1',
  model: 'openai/gpt-oss-20b',
  apiKey: 'sk-test-SENTINEL-model-001',
}
const SETTINGS = {
  title: 'Shop help',
  welcomeMessage: 'Hi! Ask me about orders.',
  primaryColor: '#1E6B58',
  position: 'bottom-right' as const,
  size: 'medium' as const,
}

function v3(overrides: Partial<WidgetTokenV3Payload> = {}): WidgetTokenV3Payload {
  return { connector: CONNECTOR, origins: ['https://shop.example.com'], answer: false, settings: SETTINGS, ...overrides }
}

function replaceAt(s: string, i: number): string {
  const replacement = ALPHABET[(ALPHABET.indexOf(s[i]) + 1) % ALPHABET.length]
  return s.slice(0, i) + replacement + s.slice(i + 1)
}

function relabel(token: string, from: string, to: string): string {
  return to + token.slice(from.length)
}

function sealV3Json(body: Record<string, unknown>): string {
  return sealPrefixed(WIDGET_TOKEN_V3_PREFIX, JSON.stringify(body), key, true)
}

const V3_BASE_JSON = {
  v: 3,
  p: 'w',
  c: { u: CONNECTOR.baseUrl, k: CONNECTOR.keyId, s: CONNECTOR.secret },
  o: ['https://shop.example.com'],
  a: false,
  t: 'Shop help',
  wm: 'Hi',
  pc: '#1E6B58',
  ps: 'bottom-right',
  sz: 'medium',
}

describe('sbc1_ builder connector token', () => {
  const payload: ConnectorTokenPayload = { ...CONNECTOR, answer: true }

  it('round-trips and is recognised only as a connector token', () => {
    const token = sealConnectorToken(payload, key)
    expect(token).toMatch(/^sbc1_[A-Za-z0-9_-]+$/)
    expect(isConnectorTokenShape(token)).toBe(true)
    expect(isBuilderTokenShape(token)).toBe(false)
    expect(isWidgetTokenShape(token)).toBe(false)
    expect(isModelTokenShape(token)).toBe(false)
    expect(openConnectorToken(token, key)).toEqual(payload)
    expect(openConnectorToken(sealConnectorToken({ ...payload, answer: false }, key), key)).toEqual({ ...payload, answer: false })
  })

  it('does not reveal the secret, the base URL path or the key id', () => {
    const token = sealConnectorToken(payload, key)
    expect(token).not.toContain('SECRETsentinel')
    expect(token).not.toContain('pathsentinel')
    expect(token).not.toContain('0123456789abcdef')
    expect(token).not.toContain('support.example.com')
  })

  it('rejects every single-character change, truncation and a different key', () => {
    const token = sealConnectorToken(payload, key)
    for (let i = 0; i < token.length; i++) {
      const tampered = replaceAt(token, i)
      expect(tampered).not.toBe(token)
      expect(openConnectorToken(tampered, key)).toBeNull()
    }
    expect(openConnectorToken(token.slice(0, -1), key)).toBeNull()
    expect(openConnectorToken(token, randomBytes(32))).toBeNull()
  })

  it('does not open across a prefix relabel in either direction', () => {
    const token = sealConnectorToken(payload, key)
    expect(openBuilderToken(relabel(token, CONNECTOR_TOKEN_PREFIX, BUILDER_TOKEN_PREFIX), key)).toBeNull()
    expect(openModelToken(relabel(token, CONNECTOR_TOKEN_PREFIX, MODEL_TOKEN_PREFIX), key)).toBeNull()
    const builder = sealPrefixed(BUILDER_TOKEN_PREFIX, JSON.stringify({ v: 1, p: 'c', u: CONNECTOR.baseUrl, k: CONNECTOR.keyId, s: CONNECTOR.secret, a: true }), key)
    expect(openConnectorToken(relabel(builder, BUILDER_TOKEN_PREFIX, CONNECTOR_TOKEN_PREFIX), key)).toBeNull()
    const model = sealPrefixed(MODEL_TOKEN_PREFIX, JSON.stringify({ v: 1, p: 'c', u: CONNECTOR.baseUrl, k: CONNECTOR.keyId, s: CONNECTOR.secret, a: true }), key)
    expect(openConnectorToken(relabel(model, MODEL_TOKEN_PREFIX, CONNECTOR_TOKEN_PREFIX), key)).toBeNull()
  })

  it('rejects non-strings, junk and oversized input without throwing', () => {
    expect(openConnectorToken(undefined, key)).toBeNull()
    expect(openConnectorToken(42, key)).toBeNull()
    expect(openConnectorToken('sbc1_', key)).toBeNull()
    expect(openConnectorToken('sbc1_!!!', key)).toBeNull()
    expect(openConnectorToken('sbc1_' + 'A'.repeat(MAX_TOKEN_LENGTH), key)).toBeNull()
  })

  const good = { v: 1, p: 'c', u: CONNECTOR.baseUrl, k: CONNECTOR.keyId, s: CONNECTOR.secret, a: true }
  it.each([
    ['an extra field', { ...good, x: 1 }],
    ['version 2', { ...good, v: 2 }],
    ['the widget purpose', { ...good, p: 'w' }],
    ['a non-boolean answer flag', { ...good, a: 'true' }],
    ['a missing answer flag', { v: 1, p: 'c', u: good.u, k: good.k, s: good.s }],
    ['a bad key id', { ...good, k: 'ck_XYZ' }],
    ['a short secret', { ...good, s: 'abc' }],
    ['a non-http base URL', { ...good, u: 'ftp://support.example.com' }],
    ['a base URL with a query', { ...good, u: 'https://support.example.com?x=1' }],
    ['an over-long base URL', { ...good, u: 'https://support.example.com/' + 'a'.repeat(CONNECTOR_LIMITS.baseUrl) }],
  ])('seals but refuses to open %s', (_name, body) => {
    expect(openConnectorToken(sealPrefixed(CONNECTOR_TOKEN_PREFIX, JSON.stringify(body), key), key)).toBeNull()
  })

  it('accepts a private base URL as a shape (the live policy is applied by the resolver and the client)', () => {
    const p = { ...payload, baseUrl: 'http://127.0.0.1:8080' }
    expect(openConnectorToken(sealConnectorToken(p, key), key)).toEqual(p)
  })

  it('keeps the largest sbc1_ (500-char base URL) under the plain token cap', () => {
    let maxToken = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = seededRandom(seed)
      const p: ConnectorTokenPayload = { ...worstCaseConnector(rand), answer: true }
      const token = sealConnectorToken(p, key)
      maxToken = Math.max(maxToken, token.length)
      expect(openConnectorToken(token, key)).toEqual(p)
    }
    expect(maxToken).toBeLessThanOrEqual(MAX_TOKEN_LENGTH)
    console.log(`Worst-case sbc1_ connector token over ${SEEDS} seeds: ${maxToken} chars (cap ${MAX_TOKEN_LENGTH})`)
  })
})

describe('sbw3_ connector widget token', () => {
  it('round-trips with and without a model and prompts', () => {
    const withModel = v3({ model: MODEL, settings: { ...SETTINGS, systemPrompt: 'Be brief.', roleContext: 'Shop staff.' } })
    const token = sealWidgetTokenV3(withModel, key)
    expect(token).toMatch(/^sbw3_[A-Za-z0-9_-]+$/)
    expect(isWidgetTokenShape(token)).toBe(true)
    expect(isConnectorTokenShape(token)).toBe(false)
    expect(isBuilderTokenShape(token)).toBe(false)
    expect(isModelTokenShape(token)).toBe(false)
    expect(openWidgetTokenV3(token, key)).toEqual(withModel)

    const plain = v3({ answer: true })
    const opened = openWidgetTokenV3(sealWidgetTokenV3(plain, key), key)
    expect(opened).toEqual(plain)
    expect(opened && 'model' in opened).toBe(false)
    expect(opened && 'systemPrompt' in opened.settings).toBe(false)
  })

  it('never seals the owner model when the backend answers', () => {
    const opened = openWidgetTokenV3(sealWidgetTokenV3(v3({ answer: true, model: MODEL }), key), key)
    expect(opened).toEqual(v3({ answer: true }))
  })

  it('does not reveal the secret, the base URL path, the key id or the model key', () => {
    const token = sealWidgetTokenV3(v3({ model: MODEL }), key)
    expect(token).not.toContain('SECRETsentinel')
    expect(token).not.toContain('pathsentinel')
    expect(token).not.toContain('0123456789abcdef')
    expect(token).not.toContain('SENTINEL-model')
  })

  it('rejects every single-character change, truncation and a different key', () => {
    const token = sealWidgetTokenV3(v3({ model: MODEL }), key)
    for (let i = 0; i < token.length; i++) expect(openWidgetTokenV3(replaceAt(token, i), key)).toBeNull()
    expect(openWidgetTokenV3(token.slice(0, -1), key)).toBeNull()
    expect(openWidgetTokenV3(token, randomBytes(32))).toBeNull()
  })

  it('does not open across an sbw3_/sbw2_ relabel in either direction', () => {
    const token = sealWidgetTokenV3(v3(), key)
    expect(openWidgetTokenV2(relabel(token, WIDGET_TOKEN_V3_PREFIX, WIDGET_TOKEN_V2_PREFIX), key)).toBeNull()
    const v2 = sealWidgetTokenV2({ source: { kind: 'memory', widgetKey: 'widget-abc' }, origins: ['https://shop.example.com'] }, key)
    expect(openWidgetTokenV3(relabel(v2, WIDGET_TOKEN_V2_PREFIX, WIDGET_TOKEN_V3_PREFIX), key)).toBeNull()
    // Also with a v3-shaped body sealed under the v2 prefix.
    const v2Body = sealPrefixed(WIDGET_TOKEN_V2_PREFIX, JSON.stringify(V3_BASE_JSON), key, true)
    expect(openWidgetTokenV3(relabel(v2Body, WIDGET_TOKEN_V2_PREFIX, WIDGET_TOKEN_V3_PREFIX), key)).toBeNull()
  })

  it('fails to open when answer is true and a model is present', () => {
    const m = { u: MODEL.baseUrl, id: MODEL.model, k: MODEL.apiKey }
    expect(openWidgetTokenV3(sealV3Json({ ...V3_BASE_JSON, a: false, m }), key)).not.toBeNull()
    expect(openWidgetTokenV3(sealV3Json({ ...V3_BASE_JSON, a: true, m }), key)).toBeNull()
  })

  it('fails to open with no origins; normalised form is left to the resolver', () => {
    expect(openWidgetTokenV3(sealWidgetTokenV3(v3({ origins: [] }), key), key)).toBeNull()
    expect(openWidgetTokenV3(sealV3Json({ ...V3_BASE_JSON, o: Array(11).fill('https://a.example') }), key)).toBeNull()
    // Shape-valid but not normalised: the token opens and resolveWidget refuses it (Task 5).
    const opened = openWidgetTokenV3(sealWidgetTokenV3(v3({ origins: ['HTTPS://Shop.Example.com:443/'] }), key), key)
    expect(opened?.origins).toEqual(['HTTPS://Shop.Example.com:443/'])
  })

  it.each([
    ['an extra field', { x: 1 }],
    ['version 2', { v: 2 }],
    ['a builder purpose', { p: 'b' }],
    ['an extra connector field', { c: { ...V3_BASE_JSON.c, x: 1 } }],
    ['a bad key id', { c: { ...V3_BASE_JSON.c, k: 'ck_nothex' } }],
    ['a bad secret', { c: { ...V3_BASE_JSON.c, s: 'short' } }],
    ['a bad base URL', { c: { ...V3_BASE_JSON.c, u: 'not a url' } }],
    ['a non-boolean answer flag', { a: 1 }],
    ['an empty title', { t: '' }],
    ['an over-long title', { t: 't'.repeat(101) }],
    ['an over-long welcome', { wm: 'w'.repeat(501) }],
    ['a bad colour', { pc: 'red' }],
    ['a bad position', { ps: 'top' }],
    ['a bad size', { sz: 'huge' }],
    ['an over-long system prompt', { sp: 's'.repeat(4001) }],
    ['an over-long role context', { rc: 'r'.repeat(2001) }],
    ['a non-string system prompt', { sp: 5 }],
    ['a bad model', { m: { u: MODEL.baseUrl, id: 'has space', k: MODEL.apiKey } }],
  ])('seals but refuses to open %s', (_name, change) => {
    expect(openWidgetTokenV3(sealV3Json({ ...V3_BASE_JSON, ...change }), key)).toBeNull()
  })

  it('opens a highly compressible plaintext larger than the 16 KiB sbw2_ inflate cap', () => {
    // 4,000 control characters escape to \u0001 each: about 24 KB of JSON that compresses to almost nothing.
    const payload = v3({ settings: { ...SETTINGS, systemPrompt: '\u0001'.repeat(4000), roleContext: '\u0002'.repeat(2000) } })
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(16384)
    const token = sealWidgetTokenV3(payload, key)
    expect(openWidgetTokenV3(token, key)).toEqual(payload)
  })

  it('refuses to seal a plaintext over 64 KiB, and anything over the cap', () => {
    const huge = v3({ settings: { ...SETTINGS, systemPrompt: '\u0001'.repeat(MAX_WIDGET_TOKEN_V3_PLAINTEXT_BYTES / 6 + 1) } })
    expect(() => sealWidgetTokenV3(huge, key, { cap: Infinity })).toThrow(StorageError)
    expect(() => sealWidgetTokenV3(v3(), key, { cap: 10 })).toThrow('embed_too_large')
  })
})

const SEEDS = 200
const HOST = `https://${'a'.repeat(80)}.example`
const SCRIPT_PATH = '/api/widget/script/'

describe('D2: worst-case sbw3_ embed token size', () => {
  function measure(profile: (rand: () => number) => WidgetTokenV3Payload) {
    let largestToken = 0
    let largestScriptUrl = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      const payload = profile(seededRandom(seed))
      const token = sealWidgetTokenV3(payload, key, { cap: Infinity })
      largestToken = Math.max(largestToken, token.length)
      largestScriptUrl = Math.max(largestScriptUrl, (HOST + SCRIPT_PATH + token).length)
      if (seed === 1 && token.length <= MAX_WIDGET_TOKEN_V3_LENGTH) expect(openWidgetTokenV3(token, key)).toEqual(payload)
    }
    return { largestToken, largestScriptUrl }
  }

  it('uses an 88-character host name for the script URL budget', () => {
    expect(new URL(HOST).hostname).toHaveLength(88)
  })

  it('(a) refuses the full random worst case: it is above the cap', () => {
    const profile = (rand: () => number) => worstCasePayload(rand, { prompts: 'random' })
    const sample = profile(seededRandom(1))
    expect(sample.connector.baseUrl).toHaveLength(CONNECTOR_LIMITS.baseUrl)
    expect(sample.origins).toHaveLength(10)
    for (const o of sample.origins) expect(o).toHaveLength(255)
    expect(sample.settings.title).toHaveLength(100)
    expect(sample.settings.welcomeMessage).toHaveLength(500)
    expect(sample.settings.systemPrompt).toHaveLength(4000)
    expect(sample.settings.roleContext).toHaveLength(2000)
    expect(sample.model?.baseUrl).toHaveLength(MODEL_LIMITS.baseUrl)
    expect(sample.model?.model).toHaveLength(MODEL_LIMITS.modelId)
    expect(sample.model?.apiKey).toHaveLength(MODEL_LIMITS.apiKey)

    const result = measure(profile)
    console.log(`D2 profile (a) full random worst case over ${SEEDS} seeds: ${JSON.stringify(result)} (cap ${MAX_WIDGET_TOKEN_V3_LENGTH}, URL limit 8000)`)
    expect(result.largestToken).toBeGreaterThan(MAX_WIDGET_TOKEN_V3_LENGTH)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const payload = profile(seededRandom(seed))
      expect(() => sealWidgetTokenV3(payload, key)).toThrow('embed_too_large')
    }
  })

  it('(b) fits the same worst case without a system prompt or role context', () => {
    const result = measure((rand) => worstCasePayload(rand, { prompts: 'none' }))
    console.log(`D2 profile (b) worst case without sp/rc over ${SEEDS} seeds: ${JSON.stringify(result)} (cap ${MAX_WIDGET_TOKEN_V3_LENGTH}, URL limit 8000)`)
    expect(result.largestToken).toBeLessThanOrEqual(MAX_WIDGET_TOKEN_V3_LENGTH)
    expect(result.largestScriptUrl).toBeLessThanOrEqual(CONNECTOR_LIMITS.maxScriptUrl)
  })

  it('(c) fits the worst case with English-like prompts at maximum length', () => {
    const profile = (rand: () => number) => worstCasePayload(rand, { prompts: 'sentences' })
    const sample = profile(seededRandom(1))
    expect(sample.settings.systemPrompt).toHaveLength(4000)
    expect(sample.settings.roleContext).toHaveLength(2000)
    const result = measure(profile)
    console.log(`D2 profile (c) English-like sp 4000 / rc 2000 (support sentences in seeded order) over ${SEEDS} seeds: ${JSON.stringify(result)} (cap ${MAX_WIDGET_TOKEN_V3_LENGTH}, URL limit 8000)`)
    expect(result.largestToken).toBeLessThanOrEqual(MAX_WIDGET_TOKEN_V3_LENGTH)
    expect(result.largestScriptUrl).toBeLessThanOrEqual(CONNECTOR_LIMITS.maxScriptUrl)
    for (let seed = 1; seed <= SEEDS; seed++) expect(() => sealWidgetTokenV3(profile(seededRandom(seed)), key)).not.toThrow()
  })

  // Measured, not a design profile: varied prose compresses far less than repeated sentences.
  it('(d) varied English-like prompts at maximum length: seal refuses whatever is above the cap', () => {
    const profile = (rand: () => number) => worstCasePayload(rand, { prompts: 'words' })
    const result = measure(profile)
    console.log(`D2 profile (d) varied English-like sp 4000 / rc 2000 (random words) over ${SEEDS} seeds: ${JSON.stringify(result)} (cap ${MAX_WIDGET_TOKEN_V3_LENGTH}, URL limit 8000)`)
    for (let seed = 1; seed <= SEEDS; seed++) {
      const payload = profile(seededRandom(seed))
      const length = sealWidgetTokenV3(payload, key, { cap: Infinity }).length
      if (length > MAX_WIDGET_TOKEN_V3_LENGTH) expect(() => sealWidgetTokenV3(payload, key)).toThrow('embed_too_large')
      else expect(openWidgetTokenV3(sealWidgetTokenV3(payload, key), key)).toEqual(payload)
    }
  })

  it('(e) a typical embed with varied prompts at maximum length fits', () => {
    const result = measure((rand) => typicalPayload(rand))
    console.log(`D2 profile (e) typical embed (short URLs, 2 sites) with varied sp 4000 / rc 2000 over ${SEEDS} seeds: ${JSON.stringify(result)} (cap ${MAX_WIDGET_TOKEN_V3_LENGTH}, URL limit 8000)`)
    expect(result.largestToken).toBeLessThanOrEqual(MAX_WIDGET_TOKEN_V3_LENGTH)
    expect(result.largestScriptUrl).toBeLessThanOrEqual(CONNECTOR_LIMITS.maxScriptUrl)
  })
})

const HOST_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const HEX = '0123456789abcdef'
const SECRET_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
// Every printable character the URL parser keeps as-is in a path, minus '/' so no dot segments form.
const PATH_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@[]|%"
const MODEL_ID_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:/@-'
const PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('')
const API_KEY_CHARSET = PRINTABLE.slice(1)
const WORDS = (
  'the a an and or but if then when you your we our us it this that these those is are was be can will should ' +
  'please always never only answer question customer order orders shipping delivery return returns refund refunds ' +
  'invoice account password login help support team store shop product products price prices discount code ' +
  'payment card bank transfer days business week hours contact email phone chat agent friendly polite short clear ' +
  'answer explain steps list link page policy terms warranty size colour stock available item items cart checkout ' +
  'track tracking number address country international local fee fees free over under within after before ' +
  'customers ask about how what why where which who do does not no yes more less most best first next last ' +
  'use using used give keep make sure check include mention avoid guess unknown say sorry thanks thank welcome'
).split(' ')

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

function englishText(rand: () => number, n: number): string {
  let out = ''
  let sentenceStart = true
  while (out.length < n) {
    let word = WORDS[Math.floor(rand() * WORDS.length)]
    if (sentenceStart) word = word[0].toUpperCase() + word.slice(1)
    sentenceStart = rand() < 0.08
    out += word + (sentenceStart ? '. ' : rand() < 0.05 ? ', ' : ' ')
  }
  return out.slice(0, n)
}

// A 500-character https base URL that checkModelBaseUrl keeps as-is.
function worstCaseBaseUrl(rand: () => number, limit: number): string {
  const head = `https://${randomChars(rand, HOST_CHARSET, 63)}.example/`
  const url = head + randomChars(rand, PATH_CHARSET, limit - head.length)
  const checked = checkModelBaseUrl(url, { allowPrivate: false })
  if (!checked.ok || checked.baseUrl !== url) throw new Error('worst-case base URL does not normalise to itself')
  return url
}

function worstCaseConnector(rand: () => number): ConnectorConfig {
  return {
    baseUrl: worstCaseBaseUrl(rand, CONNECTOR_LIMITS.baseUrl),
    keyId: 'ck_' + randomChars(rand, HEX, 16),
    secret: randomChars(rand, SECRET_CHARSET, 43),
  }
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

const SUPPORT_SENTENCES = [
  'You are a friendly support assistant for our online shop.',
  'Answer questions about orders, shipping, returns and refunds.',
  'Keep every answer short and clear, and use the documents provided.',
  'If you do not know the answer, say so and suggest contacting the support team by email.',
  'Never guess prices, delivery dates or stock levels.',
  'Customers can return most items within 30 days of delivery.',
  'Refunds are paid to the original payment method within five business days.',
  'Orders over 50 euros ship for free inside the European Union.',
  'Be polite, thank the customer for their patience, and avoid jargon.',
  'Do not ask for card numbers, passwords or other personal details.',
  'When a question is about an existing order, ask for the order number first.',
  'Mention the returns page when a customer wants to send something back.',
]

// Sentences from a fixed set of support-prompt lines in seeded order: how a long hand-written prompt tends to read.
function sentenceText(rand: () => number, n: number): string {
  let out = ''
  while (out.length < n) out += SUPPORT_SENTENCES[Math.floor(rand() * SUPPORT_SENTENCES.length)] + ' '
  return out.slice(0, n)
}

function typicalPayload(rand: () => number): WidgetTokenV3Payload {
  return {
    connector: { baseUrl: 'https://support.' + randomChars(rand, HOST_CHARSET, 12) + '.com', keyId: 'ck_' + randomChars(rand, HEX, 16), secret: randomChars(rand, SECRET_CHARSET, 43) },
    origins: ['https://www.' + randomChars(rand, HOST_CHARSET, 12) + '.com', 'https://shop.' + randomChars(rand, HOST_CHARSET, 12) + '.com'],
    answer: false,
    settings: {
      title: 'Help',
      welcomeMessage: 'Hi! How can I help you today?',
      primaryColor: '#' + randomChars(rand, HEX, 6),
      position: 'bottom-right',
      size: 'medium',
      systemPrompt: englishText(rand, 4000),
      roleContext: englishText(rand, 2000),
    },
    model: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test-' + randomChars(rand, SECRET_CHARSET, 156) },
  }
}

function worstCasePayload(rand: () => number, opts: { prompts: 'random' | 'sentences' | 'words' | 'none' }): WidgetTokenV3Payload {
  const connector = worstCaseConnector(rand)
  const origins = Array.from({ length: 10 }, () => worstCaseOrigin(rand))
  const settings: WidgetTokenV3Payload['settings'] = {
    title: randomChars(rand, PRINTABLE, CONNECTOR_LIMITS.widgetTitle),
    welcomeMessage: randomChars(rand, PRINTABLE, CONNECTOR_LIMITS.widgetWelcome),
    primaryColor: '#' + randomChars(rand, HEX, 6),
    position: 'bottom-left',
    size: 'medium',
  }
  if (opts.prompts === 'random') {
    settings.systemPrompt = randomChars(rand, PRINTABLE, 4000)
    settings.roleContext = randomChars(rand, PRINTABLE, 2000)
  } else if (opts.prompts === 'sentences') {
    settings.systemPrompt = sentenceText(rand, 4000)
    settings.roleContext = sentenceText(rand, 2000)
  } else if (opts.prompts === 'words') {
    settings.systemPrompt = englishText(rand, 4000)
    settings.roleContext = englishText(rand, 2000)
  }
  const model: OwnerModelConfig = {
    baseUrl: worstCaseBaseUrl(rand, MODEL_LIMITS.baseUrl),
    model: randomChars(rand, MODEL_ID_CHARSET, MODEL_LIMITS.modelId),
    apiKey: randomChars(rand, API_KEY_CHARSET, MODEL_LIMITS.apiKey),
  }
  return { connector, origins, answer: false, settings, model }
}
