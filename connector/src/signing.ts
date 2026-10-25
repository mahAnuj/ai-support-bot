import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { NonceStore } from './nonce-store.js'

// Connector API v1 signing (docs/connector-api.md). Written independently of
// the app's src/lib/connector/signing.ts; both are checked against
// docs/connector-test-vectors.json.

export const SIGNATURE_VERSION = 'v1'
export const SKEW_SECONDS = 300
export const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export const HEADER_NAMES = {
  keyId: 'x-connector-key-id',
  timestamp: 'x-connector-timestamp',
  nonce: 'x-connector-nonce',
  signature: 'x-connector-signature',
} as const

export const KEY_ID_PATTERN = /^ck_[0-9a-f]{16}$/
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/
export const NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/
export const TIMESTAMP_PATTERN = /^[1-9][0-9]{0,11}$/
export const SIGNATURE_PATTERN = /^v1=[0-9a-f]{64}$/

export interface CanonicalInput {
  method: string
  path: string
  timestamp: string
  nonce: string
  bodySha256: string
}

export function bodySha256Hex(body: Buffer | string): string {
  return createHash('sha256').update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body).digest('hex')
}

export function canonicalString(input: CanonicalInput): string {
  return [SIGNATURE_VERSION, input.method.toUpperCase(), input.path, input.timestamp, input.nonce, input.bodySha256].join('\n')
}

export function signCanonical(secret: string, canonical: string): string {
  const mac = createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(canonical, 'utf8')).digest('hex')
  return `${SIGNATURE_VERSION}=${mac}`
}

export interface SignInput {
  keyId: string
  secret: string
  method: string
  path: string
  body: Buffer | string
  timestamp: string
  nonce: string
}

/** The four request headers for a signed call, keyed by their lowercase names. */
export function signRequestHeaders(input: SignInput): Record<string, string> {
  const canonical = canonicalString({
    method: input.method,
    path: input.path,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodySha256: bodySha256Hex(input.body),
  })
  return {
    [HEADER_NAMES.keyId]: input.keyId,
    [HEADER_NAMES.timestamp]: input.timestamp,
    [HEADER_NAMES.nonce]: input.nonce,
    [HEADER_NAMES.signature]: signCanonical(input.secret, canonical),
  }
}

/**
 * Compares two strings without an early exit on the first differing byte.
 * On a length mismatch it still runs a full comparison against a dummy of the
 * expected length, then refuses.
 */
export function constantTimeEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(received, 'utf8')
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length))
    return false
  }
  return timingSafeEqual(a, b)
}

export type HeaderBag = Record<string, string | string[] | undefined>

export type VerifyFailure = 'missing_headers' | 'bad_header' | 'unknown_key' | 'stale' | 'bad_signature' | 'replay'

export type VerifyResult = { ok: true; keyId: string } | { ok: false; reason: VerifyFailure }

export interface VerifyInput {
  headers: HeaderBag
  method: string
  /** Path and query as received, after removing any mount prefix. */
  path: string
  rawBody: Buffer
  keys: ReadonlyMap<string, string>
  nowSeconds: number
  nonceStore: NonceStore
}

/** True when the request carries none of the four connector headers. */
export function isUnsigned(headers: HeaderBag): boolean {
  return Object.values(HEADER_NAMES).every((name) => headers[name] === undefined)
}

function single(headers: HeaderBag, name: string): string | undefined | null {
  const value = headers[name]
  if (value === undefined) return undefined
  // A repeated header is ambiguous: refuse it rather than pick one.
  if (Array.isArray(value)) return null
  return value
}

export async function verifyRequest(input: VerifyInput): Promise<VerifyResult> {
  const keyId = single(input.headers, HEADER_NAMES.keyId)
  const timestamp = single(input.headers, HEADER_NAMES.timestamp)
  const nonce = single(input.headers, HEADER_NAMES.nonce)
  const signature = single(input.headers, HEADER_NAMES.signature)

  if (keyId === undefined || timestamp === undefined || nonce === undefined || signature === undefined) {
    return { ok: false, reason: 'missing_headers' }
  }
  if (
    keyId === null ||
    timestamp === null ||
    nonce === null ||
    signature === null ||
    !KEY_ID_PATTERN.test(keyId) ||
    !TIMESTAMP_PATTERN.test(timestamp) ||
    !NONCE_PATTERN.test(nonce) ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return { ok: false, reason: 'bad_header' }
  }

  const secret = input.keys.get(keyId)
  if (secret === undefined) return { ok: false, reason: 'unknown_key' }

  if (Math.abs(input.nowSeconds - Number(timestamp)) > SKEW_SECONDS) return { ok: false, reason: 'stale' }

  const expected = signCanonical(
    secret,
    canonicalString({
      method: input.method,
      path: input.path,
      timestamp,
      nonce,
      bodySha256: bodySha256Hex(input.rawBody),
    }),
  )
  if (!constantTimeEqual(expected, signature)) return { ok: false, reason: 'bad_signature' }

  // Recorded only after the signature checks out, so unsigned noise cannot fill the store.
  const fresh = await input.nonceStore.remember(keyId, nonce)
  if (!fresh) return { ok: false, reason: 'replay' }

  return { ok: true, keyId }
}
