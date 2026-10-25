import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MemoryNonceStore } from '../src/nonce-store.js'
import { constantTimeEqual, signRequestHeaders, verifyRequest, type HeaderBag } from '../src/signing.js'
import { KEY_ID, SECRET, nowSeconds, signed, startServer } from './helpers/client.js'

const NOW = 1767225600
const keys = new Map([[KEY_ID, SECRET]])
const BODY = '{"query":"hello","topK":3}'

function headers(overrides: Partial<Record<string, string>> = {}, input: { body?: string; path?: string; secret?: string; ts?: number; nonce?: string } = {}) {
  const base = signRequestHeaders({
    keyId: KEY_ID,
    secret: input.secret ?? SECRET,
    method: 'POST',
    path: input.path ?? '/v1/search',
    body: input.body ?? BODY,
    timestamp: String(input.ts ?? NOW),
    nonce: input.nonce ?? 'AAAAAAAAAAAAAAAAAAAAAA',
  })
  return { ...base, ...overrides } as HeaderBag
}

function verify(h: HeaderBag, opts: { body?: string; path?: string; now?: number; store?: MemoryNonceStore } = {}) {
  return verifyRequest({
    headers: h,
    method: 'POST',
    path: opts.path ?? '/v1/search',
    rawBody: Buffer.from(opts.body ?? BODY, 'utf8'),
    keys,
    nowSeconds: opts.now ?? NOW,
    nonceStore: opts.store ?? new MemoryNonceStore(),
  })
}

test('a correctly signed request is accepted', async () => {
  assert.deepEqual(await verify(headers()), { ok: true, keyId: KEY_ID })
})

test('missing headers: none, or only some of the four', async () => {
  assert.deepEqual(await verify({}), { ok: false, reason: 'missing_headers' })
  const partial = headers()
  delete partial['x-connector-nonce']
  assert.deepEqual(await verify(partial), { ok: false, reason: 'missing_headers' })
})

test('malformed headers are refused before any key lookup', async () => {
  const cases: Record<string, string>[] = [
    { 'x-connector-key-id': 'ck_0123456789ABCDEF' },
    { 'x-connector-key-id': 'key_0123456789abcdef' },
    { 'x-connector-timestamp': '01767225600' },
    { 'x-connector-timestamp': '-1767225600' },
    { 'x-connector-nonce': 'short' },
    { 'x-connector-nonce': 'A'.repeat(65) },
    { 'x-connector-signature': 'v2=' + 'a'.repeat(64) },
    { 'x-connector-signature': 'v1=' + 'A'.repeat(64) },
    { 'x-connector-signature': 'v1=' + 'a'.repeat(63) },
  ]
  for (const override of cases) {
    assert.deepEqual(await verify(headers(override)), { ok: false, reason: 'bad_header' }, JSON.stringify(override))
  }
  const repeated = { ...headers(), 'x-connector-nonce': ['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBB'] }
  assert.deepEqual(await verify(repeated), { ok: false, reason: 'bad_header' })
})

test('an unknown key id is refused', async () => {
  assert.deepEqual(await verify(headers({ 'x-connector-key-id': 'ck_ffffffffffffffff' })), { ok: false, reason: 'unknown_key' })
})

test('timestamps outside 300 s either way are refused; the edges are accepted', async () => {
  assert.equal((await verify(headers({}, { ts: NOW - 300 }))).ok, true)
  assert.equal((await verify(headers({}, { ts: NOW + 300 }))).ok, true)
  assert.deepEqual(await verify(headers({}, { ts: NOW - 301 })), { ok: false, reason: 'stale' })
  assert.deepEqual(await verify(headers({}, { ts: NOW + 301 })), { ok: false, reason: 'stale' })
  assert.deepEqual(await verify(headers({}, { ts: NOW - 400 })), { ok: false, reason: 'stale' })
})

test('a wrong secret, a changed body or a changed path fail the signature check', async () => {
  const otherSecret = 'B'.repeat(43)
  assert.deepEqual(await verify(headers({}, { secret: otherSecret })), { ok: false, reason: 'bad_signature' })
  assert.deepEqual(await verify(headers(), { body: '{"query":"hello","topK":4}' }), { ok: false, reason: 'bad_signature' })
  assert.deepEqual(await verify(headers(), { path: '/v1/answer' }), { ok: false, reason: 'bad_signature' })
  assert.deepEqual(await verify(headers(), { path: '/v1/search?x=1' }), { ok: false, reason: 'bad_signature' })
})

test('a replayed nonce is refused; a bad signature does not use up the nonce', async () => {
  const store = new MemoryNonceStore()
  assert.deepEqual(await verify(headers({}, { secret: 'B'.repeat(43) }), { store }), { ok: false, reason: 'bad_signature' })
  assert.equal(store.size, 0)
  assert.equal((await verify(headers(), { store })).ok, true)
  assert.deepEqual(await verify(headers(), { store }), { ok: false, reason: 'replay' })
  // The same nonce under another key id is a different pair.
  const twoKeys = new Map([...keys, ['ck_aaaaaaaaaaaaaaaa', SECRET]])
  const other = signRequestHeaders({ keyId: 'ck_aaaaaaaaaaaaaaaa', secret: SECRET, method: 'POST', path: '/v1/search', body: BODY, timestamp: String(NOW), nonce: 'AAAAAAAAAAAAAAAAAAAAAA' })
  const result = await verifyRequest({ headers: other, method: 'POST', path: '/v1/search', rawBody: Buffer.from(BODY), keys: twoKeys, nowSeconds: NOW, nonceStore: store })
  assert.equal(result.ok, true)
})

test('constantTimeEqual: equal, unequal of equal length, and unequal length', () => {
  const a = 'v1=' + 'a'.repeat(64)
  assert.equal(constantTimeEqual(a, a), true)
  assert.equal(constantTimeEqual(a, 'v1=' + 'a'.repeat(63) + 'b'), false)
  assert.equal(constantTimeEqual(a, 'v1=' + 'a'.repeat(10)), false)
  assert.equal(constantTimeEqual(a, a + 'a'), false)
  assert.equal(constantTimeEqual(a, ''), false)
})

test('replay after a restart: a new server sharing the nonce store refuses the same request', async () => {
  const nonceStore = new MemoryNonceStore()
  const ts = String(nowSeconds())
  const nonce = 'cmVwbGF5LWFmdGVyLXJlc3Q'
  const first = await startServer({ nonceStore })
  try {
    const ok = await signed(first.port, { method: 'GET', path: '/v1/documents', timestamp: ts, nonce })
    assert.equal(ok.status, 200)
    const again = await signed(first.port, { method: 'GET', path: '/v1/documents', timestamp: ts, nonce })
    assert.equal(again.status, 401)
  } finally {
    await first.close()
  }
  const second = await startServer({ nonceStore })
  try {
    const replay = await signed(second.port, { method: 'GET', path: '/v1/documents', timestamp: ts, nonce })
    assert.equal(replay.status, 401)
    assert.deepEqual(replay.json, { error: { code: 'unauthorized' } })
  } finally {
    await second.close()
  }
})

test('over HTTP every failure gets the same 401 body', async () => {
  const server = await startServer()
  try {
    const responses = [
      await signed(server.port, { method: 'GET', path: '/v1/documents', keyId: 'ck_ffffffffffffffff' }),
      await signed(server.port, { method: 'GET', path: '/v1/documents', timestamp: String(nowSeconds() - 400) }),
      await signed(server.port, { method: 'GET', path: '/v1/documents', secret: 'C'.repeat(43) }),
    ]
    for (const r of responses) {
      assert.equal(r.status, 401)
      assert.equal(r.text, '{"error":{"code":"unauthorized"}}')
    }
  } finally {
    await server.close()
  }
})
