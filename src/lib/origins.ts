// Exact-origin allowlists for widgets. Pure and client-safe: the builder uses
// it for inline errors and the server uses it for enforcement, so both agree.

export const MAX_ALLOWED_ORIGINS = 10
export const MAX_ORIGIN_LENGTH = 255

// Inputs this long can never normalise to a 255-character origin; refuse them
// before handing them to the URL parser.
const MAX_ORIGIN_INPUT_LENGTH = 2048

export type OriginErrorCode =
  | 'origin_empty'
  | 'origin_missing_scheme'
  | 'origin_bad_scheme'
  | 'origin_has_path'
  | 'origin_has_query'
  | 'origin_has_userinfo'
  | 'origin_wildcard'
  | 'origin_invalid'
  | 'origin_too_long'
  | 'origin_duplicate'
  | 'origin_too_many'

export const ORIGIN_ERROR_MESSAGES: Record<OriginErrorCode, string> = {
  origin_empty: 'Enter a site, like https://example.com',
  origin_missing_scheme: 'Add https:// or http:// at the start, like https://example.com',
  origin_bad_scheme: 'Use https:// or http://, like https://example.com',
  origin_has_path: 'Remove the path: enter only https://example.com',
  origin_has_query: 'Remove the ? or # part: enter only https://example.com',
  origin_has_userinfo: 'Remove the user name or password before the @: enter only https://example.com',
  origin_wildcard: "Wildcards aren't supported: list each site",
  origin_invalid: "This isn't a valid site address. Enter it like https://example.com",
  origin_too_long: `Site addresses can be at most ${MAX_ORIGIN_LENGTH} characters`,
  origin_duplicate: 'This site is already in the list',
  origin_too_many: `List at most ${MAX_ALLOWED_ORIGINS} sites`,
}

export const ORIGINS_REQUIRED_MESSAGE =
  'Add at least one allowed site before generating an embed that uses your own model.'

export type OriginPolicy =
  | { kind: 'any' }
  | { kind: 'legacy'; domains: string[] }
  | { kind: 'exact'; origins: string[] }

export type NormalizeOriginResult = { ok: true; origin: string } | { ok: false; code: OriginErrorCode }

export type NormalizeOriginListResult =
  | { ok: true; origins: string[] }
  | { ok: false; code: OriginErrorCode; index: number }

/** `scheme://host[:port]` with an optional trailing `/`, returned as `URL.origin`. */
export function normalizeOrigin(input: string): NormalizeOriginResult {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, code: 'origin_empty' }
  if (trimmed.length > MAX_ORIGIN_INPUT_LENGTH) return { ok: false, code: 'origin_too_long' }
  if (trimmed.toLowerCase() === 'null') return { ok: false, code: 'origin_invalid' }
  if (trimmed.includes('*')) return { ok: false, code: 'origin_wildcard' }

  const schemeEnd = trimmed.indexOf('://')
  if (schemeEnd === -1) return { ok: false, code: 'origin_missing_scheme' }

  const scheme = trimmed.slice(0, schemeEnd).toLowerCase()
  if (scheme !== 'https' && scheme !== 'http') return { ok: false, code: 'origin_bad_scheme' }

  const rest = trimmed.slice(schemeEnd + 3)
  // The URL parser treats `\` like `/` for http(s), so it ends the authority too.
  const authorityEnd = rest.search(/[/\\?#]/)
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd)
  const after = authorityEnd === -1 ? '' : rest.slice(authorityEnd)

  if (authority.includes('@')) return { ok: false, code: 'origin_has_userinfo' }
  if (rest.includes('?') || rest.includes('#')) return { ok: false, code: 'origin_has_query' }
  if (after !== '' && after !== '/') return { ok: false, code: 'origin_has_path' }

  let url: URL
  try {
    url = new URL(`${scheme}://${authority}`)
  } catch {
    return { ok: false, code: 'origin_invalid' }
  }
  if (url.hostname === '' || url.origin === 'null') return { ok: false, code: 'origin_invalid' }
  if (url.origin.length > MAX_ORIGIN_LENGTH) return { ok: false, code: 'origin_too_long' }

  return { ok: true, origin: url.origin }
}

/** An array of at most 10 distinct origins. Errors carry the index of the offending entry. */
export function normalizeOriginList(input: unknown): NormalizeOriginListResult {
  if (!Array.isArray(input)) return { ok: false, code: 'origin_invalid', index: -1 }
  if (input.length > MAX_ALLOWED_ORIGINS) {
    return { ok: false, code: 'origin_too_many', index: MAX_ALLOWED_ORIGINS }
  }

  const origins: string[] = []
  for (let index = 0; index < input.length; index++) {
    const entry: unknown = input[index]
    if (typeof entry !== 'string') return { ok: false, code: 'origin_invalid', index }
    const result = normalizeOrigin(entry)
    if (!result.ok) return { ok: false, code: result.code, index }
    if (origins.includes(result.origin)) return { ok: false, code: 'origin_duplicate', index }
    origins.push(result.origin)
  }
  return { ok: true, origins }
}

/**
 * Exact match of a request's Origin header against normalised origins. A
 * missing, `null` or malformed header never matches.
 */
export function exactOriginAllowed(origins: readonly string[], header: string | null): boolean {
  if (!header) return false
  const result = normalizeOrigin(header)
  return result.ok && origins.includes(result.origin)
}

/** The origin of an http(s) Referer, or null. */
export function originFromReferer(referer: string | null): string | null {
  if (!referer) return null
  try {
    const url = new URL(referer)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}
