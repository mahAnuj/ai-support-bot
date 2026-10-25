/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { StorageError } from '../errors'
import {
  BUILDER_TOKEN_PREFIX,
  WIDGET_TOKEN_PREFIX,
  getTokenKey,
  isBuilderTokenShape,
  isWidgetTokenShape,
  openBuilderToken,
  openWidgetToken,
  sealBuilderToken,
  sealWidgetToken,
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
