/** @jest-environment node */
import { inspect } from 'node:util'
import {
  MAX_CONNECTION_STRING_LENGTH,
  classifyAddress,
  isPrivateHostAllowed,
  validateConnectionString,
  type ParsedConnection,
} from '../connection'

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
