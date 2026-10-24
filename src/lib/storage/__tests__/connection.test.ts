/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import {
  MAX_CONNECTION_STRING_LENGTH,
  MAX_NORMALIZED_CONNECTION_STRING_LENGTH,
  classifyAddress,
  isPrivateHostAllowed,
  revalidateNormalizedConnection,
  validateConnectionString,
  type ParsedConnection,
} from '../connection'
import { MAX_TOKEN_LENGTH, openBuilderToken, openWidgetToken, sealBuilderToken, sealWidgetToken } from '../token'

const strict = { allowPrivate: false }
const permissive = { allowPrivate: true }

function expectOk(raw: string, opts = strict): ParsedConnection {
  const result = validateConnectionString(raw, opts)
  if (!result.ok) throw new Error(`expected ok for ${raw}, got ${result.code}`)
  return result.connection
}

describe('validateConnectionString rejections', () => {
  const longInput = 'postgres://u:p@db.example.com/' + 'd'.repeat(MAX_CONNECTION_STRING_LENGTH)

  it.each([
    ['http://a/b', 'unsupported_scheme'],
    ['mysql://u:p@h/d', 'unsupported_scheme'],
    [longInput.slice(0, MAX_CONNECTION_STRING_LENGTH + 1), 'connection_string_too_long'],
    ['postgres://u:p@db.example.com/d?sslmode=disable', 'tls_required'],
    ['postgres://u:p@127.0.0.1/d', 'private_host_not_allowed'],
    ['postgres://u:p@localhost/d', 'private_host_not_allowed'],
    ['postgres://u:p@db.localhost/d', 'private_host_not_allowed'],
    ['postgres://u:p@169.254.169.254/d', 'private_host_not_allowed'],
    ['postgres://u:p@10.0.0.5/d', 'private_host_not_allowed'],
    ['postgres://u:p@[::1]/d', 'private_host_not_allowed'],
    ['postgres://u:p@[fe80::1]/d', 'private_host_not_allowed'],
    ['postgres://u:p@[::ffff:127.0.0.1]/d', 'private_host_not_allowed'],
    ['postgres://u:p@h/d?host=/tmp', 'invalid_connection_string'],
    ['postgres://u:p@h1,h2/d', 'invalid_connection_string'],
    ['postgres://u:p@h/d#frag', 'invalid_connection_string'],
    ['postgres://u:p@h/d#', 'invalid_connection_string'],
    ['postgres://:p@h/d', 'invalid_connection_string'],
    ['postgres://u:p@h/', 'invalid_connection_string'],
    ['postgres://u:p@h', 'invalid_connection_string'],
    ['postgres://u:p@h:0/d', 'invalid_connection_string'],
    ['postgres://u:p@h:70000/d', 'invalid_connection_string'],
    ['postgres://u:p@h/d?sslmode=bogus', 'invalid_connection_string'],
    ['postgres://u:p@h/d?sslmode=constructor', 'invalid_connection_string'],
    ['postgres://u:p@h/d?options=-c%20x', 'invalid_connection_string'],
    ['postgres://u:p@h/d?sslrootcert=/etc/x', 'invalid_connection_string'],
    ['postgres://u:p@h/d?PASSWORD=x', 'invalid_connection_string'],
    ['postgres://u:p%ZZ@h/d', 'invalid_connection_string'],
    ['postgres://u:p@h/d e', 'invalid_connection_string'],
    ['postgres://u:"p"@h/d', 'invalid_connection_string'],
    ['not a url', 'invalid_connection_string'],
    ['', 'invalid_connection_string'],
  ])('%s -> %s', (input, code) => {
    expect(validateConnectionString(input, strict)).toEqual({ ok: false, code })
  })

  it('rejects non-strings', () => {
    for (const input of [undefined, null, 42, {}, ['postgres://u:p@h/d']]) {
      expect(validateConnectionString(input, strict)).toEqual({ ok: false, code: 'invalid_connection_string' })
    }
  })

  it('accepts exactly the maximum length', () => {
    const base = 'postgres://u:p@db.example.com/'
    const raw = base + 'd'.repeat(MAX_CONNECTION_STRING_LENGTH - base.length)
    expect(raw).toHaveLength(MAX_CONNECTION_STRING_LENGTH)
    expect(validateConnectionString(raw, strict).ok).toBe(true)
  })

  it('rejects sslmode=disable on an unresolved hostname without the opt-in', () => {
    expect(validateConnectionString('postgres://u:p@db.internal/d?sslmode=disable', strict))
      .toEqual({ ok: false, code: 'tls_required' })
  })

  it('still rejects sslmode=disable on a public IP with the opt-in', () => {
    expect(validateConnectionString('postgres://u:p@8.8.8.8/d?sslmode=disable', permissive))
      .toEqual({ ok: false, code: 'tls_required' })
  })
})

describe('validateConnectionString acceptance', () => {
  it('defaults a public hostname to verify-full', () => {
    const conn = expectOk('postgres://u:p@db.example.com/d')
    expect(conn.sslmode).toBe('verify-full')
    expect(conn.hostClass).toBe('hostname')
    expect(conn.port).toBe(5432)
    expect(conn.normalized.endsWith('?sslmode=verify-full')).toBe(true)
    expect(conn.normalized).toBe('postgresql://u:p@db.example.com:5432/d?sslmode=verify-full')
  })

  it('keeps require and drops other parameters', () => {
    const conn = expectOk('postgresql://u:p@db.example.com:6543/d?sslmode=require&channel_binding=require')
    expect(conn.sslmode).toBe('require')
    expect(conn.port).toBe(6543)
    expect(conn.normalized).toBe('postgresql://u:p@db.example.com:6543/d?sslmode=require')
    expect(conn.normalized).not.toContain('channel_binding')
  })

  it.each([
    ['allow', 'verify-full'],
    ['prefer', 'verify-full'],
    ['verify-ca', 'verify-full'],
    ['verify-full', 'verify-full'],
  ])('maps sslmode=%s to %s on public hosts', (mode, expected) => {
    expect(expectOk(`postgres://u:p@8.8.8.8/d?sslmode=${mode}`).sslmode).toBe(expected)
  })

  it('classifies a public IPv4 literal as public', () => {
    expect(expectOk('postgres://u:p@8.8.8.8/d').hostClass).toBe('public')
  })

  it('allows loopback with the opt-in and defaults to plain TCP', () => {
    const conn = expectOk('postgres://u:p@127.0.0.1/d', permissive)
    expect(conn.sslmode).toBe('disable')
    expect(conn.hostClass).toBe('loopback')
  })

  it('allows sslmode=disable on loopback with the opt-in', () => {
    expect(expectOk('postgres://u:p@127.0.0.1/d?sslmode=disable', permissive).sslmode).toBe('disable')
  })

  it('allows sslmode=disable on a hostname with the opt-in', () => {
    expect(expectOk('postgres://u:p@db.internal/d?sslmode=disable', permissive).sslmode).toBe('disable')
  })

  it('percent-decodes user, password and database and re-encodes them', () => {
    const conn = expectOk('postgres://us%3Ar:p%40ss@db.example.com/my%20db')
    expect(conn.user).toBe('us:r')
    expect(conn.password).toBe('p@ss')
    expect(conn.database).toBe('my db')
    expect(conn.normalized).toBe('postgresql://us%3Ar:p%40ss@db.example.com:5432/my%20db?sslmode=verify-full')
  })

  it('allows an empty password', () => {
    expect(expectOk('postgres://u@db.example.com/d').password).toBe('')
  })

  it('brackets IPv6 hosts in the normalised string', () => {
    const conn = expectOk('postgres://u:p@[2001:4860:4860::8888]:5433/d')
    expect(conn.host).toBe('2001:4860:4860::8888')
    expect(conn.hostClass).toBe('public')
    expect(conn.normalized).toBe('postgresql://u:p@[2001:4860:4860::8888]:5433/d?sslmode=verify-full')
  })

  it('lowercases hostnames so fingerprints are stable', () => {
    const a = expectOk('postgres://u:p@DB.Example.com/d')
    const b = expectOk('postgres://u:p@db.example.com/d')
    expect(a.host).toBe('db.example.com')
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(a.fingerprint).toMatch(/^[0-9a-f]{8}$/)
  })
})

describe('normalised length', () => {
  // '$' is legal raw in userinfo but encodeURIComponent turns it into '%24', tripling it.
  const build = (expanding: number, plain: number) =>
    `postgres://u:${'$'.repeat(expanding)}${'p'.repeat(plain)}@db.example.com/d`

  it('accepts a 1000-char string whose normalised form exceeds 1000 and re-validates it', () => {
    const raw = build(300, 670)
    expect(raw).toHaveLength(MAX_CONNECTION_STRING_LENGTH)
    const conn = expectOk(raw)
    expect(conn.normalized.length).toBeGreaterThan(MAX_CONNECTION_STRING_LENGTH)
    expect(conn.password).toBe('$'.repeat(300) + 'p'.repeat(670))

    const again = revalidateNormalizedConnection(conn.normalized, strict)
    if (!again.ok) throw new Error(`revalidation failed: ${again.code}`)
    expect(again.connection.normalized).toBe(conn.normalized)
    expect(again.connection.password).toBe(conn.password)
    expect(again.connection.fingerprint).toBe(conn.fingerprint)
    // The user-facing cap alone would have rejected it.
    expect(validateConnectionString(conn.normalized, strict)).toEqual({ ok: false, code: 'connection_string_too_long' })
  })

  // Worst cases for a 1000-char input: every expandable field is '$' and everything else is minimal.
  const worstCases: Array<[string, string, { allowPrivate: boolean }]> = [
    ['user and database only, one-char hostname', `postgres://${'$'.repeat(493)}@h/${'$'.repeat(493)}`, strict],
    ['user, password and database, public IP', `postgres://${'$'.repeat(326)}:${'$'.repeat(326)}@1.1.1.1/${'$'.repeat(327)}`, strict],
    ['user, password and database, private IP', `postgres://${'$'.repeat(325)}:${'$'.repeat(325)}@10.0.0.5/${'$'.repeat(328)}`, permissive],
  ]

  it.each(worstCases)('accepts a worst-case 1000-char string (%s) and its tokens seal and open', (_label, raw, opts) => {
    expect(raw).toHaveLength(MAX_CONNECTION_STRING_LENGTH)
    const conn = expectOk(raw, opts)
    expect(conn.normalized.length).toBeLessThanOrEqual(MAX_NORMALIZED_CONNECTION_STRING_LENGTH)
    const again = revalidateNormalizedConnection(conn.normalized, opts)
    if (!again.ok) throw new Error(`revalidation failed: ${again.code}`)
    expect(again.connection.normalized).toBe(conn.normalized)

    const key = randomBytes(32)
    const workspaceId = randomUUID()
    const widgetId = randomUUID()
    const widget = sealWidgetToken({ conn: conn.normalized, workspaceId, widgetId }, key)
    const builder = sealBuilderToken({ conn: conn.normalized, workspaceId }, key)
    expect(widget.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH)
    expect(builder.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH)
    expect(openWidgetToken(widget, key)).toEqual({ conn: conn.normalized, workspaceId, widgetId })
    expect(openBuilderToken(builder, key)).toEqual({ conn: conn.normalized, workspaceId })
  })

  it('reaches exactly the normalised cap with the longest-expanding 1000-char input', () => {
    expect(expectOk(worstCases[0][1]).normalized).toHaveLength(MAX_NORMALIZED_CONNECTION_STRING_LENGTH)
  })

  it('keeps a normalised string at the cap within the token budget', () => {
    const key = randomBytes(32)
    const conn = expectOk(worstCases[0][1]).normalized
    expect(conn).toHaveLength(MAX_NORMALIZED_CONNECTION_STRING_LENGTH)
    const workspaceId = randomUUID()
    const widgetId = randomUUID()
    const widget = sealWidgetToken({ conn, workspaceId, widgetId }, key)
    const builder = sealBuilderToken({ conn, workspaceId }, key)
    expect(widget.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH)
    expect(builder.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH)
    expect(openWidgetToken(widget, key)).toEqual({ conn, workspaceId, widgetId })
    expect(openBuilderToken(builder, key)).toEqual({ conn, workspaceId })
  })

  it('re-applies every other policy on re-validation', () => {
    expect(revalidateNormalizedConnection('postgresql://u:p@10.0.0.5:5432/d?sslmode=disable', strict))
      .toEqual({ ok: false, code: 'private_host_not_allowed' })
    expect(revalidateNormalizedConnection('postgresql://u:p@db.example.com:5432/d?sslmode=disable', strict))
      .toEqual({ ok: false, code: 'tls_required' })
    expect(revalidateNormalizedConnection('mysql://u:p@db.example.com/d', strict))
      .toEqual({ ok: false, code: 'unsupported_scheme' })
    expect(revalidateNormalizedConnection('postgresql://u:p@db.example.com/d?host=10.0.0.5', strict))
      .toEqual({ ok: false, code: 'invalid_connection_string' })
    expect(revalidateNormalizedConnection(42, strict)).toEqual({ ok: false, code: 'invalid_connection_string' })
    expect(revalidateNormalizedConnection('postgresql://u:p@10.0.0.5:5432/d?sslmode=disable', permissive).ok).toBe(true)
  })

  it('rejects anything over the normalised cap on re-validation', () => {
    const base = 'postgresql://u:p@db.example.com:5432/'
    const suffix = '?sslmode=verify-full'
    const raw = base + 'd'.repeat(MAX_NORMALIZED_CONNECTION_STRING_LENGTH + 1 - base.length - suffix.length) + suffix
    expect(raw).toHaveLength(MAX_NORMALIZED_CONNECTION_STRING_LENGTH + 1)
    expect(revalidateNormalizedConnection(raw, strict)).toEqual({ ok: false, code: 'connection_string_too_long' })
    expect(revalidateNormalizedConnection(raw.slice(0, -suffix.length - 1) + suffix, strict).ok).toBe(true)
  })
})

describe('ParsedConnection secrecy', () => {
  const conn = expectOk('postgres://u:s3cretPw@db.example.com/d')

  it('is frozen', () => {
    expect(Object.isFrozen(conn)).toBe(true)
  })

  it('does not leak the password through JSON, inspect or string conversion', () => {
    const label = `[ParsedConnection db=${conn.fingerprint}]`
    expect(JSON.stringify(conn)).toBe(JSON.stringify(label))
    expect(JSON.stringify({ conn })).not.toContain('s3cretPw')
    expect(inspect(conn)).toBe(label)
    expect(inspect({ nested: conn }, { depth: 5 })).not.toContain('s3cretPw')
    expect(String(conn)).toBe(label)
    expect(`${conn}`).not.toContain('s3cretPw')
  })

  it('keeps the helper properties non-enumerable', () => {
    expect(Object.keys(conn)).not.toContain('toJSON')
    expect(Object.keys(conn)).not.toContain('toString')
  })
})

describe('classifyAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['0.0.0.0', 'loopback'],
    ['::1', 'loopback'],
    ['::', 'loopback'],
    ['169.254.169.254', 'link-local'],
    ['fe80::1', 'link-local'],
    ['10.1.2.3', 'private'],
    ['100.64.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.0.0.8', 'private'],
    ['192.168.1.1', 'private'],
    ['198.18.0.1', 'private'],
    ['224.0.0.1', 'private'],
    ['255.255.255.255', 'private'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['ff02::1', 'private'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:7f00:1', 'loopback'],
    ['::ffff:10.0.0.1', 'private'],
    ['0:0:0:0:0:ffff:a9fe:a9fe', 'link-local'],
    ['64:ff9b::7f00:1', 'loopback'],
    ['64:ff9b::10.0.0.1', 'private'],
    ['64:ff9b::a9fe:a9fe', 'link-local'],
    ['64:ff9b::8.8.8.8', 'public'],
    ['2002:7f00:1::', 'loopback'],
    ['2002:a00:1::1', 'private'],
    ['2002:c0a8:101:0:0:0:0:1', 'private'],
    ['2002:808:808::1', 'public'],
    ['8.8.8.8', 'public'],
    ['172.32.0.1', 'public'],
    ['2001:4860:4860::8888', 'public'],
    ['::ffff:8.8.8.8', 'public'],
    ['not-an-ip', 'private'],
  ])('%s -> %s', (ip, expected) => {
    expect(classifyAddress(ip)).toBe(expected)
  })
})

describe('isPrivateHostAllowed', () => {
  const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv

  it('is true with ALLOW_PRIVATE_DB_HOSTS=1', () => {
    expect(isPrivateHostAllowed(env({ ALLOW_PRIVATE_DB_HOSTS: '1' }))).toBe(true)
  })

  it('is true in development', () => {
    expect(isPrivateHostAllowed(env({ NODE_ENV: 'development' }))).toBe(true)
  })

  it('is false otherwise', () => {
    expect(isPrivateHostAllowed(env({}))).toBe(false)
    expect(isPrivateHostAllowed(env({ ALLOW_PRIVATE_DB_HOSTS: 'true', NODE_ENV: 'production' }))).toBe(false)
  })
})
