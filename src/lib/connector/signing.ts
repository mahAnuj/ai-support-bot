import { createHash, createHmac, randomBytes } from 'node:crypto'
import { CONNECTOR_HEADERS, type ConnectorConfig } from './shared'

export type ConnectorMethod = 'GET' | 'POST' | 'DELETE'

export interface CanonicalInput {
  method: string
  // Path and query exactly as sent, relative to the base URL, starting with /v1/.
  path: string
  timestamp: string
  nonce: string
  bodySha256: string
}

export interface SignRequestInput {
  config: Pick<ConnectorConfig, 'keyId' | 'secret'>
  method: string
  path: string
  body?: string | Buffer
  nowSeconds?: number
  nonce?: string
}

export type ConnectorSignatureHeaders = Record<(typeof CONNECTOR_HEADERS)[keyof typeof CONNECTOR_HEADERS], string>

export function bodySha256Hex(body: string | Buffer = ''): string {
  const bytes = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
  return createHash('sha256').update(bytes).digest('hex')
}

export function canonicalString(input: CanonicalInput): string {
  return ['v1', input.method.toUpperCase(), input.path, input.timestamp, input.nonce, input.bodySha256].join('\n')
}

// The HMAC key is the UTF-8 bytes of the 43-character secret string, not its decoded bytes.
export function signCanonical(secret: string, canonical: string): string {
  return 'v1=' + createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(canonical, 'utf8')).digest('hex')
}

export function signRequestHeaders(input: SignRequestInput): ConnectorSignatureHeaders {
  const timestamp = String(Math.floor(input.nowSeconds ?? Date.now() / 1000))
  const nonce = input.nonce ?? generateNonce()
  const canonical = canonicalString({
    method: input.method,
    path: input.path,
    timestamp,
    nonce,
    bodySha256: bodySha256Hex(input.body ?? ''),
  })
  return {
    [CONNECTOR_HEADERS.keyId]: input.config.keyId,
    [CONNECTOR_HEADERS.timestamp]: timestamp,
    [CONNECTOR_HEADERS.nonce]: nonce,
    [CONNECTOR_HEADERS.signature]: signCanonical(input.config.secret, canonical),
  } as ConnectorSignatureHeaders
}

export function generateKeyId(): string {
  return 'ck_' + randomBytes(8).toString('hex')
}

export function generateSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function generateNonce(): string {
  return randomBytes(16).toString('base64url')
}
