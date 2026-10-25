import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fingerprint, formatRequestLine, formatStartLine } from '../src/log.js'
import { signRequestHeaders } from '../src/signing.js'
import { KEY_ID, SECRET, nowSeconds, send, signed, startServer } from './helpers/client.js'
import { startMockOpenAI } from './helpers/mock-openai.js'

const MODEL_KEY = 'sk-test-SENTINEL-model-key-9f2c'
const QUESTION = 'QUESTION-SENTINEL how do refunds work'
const PASSAGE = 'PASSAGE-SENTINEL refunds are processed within five days'
const FILENAME = 'FILENAME-SENTINEL.md'

function capture() {
  const lines: string[] = []
  const original = { log: console.log, error: console.error, warn: console.warn }
  const push = (...args: unknown[]) => lines.push(args.map(String).join(' '))
  console.log = push
  console.error = push
  console.warn = push
  return {
    lines,
    restore() {
      Object.assign(console, original)
    },
  }
}

test('line formats', () => {
  assert.equal(
    formatRequestLine({ op: 'search', keyId: KEY_ID, outcome: 'ok', status: 200, ms: 12.4 }),
    `connector op=search key=#${fingerprint(KEY_ID)} outcome=ok status=200 ms=12`,
  )
  assert.equal(formatRequestLine({ op: 'unknown', keyId: null, outcome: 'not_found', status: 404, ms: 0 }), 'connector op=unknown key=- outcome=not_found status=404 ms=0')
  assert.equal(formatStartLine({ port: 8080, keys: 0, answer: false, schema: 'ok' }), 'connector start port=8080 keys=0 answer=off schema=ok')
})

test('a full session logs op, outcome and duration only: no secret, signature, key id, model key, question or passage text', async () => {
  const mock = await startMockOpenAI()
  const cap = capture()
  const s = await startServer({
    env: { CONNECTOR_MODEL_BASE_URL: mock.base('ok'), CONNECTOR_MODEL: 'mock-model', CONNECTOR_MODEL_API_KEY: MODEL_KEY },
  })
  const signatures: string[] = []
  try {
    const doc = JSON.stringify({ filename: FILENAME, contentType: 'text/markdown', passages: [{ index: 0, text: PASSAGE }] })
    const docHeaders = signRequestHeaders({ keyId: KEY_ID, secret: SECRET, method: 'POST', path: '/v1/documents', body: doc, timestamp: String(nowSeconds()), nonce: 'bG9nLXRlc3Qtbm9uY2UtMDE' })
    signatures.push(docHeaders['x-connector-signature'])
    assert.equal((await send(s.port, { method: 'POST', path: '/v1/documents', body: doc, headers: { ...docHeaders, 'content-type': 'application/json' } })).status, 201)
    // Replay of the same request: refused and logged as such.
    assert.equal((await send(s.port, { method: 'POST', path: '/v1/documents', body: doc, headers: { ...docHeaders, 'content-type': 'application/json' } })).status, 401)

    assert.equal((await signed(s.port, { method: 'POST', path: '/v1/search', body: JSON.stringify({ query: QUESTION, topK: 3 }) })).status, 200)
    assert.equal(
      (await signed(s.port, { method: 'POST', path: '/v1/answer', body: JSON.stringify({ question: QUESTION, passages: null, systemPrompt: null }) })).status,
      200,
    )
    assert.equal((await signed(s.port, { method: 'POST', path: '/v1/search', body: JSON.stringify({ query: QUESTION, topK: 3 }), secret: 'Q'.repeat(43) })).status, 401)
    assert.equal((await signed(s.port, { method: 'GET', path: '/v1/documents', timestamp: String(nowSeconds() - 400) })).status, 401)
    assert.equal((await send(s.port, { method: 'GET', path: '/v1/health' })).status, 200)
    assert.equal((await send(s.port, { method: 'GET', path: '/v1/secret-path-SENTINEL' })).status, 404)
  } finally {
    await s.close()
    cap.restore()
    await mock.close()
  }

  const text = cap.lines.join('\n')
  for (const sentinel of [SECRET, MODEL_KEY, QUESTION, PASSAGE, FILENAME, KEY_ID, 'secret-path-SENTINEL', ...signatures, 'SENTINEL']) {
    assert.ok(!text.includes(sentinel), `log contains ${sentinel.slice(0, 12)}…`)
  }
  for (const line of cap.lines) {
    assert.match(line, /^connector op=(health|documents|search|answer|unknown) key=(-|#[0-9a-f]{8}) outcome=[a-z_:]+ status=\d{3} ms=\d+$/)
  }
  assert.ok(cap.lines.some((l) => l.startsWith('connector op=documents') && l.includes('outcome=ok status=201')))
  assert.ok(cap.lines.some((l) => l.includes('outcome=unauthorized:replay')))
  assert.ok(cap.lines.some((l) => l.includes('outcome=unauthorized:bad_signature')))
  assert.ok(cap.lines.some((l) => l.includes('outcome=unauthorized:stale')))
  assert.ok(cap.lines.some((l) => l.startsWith('connector op=answer') && l.includes('outcome=ok')))
  assert.ok(cap.lines.some((l) => l.startsWith('connector op=unknown') && l.includes('outcome=not_found')))
})

test('a handler failure logs a code, never the error message', async () => {
  const cap = capture()
  const s = await startServer()
  try {
    s.store.listDocuments = async () => {
      throw Object.assign(new Error('password authentication failed for SENTINEL-host'), { code: '28P01' })
    }
    assert.equal((await signed(s.port, { method: 'GET', path: '/v1/documents' })).status, 500)
  } finally {
    await s.close()
    cap.restore()
  }
  const text = cap.lines.join('\n')
  assert.ok(!text.includes('SENTINEL'))
  assert.ok(cap.lines.includes('connector error op=documents code=28P01'))
})
