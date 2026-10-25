import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { MemoryNonceStore } from '../src/nonce-store.js'
import { bodySha256Hex, canonicalString, signCanonical, verifyRequest } from '../src/signing.js'

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
  reason?: string
  signed?: { method: string; path: string; body: string }
}

const file = process.env.CONNECTOR_TEST_VECTORS ?? path.resolve(process.cwd(), '..', 'docs', 'connector-test-vectors.json')
const parsed = JSON.parse(readFileSync(file, 'utf8')) as { schema: string; vectors: Vector[] }
const vectors = parsed.vectors

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

function headersFor(v: Vector) {
  return {
    'x-connector-key-id': v.keyId,
    'x-connector-timestamp': v.timestamp,
    'x-connector-nonce': v.nonce,
    'x-connector-signature': v.signature,
  }
}

test('the vector file has the expected schema and every required vector', () => {
  assert.equal(parsed.schema, 'connector-test-vectors/1')
  const names = vectors.map((v) => v.name)
  for (const name of REQUIRED) assert.ok(names.includes(name), `missing vector ${name}`)
})

for (const v of vectors.filter((x) => x.expect === 'valid')) {
  test(`valid vector ${v.name}: hash, canonical string and signature match byte for byte`, async () => {
    assert.equal(bodySha256Hex(v.body), v.bodySha256)
    const canonical = canonicalString({ method: v.method, path: v.path, timestamp: v.timestamp, nonce: v.nonce, bodySha256: v.bodySha256 })
    assert.equal(canonical, v.canonical)
    assert.equal(signCanonical(v.secret, canonical), v.signature)

    const result = await verifyRequest({
      headers: headersFor(v),
      method: v.method,
      path: v.path,
      rawBody: Buffer.from(v.body, 'utf8'),
      keys: new Map([[v.keyId, v.secret]]),
      nowSeconds: Number(v.timestamp),
      nonceStore: new MemoryNonceStore(),
    })
    assert.deepEqual(result, { ok: true, keyId: v.keyId })
  })
}

for (const v of vectors.filter((x) => x.expect === 'invalid')) {
  test(`invalid vector ${v.name} (${v.reason}) is refused`, async () => {
    assert.ok(v.signed, 'invalid vectors carry the signed request')
    // The vector's hash, canonical and signature describe the signed request.
    const signedCanonical = canonicalString({
      method: v.signed.method,
      path: v.signed.path,
      timestamp: v.timestamp,
      nonce: v.nonce,
      bodySha256: bodySha256Hex(v.signed.body),
    })
    assert.equal(signedCanonical, v.canonical)
    assert.equal(bodySha256Hex(v.signed.body), v.bodySha256)

    const onWire = signCanonical(
      v.secret,
      canonicalString({ method: v.method, path: v.path, timestamp: v.timestamp, nonce: v.nonce, bodySha256: bodySha256Hex(v.body) }),
    )
    assert.notEqual(onWire, v.signature)

    const result = await verifyRequest({
      headers: headersFor(v),
      method: v.method,
      path: v.path,
      rawBody: Buffer.from(v.body, 'utf8'),
      keys: new Map([[v.keyId, v.secret]]),
      nowSeconds: Number(v.timestamp),
      nonceStore: new MemoryNonceStore(),
    })
    assert.deepEqual(result, { ok: false, reason: 'bad_signature' })
  })
}
