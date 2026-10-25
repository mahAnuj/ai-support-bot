/** @jest-environment node */
import { originAllowed, widgetCorsHeaders, widgetOriginAllowed } from '../guard'
import {
  exactOriginAllowed,
  MAX_ALLOWED_ORIGINS,
  MAX_ORIGIN_LENGTH,
  normalizeOrigin,
  normalizeOriginList,
  ORIGIN_ERROR_MESSAGES,
  originFromReferer,
  type OriginErrorCode,
  type OriginPolicy,
} from '../origins'

describe('normalizeOrigin', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['https://Example.com/', 'https://example.com'],
    ['  https://EXAMPLE.COM  ', 'https://example.com'],
    ['HTTPS://example.com', 'https://example.com'],
    ['https://example.com:443', 'https://example.com'],
    ['http://example.com:80/', 'http://example.com'],
    ['https://example.com:8443', 'https://example.com:8443'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['https://bücher.example', 'https://xn--bcher-kva.example'],
    ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeOrigin(input)).toEqual({ ok: true, origin: expected })
  })

  it.each<[string, OriginErrorCode]>([
    ['', 'origin_empty'],
    ['   ', 'origin_empty'],
    ['null', 'origin_invalid'],
    ['NULL', 'origin_invalid'],
    ['https://*.example.com', 'origin_wildcard'],
    ['*', 'origin_wildcard'],
    ['example.com', 'origin_missing_scheme'],
    ['not a url', 'origin_missing_scheme'],
    ['ftp://example.com', 'origin_bad_scheme'],
    ['javascript://example.com', 'origin_bad_scheme'],
    ['https://user:pass@example.com', 'origin_has_userinfo'],
    ['https://user@example.com', 'origin_has_userinfo'],
    ['https://example.com?x=1', 'origin_has_query'],
    ['https://example.com/#top', 'origin_has_query'],
    ['https://example.com/page', 'origin_has_path'],
    ['https://example.com//', 'origin_has_path'],
    ['https://example.com\\evil.com', 'origin_has_path'],
    ['https://', 'origin_invalid'],
    ['https://exa mple.com', 'origin_invalid'],
    ['https://example.com:99999', 'origin_invalid'],
    [`https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`, 'origin_too_long'],
    [`https://${'a'.repeat(3000)}.com`, 'origin_too_long'],
  ])('refuses %j with %s', (input, code) => {
    expect(normalizeOrigin(input)).toEqual({ ok: false, code })
  })

  it('has a message for every code', () => {
    for (const message of Object.values(ORIGIN_ERROR_MESSAGES)) {
      expect(message.length).toBeGreaterThan(0)
    }
    expect(MAX_ORIGIN_LENGTH).toBe(255)
  })
})

describe('normalizeOriginList', () => {
  it('normalises each entry and accepts an empty list', () => {
    expect(normalizeOriginList(['https://Example.com/', 'http://localhost:3000'])).toEqual({
      ok: true,
      origins: ['https://example.com', 'http://localhost:3000'],
    })
    expect(normalizeOriginList([])).toEqual({ ok: true, origins: [] })
  })

  it('accepts exactly the maximum and refuses one more', () => {
    const list = Array.from({ length: MAX_ALLOWED_ORIGINS }, (_, i) => `https://site${i}.example`)
    expect(normalizeOriginList(list)).toEqual({ ok: true, origins: list })
    expect(normalizeOriginList([...list, 'https://extra.example'])).toEqual({
      ok: false,
      code: 'origin_too_many',
      index: MAX_ALLOWED_ORIGINS,
    })
  })

  it('refuses duplicates after normalising', () => {
    expect(normalizeOriginList(['https://example.com', 'https://EXAMPLE.com:443/'])).toEqual({
      ok: false,
      code: 'origin_duplicate',
      index: 1,
    })
  })

  it('reports the index of an invalid entry', () => {
    expect(normalizeOriginList(['https://example.com', 'https://example.com/path'])).toEqual({
      ok: false,
      code: 'origin_has_path',
      index: 1,
    })
  })

  it('refuses non-arrays and non-string entries', () => {
    expect(normalizeOriginList('https://example.com')).toEqual({ ok: false, code: 'origin_invalid', index: -1 })
    expect(normalizeOriginList(null)).toEqual({ ok: false, code: 'origin_invalid', index: -1 })
    expect(normalizeOriginList(['https://example.com', 42])).toEqual({
      ok: false,
      code: 'origin_invalid',
      index: 1,
    })
  })
})

describe('exactOriginAllowed (AC 8)', () => {
  const list = ['https://example.com']

  it.each(['https://example.com', 'https://example.com:443'])('accepts %s', (origin) => {
    expect(exactOriginAllowed(list, origin)).toBe(true)
  })

  it.each([
    'http://example.com',
    'https://www.example.com',
    'https://example.com:8443',
    'https://example.com.evil.com',
    'https://notexample.com',
    'null',
    null,
    'not a url',
    '',
  ])('refuses %j', (origin) => {
    expect(exactOriginAllowed(list, origin)).toBe(false)
  })

  it('accepts a localhost entry on its own port only', () => {
    expect(exactOriginAllowed(['http://localhost:3000'], 'http://localhost:3000')).toBe(true)
    expect(exactOriginAllowed(['http://localhost:3000'], 'http://localhost:3001')).toBe(false)
  })
})

describe('originFromReferer', () => {
  it('returns the origin of http(s) referers', () => {
    expect(originFromReferer('https://Example.com/page?x=1#y')).toBe('https://example.com')
    expect(originFromReferer('http://localhost:3000/a')).toBe('http://localhost:3000')
  })

  it.each([null, '', 'not a url', 'file:///etc/passwd', 'data:text/html,hi'])('returns null for %j', (referer) => {
    expect(originFromReferer(referer)).toBeNull()
  })
})

describe('originAllowed (legacy, GOVERNANCE)', () => {
  it('keeps hostname and subdomain matching', () => {
    expect(originAllowed('https://shop.example.com', ['example.com'])).toBe(true)
    expect(originAllowed('https://example.com', ['example.com'])).toBe(true)
    expect(originAllowed('https://example.com.evil.com', ['example.com'])).toBe(false)
    expect(originAllowed('https://notexample.com', ['example.com'])).toBe(false)
    expect(originAllowed(null, ['example.com'])).toBe(false)
    expect(originAllowed(null, [])).toBe(true)
  })
})

describe('widgetOriginAllowed', () => {
  it('allows anything under the any policy', () => {
    expect(widgetOriginAllowed({ kind: 'any' }, null)).toBe(true)
    expect(widgetOriginAllowed({ kind: 'any' }, 'https://anything.test')).toBe(true)
  })

  it('uses subdomain matching under the legacy policy', () => {
    const policy: OriginPolicy = { kind: 'legacy', domains: ['example.com'] }
    expect(widgetOriginAllowed(policy, 'https://shop.example.com')).toBe(true)
    expect(widgetOriginAllowed(policy, 'https://notexample.com')).toBe(false)
    expect(widgetOriginAllowed(policy, null)).toBe(false)
  })

  it('uses exact matching under the exact policy', () => {
    const policy: OriginPolicy = { kind: 'exact', origins: ['https://example.com'] }
    expect(widgetOriginAllowed(policy, 'https://example.com')).toBe(true)
    expect(widgetOriginAllowed(policy, 'https://shop.example.com')).toBe(false)
    expect(widgetOriginAllowed(policy, null)).toBe(false)
  })
})

describe('widgetCorsHeaders', () => {
  const base = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  it('keeps * for the any and legacy policies', () => {
    const expected = { ...base, 'Access-Control-Allow-Origin': '*' }
    expect(widgetCorsHeaders({ kind: 'any' }, 'https://a.test')).toEqual(expected)
    expect(widgetCorsHeaders({ kind: 'legacy', domains: ['example.com'] }, 'https://evil.test')).toEqual(expected)
  })

  it('echoes an allowed origin with Vary under the exact policy', () => {
    const policy: OriginPolicy = { kind: 'exact', origins: ['https://example.com'] }
    expect(widgetCorsHeaders(policy, 'https://example.com')).toEqual({
      ...base,
      Vary: 'Origin',
      'Access-Control-Allow-Origin': 'https://example.com',
    })
  })

  it('sends no allow-origin for a refused or missing origin under the exact policy', () => {
    const policy: OriginPolicy = { kind: 'exact', origins: ['https://example.com'] }
    for (const origin of ['https://evil.test', 'null', null]) {
      const headers = widgetCorsHeaders(policy, origin)
      expect(headers).toEqual({ ...base, Vary: 'Origin' })
      expect(headers).not.toHaveProperty('Access-Control-Allow-Origin')
    }
  })
})
