import * as dns from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import { classifyAddress } from '../storage/connection'
import {
  API_KEY_PATTERN,
  MODEL_ID_PATTERN,
  MODEL_LIMITS,
  ModelError,
  type ModelErrorCode,
  type OwnerModelConfig,
} from './shared'

export type ModelProtocol = 'https:' | 'http:'

export interface ModelUrlOptions {
  allowPrivate: boolean
}

export type ModelUrlCheck =
  | { ok: true; baseUrl: string; host: string; protocol: ModelProtocol }
  | { ok: false; code: ModelErrorCode }

export type ModelInputResult =
  | { ok: true; config: OwnerModelConfig }
  | { ok: false; code: ModelErrorCode }

export interface GuardedLookupOptions {
  allowPrivate: boolean
  protocol: ModelProtocol
}

// Read on every call, never at import, so the build and tests see the live env.
export function isPrivateModelHostAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development' || env.ALLOW_PRIVATE_MODEL_HOSTS === '1'
}

function fail(code: ModelErrorCode): { ok: false; code: ModelErrorCode } {
  return { ok: false, code }
}

function isLocalhostName(host: string): boolean {
  const bare = host.replace(/\.+$/, '')
  return bare === 'localhost' || bare.endsWith('.localhost')
}

// The authority as typed, so an empty userinfo ("https://@host") is caught even though URL drops it.
function rawAuthority(raw: string): string {
  const afterScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/*/i, '')
  const end = afterScheme.search(/[/?#\\]/)
  return end === -1 ? afterScheme : afterScheme.slice(0, end)
}

function stripPath(pathname: string): string {
  let path = pathname.replace(/\/+$/, '')
  if (path.endsWith('/chat/completions')) path = path.slice(0, -'/chat/completions'.length)
  return path.replace(/\/+$/, '')
}

export function checkModelBaseUrl(raw: unknown, opts: ModelUrlOptions): ModelUrlCheck {
  if (typeof raw !== 'string' || raw.length === 0) return fail('model_invalid_url')
  if (raw.length > MODEL_LIMITS.baseUrl) return fail('model_url_too_long')

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return fail('model_invalid_url')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fail('model_https_required')
  const protocol: ModelProtocol = url.protocol

  if (url.username !== '' || url.password !== '' || rawAuthority(raw).includes('@')) return fail('model_invalid_url')
  // URL reports an empty query or fragment as '', so check the raw string too.
  if (url.search !== '' || url.hash !== '' || raw.includes('?') || raw.includes('#')) return fail('model_invalid_url')

  let host = url.hostname
  if (!host || host.includes('%')) return fail('model_invalid_url')
  const bracketed = host.startsWith('[') && host.endsWith(']')
  if (bracketed) host = host.slice(1, -1)
  if (bracketed && isIP(host) !== 6) return fail('model_invalid_url')
  host = host.toLowerCase()

  let nonPublic: boolean
  let isLiteralOrLocal: boolean
  if (isIP(host)) {
    nonPublic = classifyAddress(host) !== 'public'
    isLiteralOrLocal = true
  } else if (isLocalhostName(host)) {
    nonPublic = true
    isLiteralOrLocal = true
  } else {
    nonPublic = false
    isLiteralOrLocal = false
  }

  if (nonPublic && !opts.allowPrivate) return fail('model_address_blocked')
  if (protocol === 'http:') {
    if (!opts.allowPrivate) return fail('model_https_required')
    // A public literal never gets plain http; a hostname is held to non-public addresses by guardedLookup.
    if (isLiteralOrLocal && !nonPublic) return fail('model_https_required')
  }

  const baseUrl = `${protocol}//${url.host}${stripPath(url.pathname)}`
  return { ok: true, baseUrl, host, protocol }
}

export function validateModelInput(raw: unknown, opts: ModelUrlOptions): ModelInputResult {
  if (typeof raw !== 'object' || raw === null) return fail('model_invalid_url')
  const { baseUrl, model, apiKey } = raw as Record<string, unknown>

  if (typeof baseUrl !== 'string' || baseUrl.length === 0) return fail('model_invalid_url')
  if (baseUrl.length > MODEL_LIMITS.baseUrl) return fail('model_url_too_long')
  if (typeof model !== 'string' || model.length > MODEL_LIMITS.modelId || !MODEL_ID_PATTERN.test(model)) {
    return fail('model_invalid_id')
  }
  if (typeof apiKey !== 'string' || apiKey.length > MODEL_LIMITS.apiKey || !API_KEY_PATTERN.test(apiKey)) {
    return fail('model_invalid_key')
  }

  const checked = checkModelBaseUrl(baseUrl, opts)
  if (!checked.ok) return checked
  return { ok: true, config: { baseUrl: checked.baseUrl, model, apiKey } }
}

function wantedFamily(family: unknown): 4 | 6 | 0 {
  if (family === 4 || family === 'IPv4') return 4
  if (family === 6 || family === 'IPv6') return 6
  return 0
}

// Passed as the `lookup` option of http(s).request: the addresses checked here are the only ones the
// socket can connect to. Literal-IP hosts skip lookup, so checkModelBaseUrl must also run on every call.
export function guardedLookup(opts: GuardedLookupOptions): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, results) => {
      if (err || !Array.isArray(results) || results.length === 0) {
        callback(new ModelError('model_unreachable'), '', 0)
        return
      }
      const classes = results.map((r) => classifyAddress(r.address))
      const blocked = opts.allowPrivate
        ? opts.protocol === 'http:' && classes.some((c) => c === 'public')
        : classes.some((c) => c !== 'public')
      if (blocked) {
        callback(new ModelError('model_address_blocked'), '', 0)
        return
      }

      const family = wantedFamily(options?.family)
      const usable = family === 0 ? results : results.filter((r) => r.family === family)
      if (usable.length === 0) {
        callback(new ModelError('model_unreachable'), '', 0)
        return
      }
      if (options?.all) {
        callback(null, usable.map((r) => ({ address: r.address, family: r.family })))
      } else {
        callback(null, usable[0].address, usable[0].family)
      }
    })
  }
}
