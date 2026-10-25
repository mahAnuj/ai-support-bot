/** @jest-environment node */
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  bodySha256Hex,
  canonicalString,
  generateKeyId,
  generateNonce,
  generateSecret,
  signCanonical,
  signRequestHeaders,
} from '../signing'
import { CONNECTOR_HEADERS, KEY_ID_PATTERN, NONCE_PATTERN, SECRET_PATTERN, SIGNATURE_PATTERN } from '../shared'

interface Vector {
  name: string
  keyId: string
  secret: string
  method: string
  path: string
  timestamp: string
  nonce: string
  body: string
  bodySha256: string
  canonical: string
  signature: string
  expect: 'valid' | 'invalid'
  reason?: 'body_mismatch' | 'path_mismatch' | 'bad_signature'
  signed?: { method: string; path: string; body: string }
}

const file = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'connector-test-vectors.json'), 'utf8')) as {
  schema: string
  vectors: Vector[]
}
const vectors = file.vectors
const valid = vectors.filter((v) => v.expect === 'valid')
const invalid = vectors.filter((v) => v.expect === 'invalid')

const REQUIRED = [
  'get-empty-body',
  'post-search',
  'post-non-ascii',
  'get-path-with-query',
  'delete-document',
  'tampered-body',
  'tampered-path',
  'tampered-signature',
]

describe('connector test vectors', () => {
  it('has the schema and every required vector', () => {
    expect(file.schema).toBe('connector-test-vectors/1')
    const names = vectors.map((v) => v.name)
    for (const name of REQUIRED) expect(names).toContain(name)
    expect(valid.length).toBeGreaterThanOrEqual(5)
    expect(invalid.length).toBeGreaterThanOrEqual(3)
  })

  it.each(valid.map((v) => [v.name, v] as const))('reproduces valid vector %s byte for byte', (_name, v) => {
    expect(bodySha256Hex(v.body)).toBe(v.bodySha256)
    expect(bodySha256Hex(Buffer.from(v.body, 'utf8'))).toBe(v.bodySha256)
    const canonical = canonicalString({
      method: v.method,
      path: v.path,
      timestamp: v.timestamp,
      nonce: v.nonce,
      bodySha256: v.bodySha256,
    })
    expect(canonical).toBe(v.canonical)
    expect(signCanonical(v.secret, canonical)).toBe(v.signature)

    const headers = signRequestHeaders({
      config: { keyId: v.keyId, secret: v.secret },
      method: v.method,
      path: v.path,
      body: v.body,
      nowSeconds: Number(v.timestamp),
      nonce: v.nonce,
    })
    expect(headers).toEqual({
      [CONNECTOR_HEADERS.keyId]: v.keyId,
      [CONNECTOR_HEADERS.timestamp]: v.timestamp,
      [CONNECTOR_HEADERS.nonce]: v.nonce,
      [CONNECTOR_HEADERS.signature]: v.signature,
    })
  })

  it.each(invalid.map((v) => [v.name, v] as const))('refuses invalid vector %s', (_name, v) => {
    expect(v.signed).toBeDefined()
    const signed = v.signed!
    // The vector's own fields describe what was signed.
    const signedCanonical = canonicalString({
      method: signed.method,
      path: signed.path,
      timestamp: v.timestamp,
      nonce: v.nonce,
      bodySha256: bodySha256Hex(signed.body),
    })
    expect(signedCanonical).toBe(v.canonical)
    if (v.reason !== 'bad_signature') expect(signCanonical(v.secret, signedCanonical)).toBe(v.signature)

    // Recomputing over what was sent never matches the presented signature.
    const sentCanonical = canonicalString({
      method: v.method,
      path: v.path,
      timestamp: v.timestamp,
      nonce: v.nonce,
      bodySha256: bodySha256Hex(v.body),
    })
    expect(signCanonical(v.secret, sentCanonical)).not.toBe(v.signature)
  })
})

describe('canonicalString', () => {
  it('upper-cases the method, joins with LF and has no trailing newline', () => {
    const c = canonicalString({ method: 'post', path: '/v1/search', timestamp: '1', nonce: 'n', bodySha256: 'h' })
    expect(c).toBe('v1\nPOST\n/v1/search\n1\nn\nh')
  })

  it('hashes an empty body to the SHA-256 of nothing', () => {
    expect(bodySha256Hex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})

describe('signRequestHeaders', () => {
  it('uses the current time and a fresh nonce by default', () => {
    const before = Math.floor(Date.now() / 1000)
    const config = { keyId: generateKeyId(), secret: generateSecret() }
    const a = signRequestHeaders({ config, method: 'GET', path: '/v1/health' })
    const b = signRequestHeaders({ config, method: 'GET', path: '/v1/health' })
    const ts = Number(a[CONNECTOR_HEADERS.timestamp])
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(before + 2)
    expect(a[CONNECTOR_HEADERS.nonce]).not.toBe(b[CONNECTOR_HEADERS.nonce])
    expect(a[CONNECTOR_HEADERS.signature]).toMatch(SIGNATURE_PATTERN)
    expect(a[CONNECTOR_HEADERS.keyId]).toBe(config.keyId)
    expect(JSON.stringify(a)).not.toContain(config.secret)
  })
})

describe('generators', () => {
  it('produce well-formed, distinct values', () => {
    const ids = new Set<string>()
    const secrets = new Set<string>()
    const nonces = new Set<string>()
    for (let i = 0; i < 200; i++) {
      const id = generateKeyId()
      const secret = generateSecret()
      const nonce = generateNonce()
      expect(id).toMatch(KEY_ID_PATTERN)
      expect(secret).toMatch(SECRET_PATTERN)
      expect(secret).toHaveLength(43)
      expect(nonce).toMatch(NONCE_PATTERN)
      expect(nonce).toHaveLength(22)
      ids.add(id)
      secrets.add(secret)
      nonces.add(nonce)
    }
    expect(ids.size).toBe(200)
    expect(secrets.size).toBe(200)
    expect(nonces.size).toBe(200)
  })
})
