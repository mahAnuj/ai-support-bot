import { BlockList, isIP } from 'node:net'
import type { StorageErrorCode } from './errors'
import { fingerprint } from './log'

export const MAX_CONNECTION_STRING_LENGTH = 1000

export type HostClass = 'public' | 'private' | 'loopback' | 'link-local' | 'hostname'
export type SslMode = 'disable' | 'require' | 'verify-full'

export interface ParsedConnection {
  readonly host: string
  readonly port: number
  readonly user: string
  readonly password: string
  readonly database: string
  readonly sslmode: SslMode
  readonly hostClass: HostClass
  readonly normalized: string
  readonly fingerprint: string
}

export type ValidationResult =
  | { ok: true; connection: ParsedConnection }
  | { ok: false; code: StorageErrorCode }

const DEFAULT_PORT = 5432
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i
const URI_CHARS_RE = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/
const ALLOWED_SCHEMES = new Set(['postgres', 'postgresql'])

const DENIED_PARAMS = new Set([
  'host', 'hostaddr', 'port', 'user', 'password', 'dbname', 'options', 'service',
  'passfile', 'sslcert', 'sslkey', 'sslrootcert', 'sslcrl',
])

const SSLMODE_MAP: Record<string, SslMode> = {
  disable: 'disable',
  allow: 'verify-full',
  prefer: 'verify-full',
  require: 'require',
  'verify-ca': 'verify-full',
  'verify-full': 'verify-full',
}

type AddressClass = Exclude<HostClass, 'hostname'>

interface AddressLists {
  loopback: BlockList
  linkLocal: BlockList
  private: BlockList
}

// Built on first use so importing this module does no work.
let addressLists: AddressLists | null = null

function getAddressLists(): AddressLists {
  if (addressLists) return addressLists
  const loopback = new BlockList()
  loopback.addSubnet('127.0.0.0', 8, 'ipv4')
  loopback.addSubnet('0.0.0.0', 8, 'ipv4')
  loopback.addAddress('::1', 'ipv6')
  loopback.addAddress('::', 'ipv6')

  const linkLocal = new BlockList()
  linkLocal.addSubnet('169.254.0.0', 16, 'ipv4')
  linkLocal.addSubnet('fe80::', 10, 'ipv6')

  const priv = new BlockList()
  priv.addSubnet('10.0.0.0', 8, 'ipv4')
  priv.addSubnet('100.64.0.0', 10, 'ipv4')
  priv.addSubnet('172.16.0.0', 12, 'ipv4')
  priv.addSubnet('192.0.0.0', 24, 'ipv4')
  priv.addSubnet('192.168.0.0', 16, 'ipv4')
  priv.addSubnet('198.18.0.0', 15, 'ipv4')
  priv.addSubnet('224.0.0.0', 4, 'ipv4')
  priv.addSubnet('240.0.0.0', 4, 'ipv4')
  priv.addSubnet('fc00::', 7, 'ipv6')
  priv.addSubnet('ff00::', 8, 'ipv6')

  addressLists = { loopback, linkLocal, private: priv }
  return addressLists
}

function canonicalIPv6(ip: string): string {
  try {
    return new URL(`http://[${ip}]/`).hostname.slice(1, -1)
  } catch {
    return ip.toLowerCase()
  }
}

function unwrapMappedIPv4(ip: string): string | null {
  const canonical = canonicalIPv6(ip)
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(canonical)
  if (dotted) return dotted[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical)
  if (!hex) return null
  const hi = parseInt(hex[1], 16)
  const lo = parseInt(hex[2], 16)
  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.')
}

export function classifyAddress(ip: string): AddressClass {
  let address = ip
  let family = isIP(address)
  if (family === 6) {
    const mapped = unwrapMappedIPv4(address)
    if (mapped && isIP(mapped) === 4) {
      address = mapped
      family = 4
    }
  }
  // Not an IP literal: fail closed rather than call it public.
  if (family === 0) return 'private'
  const type = family === 4 ? 'ipv4' : 'ipv6'
  const lists = getAddressLists()
  if (lists.loopback.check(address, type)) return 'loopback'
  if (lists.linkLocal.check(address, type)) return 'link-local'
  if (lists.private.check(address, type)) return 'private'
  return 'public'
}

export function isPrivateHostAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.ALLOW_PRIVATE_DB_HOSTS === '1'
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function classifyHost(host: string): HostClass {
  if (isIP(host)) return classifyAddress(host)
  if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback'
  return 'hostname'
}

function fail(code: StorageErrorCode): ValidationResult {
  return { ok: false, code }
}

export function validateConnectionString(raw: unknown, opts: { allowPrivate: boolean }): ValidationResult {
  if (typeof raw !== 'string' || raw.length === 0) return fail('invalid_connection_string')
  if (raw.length > MAX_CONNECTION_STRING_LENGTH) return fail('connection_string_too_long')

  const scheme = SCHEME_RE.exec(raw)
  if (scheme && !ALLOWED_SCHEMES.has(scheme[1].toLowerCase())) return fail('unsupported_scheme')
  if (!URI_CHARS_RE.test(raw)) return fail('invalid_connection_string')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail('invalid_connection_string')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') return fail('unsupported_scheme')

  // Any '#' is a fragment; URL reports an empty one as '' so check the raw string too.
  if (url.hash !== '' || raw.includes('#')) return fail('invalid_connection_string')

  let host = url.hostname
  if (!host || host.includes(',') || host.startsWith('/') || host.includes('%')) {
    return fail('invalid_connection_string')
  }
  const bracketed = host.startsWith('[') && host.endsWith(']')
  if (bracketed) host = host.slice(1, -1)
  if (bracketed && isIP(host) !== 6) return fail('invalid_connection_string')
  host = host.toLowerCase()

  const port = url.port === '' ? DEFAULT_PORT : Number(url.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return fail('invalid_connection_string')

  const user = safeDecode(url.username)
  const password = safeDecode(url.password)
  const rawDatabase = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname
  if (rawDatabase.includes('/')) return fail('invalid_connection_string')
  const database = safeDecode(rawDatabase)
  if (!user || password === null || !database) return fail('invalid_connection_string')

  let requestedSslmode: string | null = null
  for (const [rawKey, value] of url.searchParams) {
    const key = rawKey.toLowerCase()
    if (DENIED_PARAMS.has(key)) return fail('invalid_connection_string')
    if (key === 'sslmode') {
      if (requestedSslmode !== null && requestedSslmode !== value) return fail('invalid_connection_string')
      requestedSslmode = value
    }
  }
  if (requestedSslmode !== null && !Object.hasOwn(SSLMODE_MAP, requestedSslmode)) return fail('invalid_connection_string')

  const hostClass = classifyHost(host)
  const isNonPublicIp = hostClass !== 'public' && hostClass !== 'hostname'
  if (isNonPublicIp && !opts.allowPrivate) return fail('private_host_not_allowed')

  let sslmode: SslMode
  if (requestedSslmode === null) {
    sslmode = isNonPublicIp ? 'disable' : 'verify-full'
  } else {
    sslmode = SSLMODE_MAP[requestedSslmode]
  }
  if (sslmode === 'disable') {
    if (hostClass === 'public') return fail('tls_required')
    if (hostClass === 'hostname' && !opts.allowPrivate) return fail('tls_required')
  }

  const hostOut = isIP(host) === 6 ? `[${host}]` : host
  const normalized =
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${hostOut}:${port}` +
    `/${encodeURIComponent(database)}?sslmode=${sslmode}`

  return { ok: true, connection: makeParsedConnection({
    host, port, user, password, database, sslmode, hostClass, normalized, fingerprint: fingerprint(normalized),
  }) }
}

function makeParsedConnection(fields: ParsedConnection): ParsedConnection {
  const label = `[ParsedConnection db=${fields.fingerprint}]`
  const conn = { ...fields }
  Object.defineProperty(conn, 'toJSON', { value: () => label, enumerable: false })
  Object.defineProperty(conn, Symbol.for('nodejs.util.inspect.custom'), { value: () => label, enumerable: false })
  Object.defineProperty(conn, 'toString', { value: () => label, enumerable: false })
  return Object.freeze(conn)
}
