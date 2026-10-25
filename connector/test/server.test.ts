import assert from 'node:assert/strict'
import * as http from 'node:http'
import { after, before, describe, test } from 'node:test'
import { ModelCallError, type AnswerInput, type AnswerModel } from '../src/model.js'
import { KEY_ID, SECRET, send, signed, startServer, type TestServer } from './helpers/client.js'

const MODEL_ENV = {
  CONNECTOR_MODEL_BASE_URL: 'http://127.0.0.1:9/v1',
  CONNECTOR_MODEL: 'stub-model',
  CONNECTOR_MODEL_API_KEY: 'sk-test-stub',
}

class StubModel implements AnswerModel {
  inputs: AnswerInput[] = []
  fail = false
  async answer(input: AnswerInput): Promise<string> {
    this.inputs.push(input)
    if (this.fail) throw new ModelCallError('model_http_error')
    return 'stub answer'
  }
}

function doc(filename: string, texts: string[], contentType = 'text/markdown') {
  return JSON.stringify({ filename, contentType, passages: texts.map((text, index) => ({ index, text })) })
}

describe('health', () => {
  test('unsigned health answers without a key; answer is not advertised without the model variables', async () => {
    const s = await startServer({ env: { CONNECTOR_KEYS: '' } })
    try {
      const r = await send(s.port, { method: 'GET', path: '/v1/health' })
      assert.equal(r.status, 200)
      assert.deepEqual(r.json, { version: '1', capabilities: ['documents', 'search'] })
      assert.equal(r.headers['content-type'], 'application/json; charset=utf-8')
      assert.equal(r.headers['cache-control'], 'no-store')
      // With zero keys every signed request is refused.
      const signedHealth = await signed(s.port, { method: 'GET', path: '/v1/health' })
      assert.equal(signedHealth.status, 401)
    } finally {
      await s.close()
    }
  })

  test('answer is advertised only when all three model variables are set', async () => {
    const partial = await startServer({ env: { ...MODEL_ENV, CONNECTOR_MODEL_API_KEY: '' } })
    try {
      const r = await send(partial.port, { method: 'GET', path: '/v1/health' })
      assert.deepEqual(r.json.capabilities, ['documents', 'search'])
      const answer = await signed(partial.port, { method: 'POST', path: '/v1/answer', body: '{"question":"q","passages":[],"systemPrompt":null}' })
      assert.equal(answer.status, 404)
    } finally {
      await partial.close()
    }
    const full = await startServer({ env: MODEL_ENV, model: new StubModel() })
    try {
      const r = await send(full.port, { method: 'GET', path: '/v1/health' })
      assert.deepEqual(r.json, { version: '1', capabilities: ['documents', 'search', 'answer'] })
    } finally {
      await full.close()
    }
  })

  test('signed health is verified: good signature 200, bad signature 401, partial headers 401', async () => {
    const s = await startServer()
    try {
      assert.equal((await signed(s.port, { method: 'GET', path: '/v1/health' })).status, 200)
      const bad = await signed(s.port, { method: 'GET', path: '/v1/health', secret: 'Z'.repeat(43) })
      assert.equal(bad.status, 401)
      assert.deepEqual(bad.json, { error: { code: 'unauthorized' } })
      const partial = await send(s.port, { method: 'GET', path: '/v1/health', headers: { 'X-Connector-Key-Id': KEY_ID } })
      assert.equal(partial.status, 401)
    } finally {
      await s.close()
    }
  })
})

describe('documents and search', () => {
  let s: TestServer
  before(async () => {
    s = await startServer()
  })
  after(async () => {
    await s.close()
  })

  test('unsigned calls to every other endpoint are refused', async () => {
    for (const [method, path] of [
      ['GET', '/v1/documents'],
      ['POST', '/v1/documents'],
      ['DELETE', '/v1/documents/abc'],
      ['POST', '/v1/search'],
    ]) {
      const r = await send(s.port, { method, path, body: method === 'POST' ? '{}' : undefined, headers: method === 'POST' ? { 'content-type': 'application/json' } : {} })
      assert.equal(r.status, 401, `${method} ${path}`)
    }
  })

  test('create, list, search and delete', async () => {
    const created = await signed(s.port, {
      method: 'POST',
      path: '/v1/documents',
      body: doc('faq.md', ['You can upload PDF DOCX TXT and MD files', 'Our office is open on weekdays']),
    })
    assert.equal(created.status, 201)
    assert.equal(created.json.filename, 'faq.md')
    assert.equal(created.json.passageCount, 2)
    assert.match(created.json.id, /^[A-Za-z0-9._~-]{1,128}$/)

    const second = await signed(s.port, { method: 'POST', path: '/v1/documents', body: doc('other.txt', ['pizza recipe with cheese'], 'text/plain') })
    assert.equal(second.status, 201)

    const list = await signed(s.port, { method: 'GET', path: '/v1/documents' })
    assert.equal(list.status, 200)
    assert.deepEqual(
      list.json.documents.map((d: { filename: string; contentType: string; passageCount: number }) => [d.filename, d.contentType, d.passageCount]),
      [
        ['faq.md', 'text/markdown', 2],
        ['other.txt', 'text/plain', 1],
      ],
    )
    assert.ok(!Number.isNaN(Date.parse(list.json.documents[0].createdAt)))

    const query = await signed(s.port, { method: 'POST', path: '/v1/search', body: '{"query":"What files can I upload?","topK":2}' })
    assert.equal(query.status, 200)
    assert.equal(query.json.passages.length, 2)
    assert.equal(query.json.passages[0].filename, 'faq.md')
    assert.equal(query.json.passages[0].text, 'You can upload PDF DOCX TXT and MD files')
    assert.equal(query.json.passages[0].documentId, created.json.id)
    assert.ok(query.json.passages[0].score >= query.json.passages[1].score)
    for (const p of query.json.passages) assert.ok(p.score >= -1 && p.score <= 1)

    const topOne = await signed(s.port, { method: 'POST', path: '/v1/search', body: '{"query":"upload","topK":1}' })
    assert.equal(topOne.json.passages.length, 1)

    const del = await signed(s.port, { method: 'DELETE', path: `/v1/documents/${created.json.id}` })
    assert.equal(del.status, 200)
    assert.deepEqual(del.json, { deleted: true })
    const again = await signed(s.port, { method: 'DELETE', path: `/v1/documents/${created.json.id}` })
    assert.equal(again.status, 404)
    assert.deepEqual(again.json, { error: { code: 'not_found' } })
    const unknown = await signed(s.port, { method: 'DELETE', path: '/v1/documents/not-a-uuid' })
    assert.equal(unknown.status, 404)

    const after = await signed(s.port, { method: 'GET', path: '/v1/documents' })
    assert.equal(after.json.documents.length, 1)
  })

  test('the signed path includes the query string; unknown parameters are ignored', async () => {
    const r = await signed(s.port, { method: 'GET', path: '/v1/documents?page=2' })
    assert.equal(r.status, 200)
    assert.ok(Array.isArray(r.json.documents))
  })

  test('document body rules give 400', async () => {
    const bad = [
      '{',
      '[]',
      JSON.stringify({ filename: '', contentType: 'text/plain', passages: [{ index: 0, text: 'a' }] }),
      JSON.stringify({ filename: 'x'.repeat(256), contentType: 'text/plain', passages: [{ index: 0, text: 'a' }] }),
      JSON.stringify({ filename: 'a.html', contentType: 'text/html', passages: [{ index: 0, text: 'a' }] }),
      JSON.stringify({ filename: 'a.txt', contentType: 'text/plain', passages: [] }),
      JSON.stringify({ filename: 'a.txt', contentType: 'text/plain', passages: [{ index: 0, text: '' }] }),
      JSON.stringify({ filename: 'a.txt', contentType: 'text/plain', passages: [{ index: 0, text: 'x'.repeat(1001) }] }),
      JSON.stringify({ filename: 'a.txt', contentType: 'text/plain', passages: [{ index: 1000, text: 'a' }] }),
      JSON.stringify({ filename: 'a.txt', contentType: 'text/plain', passages: [{ index: 1.5, text: 'a' }] }),
      JSON.stringify({ filename: 'a.txt', contentType: 'text/plain', passages: [{ index: 0, text: 'a' }, { index: 0, text: 'b' }] }),
      JSON.stringify({ filename: 'a.txt', contentType: 'text/plain', passages: Array.from({ length: 1001 }, (_, i) => ({ index: i % 1000, text: 'a' })) }),
    ]
    for (const body of bad) {
      const r = await signed(s.port, { method: 'POST', path: '/v1/documents', body })
      assert.equal(r.status, 400, body.slice(0, 80))
      assert.deepEqual(r.json, { error: { code: 'bad_request' } })
    }
    // A passage of exactly 1,000 UTF-16 code units (emoji count as 2) is accepted.
    const edge = await signed(s.port, { method: 'POST', path: '/v1/documents', body: doc('edge.txt', ['🚀'.repeat(500)], 'text/plain') })
    assert.equal(edge.status, 201)
  })

  test('search body rules give 400', async () => {
    for (const body of [
      '{"query":"","topK":5}',
      '{"query":"x","topK":0}',
      '{"query":"x","topK":11}',
      '{"query":"x","topK":2.5}',
      '{"query":"x"}',
      JSON.stringify({ query: 'x'.repeat(2001), topK: 5 }),
    ]) {
      const r = await signed(s.port, { method: 'POST', path: '/v1/search', body })
      assert.equal(r.status, 400, body.slice(0, 60))
    }
  })

  test('404 for unknown paths, 405 for known paths with the wrong method', async () => {
    assert.equal((await send(s.port, { method: 'GET', path: '/v1/nope' })).status, 404)
    assert.equal((await send(s.port, { method: 'GET', path: '/v1/health/' })).status, 404)
    assert.equal((await send(s.port, { method: 'GET', path: '/' })).status, 404)
    assert.equal((await send(s.port, { method: 'DELETE', path: '/v1/documents/bad%20id' })).status, 404)
    const r = await send(s.port, { method: 'POST', path: '/v1/health' })
    assert.equal(r.status, 405)
    assert.deepEqual(r.json, { error: { code: 'method_not_allowed' } })
    assert.equal(r.headers.allow, 'GET')
    assert.equal((await send(s.port, { method: 'PUT', path: '/v1/documents' })).status, 405)
    assert.equal((await send(s.port, { method: 'GET', path: '/v1/search' })).status, 405)
    assert.equal((await send(s.port, { method: 'GET', path: '/v1/documents/abc' })).status, 405)
  })

  test('415 for a body without a JSON content type', async () => {
    const r = await signed(s.port, { method: 'POST', path: '/v1/search', body: '{"query":"x","topK":1}', contentType: 'text/plain' })
    assert.equal(r.status, 415)
    assert.deepEqual(r.json, { error: { code: 'unsupported_media_type' } })
    const none = await signed(s.port, { method: 'POST', path: '/v1/search', body: '{"query":"x","topK":1}', contentType: null })
    assert.equal(none.status, 415)
    const withCharset = await signed(s.port, { method: 'POST', path: '/v1/search', body: '{"query":"x","topK":1}', contentType: 'Application/JSON; charset=utf-8' })
    assert.equal(withCharset.status, 200)
  })

  test('413 for oversize bodies: declared length, streamed body, and any body on GET or DELETE', async () => {
    const declared = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/v1/documents', agent: false, headers: { 'content-type': 'application/json', 'content-length': String(2_097_153) } }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.flushHeaders()
    })
    assert.equal(declared, 413)

    const streamed = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/v1/search', agent: false, headers: { 'content-type': 'application/json' } }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }))
      })
      req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'EPIPE' || e.code === 'ECONNRESET' ? undefined : reject(e)))
      // Chunked, with no content-length: the server counts bytes as they arrive.
      req.write('{"query":"' + 'x'.repeat(200_000))
      req.write('x'.repeat(100_000) + '","topK":1}')
      req.end()
    })
    assert.equal(streamed.status, 413)
    assert.equal(streamed.body, '{"error":{"code":"payload_too_large"}}')

    const head = '{"query":"x","topK":1,"pad":"'
    const atLimit = head + 'p'.repeat(262_144 - head.length - 2) + '"}'
    assert.equal(Buffer.byteLength(atLimit), 262_144)
    const exactly = await signed(s.port, { method: 'POST', path: '/v1/search', body: atLimit })
    assert.equal(exactly.status, 200)
    const overByOne = await signed(s.port, { method: 'POST', path: '/v1/search', body: atLimit.replace('"pad":"', '"pad":"p') })
    assert.equal(overByOne.status, 413)

    const getWithBody = await send(s.port, { method: 'GET', path: '/v1/documents', body: 'x' })
    assert.equal(getWithBody.status, 413)
    const deleteWithBody = await send(s.port, { method: 'DELETE', path: '/v1/documents/abc', body: '{}' })
    assert.equal(deleteWithBody.status, 413)
  })

  test('a store failure gives 500 internal with no detail', async () => {
    const original = s.store.listDocuments.bind(s.store)
    s.store.listDocuments = async () => {
      throw Object.assign(new Error('connection to secret-host.example.com failed'), { code: '08006' })
    }
    try {
      const r = await signed(s.port, { method: 'GET', path: '/v1/documents' })
      assert.equal(r.status, 500)
      assert.equal(r.text, '{"error":{"code":"internal"}}')
    } finally {
      s.store.listDocuments = original
    }
  })
})

describe('mount prefix', () => {
  test('CONNECTOR_BASE_PATH is stripped before routing and signing', async () => {
    const s = await startServer({ env: { CONNECTOR_BASE_PATH: '/kb' } })
    try {
      const health = await send(s.port, { method: 'GET', path: '/kb/v1/health' })
      assert.equal(health.status, 200)
      assert.equal((await send(s.port, { method: 'GET', path: '/v1/health' })).status, 404)
      assert.equal((await send(s.port, { method: 'GET', path: '/kbx/v1/health' })).status, 404)
      // Signed over /v1/documents, sent to /kb/v1/documents.
      const list = await signed(s.port, { method: 'GET', path: '/v1/documents', prefix: '/kb' })
      assert.equal(list.status, 200)
      // Signing the prefixed path does not verify.
      const wrong = await signed(s.port, { method: 'GET', path: '/kb/v1/documents' })
      assert.equal(wrong.status, 401)
    } finally {
      await s.close()
    }
  })
})

describe('answer', () => {
  test('uses the passages it is given and lists their filenames as sources', async () => {
    const model = new StubModel()
    const s = await startServer({ env: MODEL_ENV, model })
    try {
      const passages = [
        { documentId: 'd1', filename: 'faq.md', text: 'one', score: 0.6 },
        { documentId: 'd2', filename: 'faq.md', text: 'two', score: 0.4 },
        { documentId: 'd3', filename: 'guide.pdf', text: 'three', score: 0.3 },
      ]
      const r = await signed(s.port, { method: 'POST', path: '/v1/answer', body: JSON.stringify({ question: 'What?', passages, systemPrompt: 'Be brief.' }) })
      assert.equal(r.status, 200)
      assert.deepEqual(r.json, { message: 'stub answer', sources: ['faq.md', 'guide.pdf'] })
      assert.equal(model.inputs[0].question, 'What?')
      assert.equal(model.inputs[0].systemPrompt, 'Be brief.')
      assert.equal(model.inputs[0].passages.length, 3)
      assert.equal(s.embedder.calls.length, 0, 'no retrieval when passages are given')

      const empty = await signed(s.port, { method: 'POST', path: '/v1/answer', body: '{"question":"What?","passages":[],"systemPrompt":null}' })
      assert.deepEqual(empty.json, { message: 'stub answer', sources: [] })
    } finally {
      await s.close()
    }
  })

  test('passages: null retrieves top 5 and keeps scores of at least 0.15', async () => {
    const model = new StubModel()
    const s = await startServer({ env: MODEL_ENV, model })
    try {
      await signed(s.port, { method: 'POST', path: '/v1/documents', body: doc('faq.md', ['upload files here', 'unrelated zebra text']) })
      const r = await signed(s.port, { method: 'POST', path: '/v1/answer', body: '{"question":"upload files","passages":null,"systemPrompt":null}' })
      assert.equal(r.status, 200)
      const used = model.inputs[0].passages
      assert.deepEqual(used.map((p) => p.text), ['upload files here'])
      assert.deepEqual(r.json.sources, ['faq.md'])
    } finally {
      await s.close()
    }
  })

  test('body rules give 400; a model failure gives 502 upstream_error', async () => {
    const model = new StubModel()
    const s = await startServer({ env: MODEL_ENV, model })
    try {
      const passage = { documentId: 'd1', filename: 'a', text: 't', score: 0.5 }
      for (const body of [
        '{"question":"","passages":[],"systemPrompt":null}',
        JSON.stringify({ question: 'q', passages: Array(11).fill(passage), systemPrompt: null }),
        JSON.stringify({ question: 'q', passages: [{ ...passage, text: 'x'.repeat(10_001) }], systemPrompt: null }),
        JSON.stringify({ question: 'q', passages: [], systemPrompt: 'x'.repeat(4001) }),
        JSON.stringify({ question: 'q', passages: 'nope', systemPrompt: null }),
      ]) {
        const r = await signed(s.port, { method: 'POST', path: '/v1/answer', body })
        assert.equal(r.status, 400, body.slice(0, 60))
      }
      model.fail = true
      const failed = await signed(s.port, { method: 'POST', path: '/v1/answer', body: '{"question":"q","passages":[],"systemPrompt":null}' })
      assert.equal(failed.status, 502)
      assert.deepEqual(failed.json, { error: { code: 'upstream_error' } })
    } finally {
      await s.close()
    }
  })
})

test('the key and secret constants used by these tests are well formed', () => {
  assert.match(KEY_ID, /^ck_[0-9a-f]{16}$/)
  assert.match(SECRET, /^[A-Za-z0-9_-]{43}$/)
})
