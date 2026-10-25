import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import pg from 'pg'
import { PgNonceStore } from '../src/nonce-store.js'
import { checkSchema, createPgStore } from '../src/pg-store.js'
import { fakeVector } from './helpers/fake-embedder.js'

// Needs a Postgres with pgvector and sql/schema.sql applied, for example:
//   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/schema.sql
//   TEST_DATABASE_URL=... npm test
const url = process.env.TEST_DATABASE_URL

describe('Postgres store and nonce store', { skip: url ? false : 'TEST_DATABASE_URL is not set' }, () => {
  let pool: pg.Pool
  const created: string[] = []
  const keyId = `ck_${randomBytes(8).toString('hex')}`

  before(async () => {
    pool = new pg.Pool({ connectionString: url, max: 4 })
    await checkSchema(pool)
  })

  after(async () => {
    if (!pool) return
    for (const id of created) await pool.query('DELETE FROM support_bot_connector.documents WHERE id = $1', [id])
    await pool.query('DELETE FROM support_bot_connector.nonces WHERE key_id = $1', [keyId])
    await pool.end()
  })

  test('insert, list, search order and delete', async () => {
    const store = createPgStore(pool)
    const tag = randomBytes(4).toString('hex')
    const texts = [`alpha ${tag} upload files`, `beta ${tag} office hours`, `gamma ${tag} refund policy`]
    const a = await store.insertDocument(
      { filename: `a-${tag}.md`, contentType: 'text/markdown', passages: texts.map((text, index) => ({ index, text })) },
      texts.map(fakeVector),
    )
    created.push(a.id)
    assert.equal(a.passageCount, 3)
    assert.ok(!Number.isNaN(Date.parse(a.createdAt)))

    const listed = await store.listDocuments(1000)
    const mine = listed.find((d) => d.id === a.id)
    assert.deepEqual(mine && { filename: mine.filename, contentType: mine.contentType, passageCount: mine.passageCount }, {
      filename: `a-${tag}.md`,
      contentType: 'text/markdown',
      passageCount: 3,
    })

    const hits = await store.search(fakeVector(texts[2]), 10)
    assert.equal(hits[0].documentId, a.id)
    assert.equal(hits[0].text, texts[2])
    assert.ok(Math.abs(hits[0].score - 1) < 1e-5)
    for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score)

    assert.equal(await store.deleteDocument(a.id), true)
    assert.equal(await store.deleteDocument(a.id), false)
    assert.equal(await store.deleteDocument('not-a-uuid'), false)
    const left = await pool.query('SELECT count(*)::int AS n FROM support_bot_connector.chunks WHERE document_id = $1', [a.id])
    assert.equal(left.rows[0].n, 0, 'chunks are removed with the document')
  })

  test('a failed insert stores nothing', async () => {
    const store = createPgStore(pool)
    await assert.rejects(
      store.insertDocument(
        { filename: 'dup.md', contentType: 'text/markdown', passages: [{ index: 0, text: 'a' }, { index: 0, text: 'b' }] },
        [fakeVector('a'), fakeVector('b')],
      ),
    )
    const rows = await pool.query("SELECT count(*)::int AS n FROM support_bot_connector.documents WHERE filename = 'dup.md'")
    assert.equal(rows.rows[0].n, 0)
  })

  test('nonces survive a restart: a second pool and store refuse a nonce the first recorded', async () => {
    const nonce = randomBytes(16).toString('base64url')
    const first = new PgNonceStore(pool)
    assert.equal(await first.remember(keyId, nonce), true)
    assert.equal(await first.remember(keyId, nonce), false)

    const pool2 = new pg.Pool({ connectionString: url, max: 1 })
    try {
      const second = new PgNonceStore(pool2)
      assert.equal(await second.remember(keyId, nonce), false)
      assert.equal(await second.remember(keyId, randomBytes(16).toString('base64url')), true)
      assert.equal(typeof (await second.purge()), 'number')
    } finally {
      await pool2.end()
    }
  })
})
