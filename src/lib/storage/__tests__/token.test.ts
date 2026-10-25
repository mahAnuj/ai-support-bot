/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { StorageError } from '../errors'
import {
  BUILDER_TOKEN_PREFIX,
  MAX_WIDGET_TOKEN_V2_LENGTH,
  WIDGET_TOKEN_PREFIX,
  WIDGET_TOKEN_V2_PREFIX,
  getTokenKey,
  isBuilderTokenShape,
  isWidgetTokenShape,
  openBuilderToken,
  openWidgetToken,
  openWidgetTokenV2,
  sealBuilderToken,
  sealWidgetToken,
  sealWidgetTokenV2,
  type WidgetTokenV2Payload,
} from '../token'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'
const CONN = 'postgresql://user:pw@db.example.com:5432/app?sslmode=verify-full'

const key = randomBytes(32)
const builderPayload = { conn: CONN, workspaceId: randomUUID() }
const widgetPayload = { conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() }

function replaceAt(s: string, i: number): string {
  const replacement = ALPHABET[(ALPHABET.indexOf(s[i]) + 1) % ALPHABET.length]
  return s.slice(0, i) + replacement + s.slice(i + 1)
}

describe('token round-trip', () => {
  it('opens a builder token it sealed', () => {
    const token = sealBuilderToken(builderPayload, key)
    expect(token.startsWith(BUILDER_TOKEN_PREFIX)).toBe(true)
    expect(isBuilderTokenShape(token)).toBe(true)
    expect(openBuilderToken(token, key)).toEqual(builderPayload)
  })

  it('opens a widget token it sealed', () => {
    const token = sealWidgetToken(widgetPayload, key)
    expect(token.startsWith(WIDGET_TOKEN_PREFIX)).toBe(true)
    expect(isWidgetTokenShape(token)).toBe(true)
    expect(openWidgetToken(token, key)).toEqual(widgetPayload)
  })

  it('uses a fresh IV per token', () => {
    expect(sealBuilderToken(builderPayload, key)).not.toBe(sealBuilderToken(builderPayload, key))
  })

  it('does not reveal the connection string', () => {
    expect(sealBuilderToken(builderPayload, key)).not.toContain('db.example.com')
  })
})

describe('token tampering', () => {
  it.each([
    ['builder', sealBuilderToken(builderPayload, key), openBuilderToken],
    ['widget', sealWidgetToken(widgetPayload, key), openWidgetToken],
  ] as const)('rejects every single-character change of a %s token', (_name, token, openFn) => {
    for (let i = 0; i < token.length; i++) {
      const tampered = replaceAt(token, i)
      expect(tampered).not.toBe(token)
      expect(openFn(tampered, key)).toBeNull()
    }
  })

  it('rejects truncated tokens', () => {
    const token = sealWidgetToken(widgetPayload, key)
    expect(openWidgetToken(token.slice(0, -1), key)).toBeNull()
    expect(openWidgetToken(token.slice(0, -20), key)).toBeNull()
  })

  it('rejects a token opened with a different key', () => {
    const token = sealBuilderToken(builderPayload, key)
    expect(openBuilderToken(token, randomBytes(32))).toBeNull()
  })

  it('rejects non-strings, wrong prefixes and oversized input without throwing', () => {
    expect(openBuilderToken(undefined, key)).toBeNull()
    expect(openBuilderToken(42, key)).toBeNull()
    expect(openBuilderToken('', key)).toBeNull()
    expect(openBuilderToken('sbb1_', key)).toBeNull()
    expect(openBuilderToken('sbb1_!!!', key)).toBeNull()
    expect(openBuilderToken('sbb1_' + 'A'.repeat(4000), key)).toBeNull()
  })
})

describe('token purpose binding', () => {
  it('rejects a builder token passed as a widget token', () => {
    const token = sealBuilderToken(builderPayload, key)
    expect(openWidgetToken(token, key)).toBeNull()
  })

  it('rejects a widget token with its prefix rewritten to the builder prefix', () => {
    const token = sealWidgetToken(widgetPayload, key)
    const rewritten = BUILDER_TOKEN_PREFIX + token.slice(WIDGET_TOKEN_PREFIX.length)
    expect(openBuilderToken(rewritten, key)).toBeNull()
  })
})

describe('getTokenKey', () => {
  it('rejects malformed and short keys', () => {
    expect(getTokenKey({ EMBED_TOKEN_KEY: 'abc' } as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(getTokenKey({ EMBED_TOKEN_KEY: randomBytes(31).toString('base64') } as unknown as NodeJS.ProcessEnv)).toBeNull()
    expect(getTokenKey({} as NodeJS.ProcessEnv)).toBeNull()
  })

  it('accepts a 32-byte base64 key, trimming whitespace', () => {
    const raw = randomBytes(32)
    const k = getTokenKey({ EMBED_TOKEN_KEY: ` ${raw.toString('base64')}\n` } as unknown as NodeJS.ProcessEnv)
    expect(k?.equals(raw)).toBe(true)
  })

  it('reads process.env at call time', () => {
    const saved = process.env.EMBED_TOKEN_KEY
    try {
      delete process.env.EMBED_TOKEN_KEY
      expect(() => sealBuilderToken(builderPayload)).toThrow(StorageError)
      expect(openBuilderToken(sealBuilderToken(builderPayload, key))).toBeNull()
      process.env.EMBED_TOKEN_KEY = key.toString('base64')
      expect(openBuilderToken(sealBuilderToken(builderPayload))).toEqual(builderPayload)
    } finally {
      if (saved === undefined) delete process.env.EMBED_TOKEN_KEY
      else process.env.EMBED_TOKEN_KEY = saved
    }
  })
})

describe('AC 24: widget token fits in a script URL', () => {
  it('stays URL-safe and under 2,000 characters for a plain 1,000-character connection string (no percent-encoding)', () => {
    const prefix = 'postgresql://u:p@db.example.com:5432/'
    const suffix = '?sslmode=verify-full'
    const conn = prefix + 'd'.repeat(1000 - prefix.length - suffix.length) + suffix
    expect(conn).toHaveLength(1000)
    const token = sealWidgetToken({ conn, workspaceId: randomUUID(), widgetId: randomUUID() }, key)
    expect(token).toMatch(/^sbw1_[A-Za-z0-9_-]+$/)
    expect(token.startsWith('widget-')).toBe(false)
    expect(('https://support-bot.example.com/api/widget/script/' + token).length).toBeLessThan(2000)
  })
})

describe('sbw1_ back-compat', () => {
  // Sealed by sealWidgetToken at ea77ea0 with this test-only key. Embeds issued then must keep opening.
  const FIXTURE_KEY = Buffer.from('c2J3MS1maXh0dXJlLXRlc3Qtb25seS1rZXktMDAwMDA=', 'base64')
  const FIXTURE_TOKEN =
    'sbw1_q3xwfzc_Fg89yIsqAbtkhhK38K7GecwVVJCh8Md4XPZMiQaooS0dt-gWwmQZQTJasjrnJy7kTjCqc6SsSS3fnEt8LoED_UJjREg0nyjrEiQ2EJ5unKKVR1WZ499YTCaT4pmwLSHCzPMgNxpzjwcuhS-ivwjbeveGtYkF24joRHjP4Sz__oCQKaCEYP03Pqw50bHoL3z9oahxWMHw4mADO31V9bUyDGHmNRP1j-Sq0WTVoqvrQChZJ0xbMTWEE8bbUGqPAIa_F4ReZg0'

  it('opens an sbw1_ token sealed by the ea77ea0 code', () => {
    expect(openWidgetToken(FIXTURE_TOKEN, FIXTURE_KEY)).toEqual({
      conn: 'postgresql://fixture:pw@db.example.com:5432/app?sslmode=verify-full',
      workspaceId: '11111111-2222-4333-8444-555555555555',
      widgetId: '66666666-7777-4888-9999-aaaaaaaaaaaa',
    })
    expect(isWidgetTokenShape(FIXTURE_TOKEN)).toBe(true)
    expect(openWidgetTokenV2(FIXTURE_TOKEN, FIXTURE_KEY)).toBeNull()
  })
})

describe('sbw2_ widget token', () => {
  const pgPayload: WidgetTokenV2Payload = {
    source: { kind: 'postgres', conn: CONN, workspaceId: randomUUID(), widgetId: randomUUID() },
    origins: ['https://example.com', 'http://localhost:3000'],
  }
  const memPayload: WidgetTokenV2Payload = {
    source: { kind: 'memory', widgetKey: 'widget-' + randomUUID() },
    origins: ['https://shop.example.com'],
  }

  it.each([
    ['postgres', pgPayload],
    ['memory', memPayload],
  ] as const)('round-trips a %s source', (_name, payload) => {
    const token = sealWidgetTokenV2(payload, key)
    expect(token).toMatch(/^sbw2_[A-Za-z0-9_-]+$/)
    expect(token.startsWith(WIDGET_TOKEN_V2_PREFIX)).toBe(true)
    expect(isWidgetTokenShape(token)).toBe(true)
    expect(isBuilderTokenShape(token)).toBe(false)
    expect(openWidgetTokenV2(token, key)).toEqual(payload)
  })

  it('round-trips an empty origin list', () => {
    const payload: WidgetTokenV2Payload = { source: memPayload.source, origins: [] }
    expect(openWidgetTokenV2(sealWidgetTokenV2(payload, key), key)).toEqual(payload)
  })

  it('does not reveal the connection string or origins', () => {
    const token = sealWidgetTokenV2(pgPayload, key)
    expect(token).not.toContain('db.example.com')
    expect(token).not.toContain('example.com')
  })

  it('rejects every single-character change', () => {
    const token = sealWidgetTokenV2(memPayload, key)
    for (let i = 0; i < token.length; i++) {
      const tampered = replaceAt(token, i)
      expect(tampered).not.toBe(token)
      expect(openWidgetTokenV2(tampered, key)).toBeNull()
    }
  })

  it('rejects truncated tokens and a different key', () => {
    const token = sealWidgetTokenV2(pgPayload, key)
    expect(openWidgetTokenV2(token.slice(0, -1), key)).toBeNull()
    expect(openWidgetTokenV2(token.slice(0, -20), key)).toBeNull()
    expect(openWidgetTokenV2(token, randomBytes(32))).toBeNull()
  })

  it('is bound to its prefix in both directions', () => {
    const v2 = sealWidgetTokenV2(pgPayload, key)
    const body = v2.slice(WIDGET_TOKEN_V2_PREFIX.length)
    expect(openWidgetToken(WIDGET_TOKEN_PREFIX + body, key)).toBeNull()
    expect(openBuilderToken(BUILDER_TOKEN_PREFIX + body, key)).toBeNull()

    const v1 = sealWidgetToken(widgetPayload, key)
    expect(openWidgetTokenV2(WIDGET_TOKEN_V2_PREFIX + v1.slice(WIDGET_TOKEN_PREFIX.length), key)).toBeNull()
    const b = sealBuilderToken(builderPayload, key)
    expect(openWidgetTokenV2(WIDGET_TOKEN_V2_PREFIX + b.slice(BUILDER_TOKEN_PREFIX.length), key)).toBeNull()
    expect(openWidgetTokenV2(v1, key)).toBeNull()
    expect(openWidgetTokenV2(b, key)).toBeNull()
  })

  it('rejects non-strings and oversized input without throwing', () => {
    expect(openWidgetTokenV2(undefined, key)).toBeNull()
    expect(openWidgetTokenV2(42, key)).toBeNull()
    expect(openWidgetTokenV2('sbw2_', key)).toBeNull()
    expect(openWidgetTokenV2('sbw2_!!!', key)).toBeNull()
    expect(openWidgetTokenV2('sbw2_' + 'A'.repeat(MAX_WIDGET_TOKEN_V2_LENGTH), key)).toBeNull()
  })

  it('refuses to inflate an authenticated body past the output cap', () => {
    const token = sealWidgetTokenV2(
      { source: { kind: 'postgres', conn: 'a'.repeat(20000), workspaceId: randomUUID(), widgetId: randomUUID() }, origins: [] },
      key,
    )
    expect(token.length).toBeLessThan(MAX_WIDGET_TOKEN_V2_LENGTH)
    expect(openWidgetTokenV2(token, key)).toBeNull()
  })

  it.each([
    ['a bad memory key', { source: { kind: 'memory', widgetKey: 'not-a-widget' }, origins: [] }],
    ['a memory key that is too long', { source: { kind: 'memory', widgetKey: 'widget-' + 'a'.repeat(81) }, origins: [] }],
    ['a bad workspace id', { source: { ...pgPayload.source, workspaceId: 'nope' }, origins: [] }],
    ['a bad widget id', { source: { ...pgPayload.source, widgetId: 'nope' }, origins: [] }],
    ['an empty connection string', { source: { ...pgPayload.source, conn: '' }, origins: [] }],
    ['11 origins', { source: memPayload.source, origins: Array.from({ length: 11 }, (_, i) => `https://s${i}.example.com`) }],
    ['a 256-char origin', { source: memPayload.source, origins: ['https://' + 'a'.repeat(248)] }],
    ['a non-string origin', { source: memPayload.source, origins: [42] }],
  ])('seals but refuses to open %s', (_name, payload) => {
    const token = sealWidgetTokenV2(payload as unknown as WidgetTokenV2Payload, key)
    expect(openWidgetTokenV2(token, key)).toBeNull()
  })

  it('throws embed_too_large instead of issuing a token over the cap', () => {
    const rand = seededRandom(7)
    const conn = 'postgresql://u:' + randomChars(rand, CONN_CHARSET, 6000) + '@db.example.com:5432/app'
    let caught: unknown
    try {
      sealWidgetTokenV2({ source: { kind: 'postgres', conn, workspaceId: randomUUID(), widgetId: randomUUID() }, origins: [] }, key)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(StorageError)
    expect((caught as StorageError).code).toBe('embed_too_large')
  })

  it('AC 34: the origins-only worst case fits under the cap and in a script URL', () => {
    const rand = seededRandom(20261025)
    const conn = worstCaseConnection(rand)
    expect(conn).toHaveLength(3000)
    const origins = Array.from({ length: 10 }, () => worstCaseOrigin(rand))
    for (const o of origins) expect(o).toHaveLength(255)
    const payload: WidgetTokenV2Payload = {
      source: { kind: 'postgres', conn, workspaceId: randomUUID(), widgetId: randomUUID() },
      origins,
    }
    const token = sealWidgetTokenV2(payload, key)
    expect(token.length).toBeLessThanOrEqual(MAX_WIDGET_TOKEN_V2_LENGTH)
    expect(('https://support-bot.example.com/api/widget/script/' + token).length).toBeLessThan(8000)
    expect(openWidgetTokenV2(token, key)).toEqual(payload)
  })
})

const CONN_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~%'
const HOST_CHARSET = 'abcdefghijklmnopqrstuvwxyz0123456789'

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
