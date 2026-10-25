/** @jest-environment node */
import { MIN_SIMILARITY } from '../../embeddings'
import { validateConnectionString, type ParsedConnection } from '../connection'
import { isStorageError } from '../errors'
import { memoryStore } from '../memory-store'
import { migrateSessionToPostgres } from '../migrate'
import { discardPool, getPool } from '../pg-pool'
import { createPostgresStore } from '../pg-store'
import { EMBEDDING_DIM, ensureSchema } from '../schema'
import type { ChunkInput, KnowledgeStore } from '../types'

// Runs only against a disposable database that already has `CREATE EXTENSION vector`:
//   TEST_DATABASE_URL=postgresql://user:pw@localhost:5432/scratch npx jest pg.integration
// It creates the support_bot schema if missing and deletes only the workspaces it created.
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), Number.EPSILON)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

function randomVector(rand: () => number): number[] {
  return Array.from({ length: EMBEDDING_DIM }, () => gaussian(rand))
}

// Real embeddings are float32 and pgvector stores float4, so round to float32 to compare like with like.
function unit(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return v.map((x) => Math.fround(x / norm))
}

function mix(a: number[], b: number[], weightB: number): number[] {
  return a.map((x, i) => x + weightB * b[i])
}

const PARITY_CHUNKS = 30
const QUERY_COUNT = 5

run('Postgres knowledge store (integration)', () => {
  let connection: ParsedConnection
  let previousAllowPrivate: string | undefined
  const createdWorkspaces: string[] = []
  const rand = mulberry32(0x5eed)

  // Three clusters so similarities spread across the thresholds instead of all sitting near zero.
  const centres = [randomVector(rand), randomVector(rand), randomVector(rand)]
  const parityVectors = Array.from({ length: PARITY_CHUNKS }, (_, i) =>
    unit(mix(centres[i % 3], randomVector(rand), 0.4 + (i / PARITY_CHUNKS) * 1.2)),
  )
  const queries = Array.from({ length: QUERY_COUNT }, (_, q) =>
    unit(mix(parityVectors[q * 5], unit(randomVector(rand)), 0.6 + q * 0.2)),
  )
  const toChunks = (vectors: number[][], offset: number, label: string): ChunkInput[] =>
    vectors.map((embedding, i) => ({ content: `${label} chunk ${offset + i}`, embedding, index: offset + i }))

  let memorySessionId: string
  let workspaceA: string
  let storeA: KnowledgeStore

  async function chunkCount(workspaceId: string): Promise<number> {
    const pool = await getPool(connection)
    const result = await pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM support_bot.chunks WHERE workspace_id = $1',
      [workspaceId],
    )
    return result.rows[0].n
  }

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    previousAllowPrivate = process.env.ALLOW_PRIVATE_DB_HOSTS
    process.env.ALLOW_PRIVATE_DB_HOSTS = '1'

    const checked = validateConnectionString(process.env.TEST_DATABASE_URL, { allowPrivate: true })
    if (!checked.ok) throw new Error(`TEST_DATABASE_URL rejected: ${checked.code}`)
    connection = checked.connection
  })

  afterAll(async () => {
    try {
      if (createdWorkspaces.length > 0) {
        const pool = await getPool(connection)
        await pool.query('DELETE FROM support_bot.workspaces WHERE id = ANY($1::uuid[])', [createdWorkspaces])
      }
    } finally {
      await discardPool(connection)
      if (previousAllowPrivate === undefined) delete process.env.ALLOW_PRIVATE_DB_HOSTS
      else process.env.ALLOW_PRIVATE_DB_HOSTS = previousAllowPrivate
      jest.restoreAllMocks()
    }
  })

  it('ensureSchema survives concurrent and repeated calls', async () => {
    const pool = await getPool(connection)
    await expect(Promise.all(Array.from({ length: 6 }, () => ensureSchema(pool)))).resolves.toHaveLength(6)
    await expect(ensureSchema(pool)).resolves.toBeUndefined()
    await expect(ensureSchema(pool)).resolves.toBeUndefined()
  })

  it('migrates a memory session into Postgres', async () => {
    const session = await memoryStore.createWorkspace()
    memorySessionId = session.id
    await memoryStore.storeDocument(memorySessionId, 'first.md', toChunks(parityVectors.slice(0, 15), 0, 'first'))
    await memoryStore.storeDocument(memorySessionId, 'second.md', toChunks(parityVectors.slice(15), 15, 'second'))

    const result = await migrateSessionToPostgres(connection, memorySessionId)
    workspaceA = result.workspaceId
    createdWorkspaces.push(workspaceA)
    storeA = createPostgresStore(connection, workspaceA)

    expect(result.migratedDocuments).toBe(2)
    expect(result.migratedChunks).toBe(PARITY_CHUNKS)
    expect(await chunkCount(workspaceA)).toBe(PARITY_CHUNKS)
  })

  it.each([
    ['MIN_SIMILARITY', MIN_SIMILARITY, PARITY_CHUNKS],
    ['0.3', 0.3, PARITY_CHUNKS],
    ['0.3, top 5', 0.3, 5],
  ])('returns the same chunks as the memory store at threshold %s', async (_label, threshold, maxResults) => {
    let compared = 0
    for (const queryEmbedding of queries) {
      const memory = await memoryStore.searchChunks({ workspaceId: memorySessionId, queryEmbedding, threshold, maxResults })
      const postgres = await storeA.searchChunks({ workspaceId: workspaceA, queryEmbedding, threshold, maxResults })

      expect(postgres.map((r) => r.chunk_index)).toEqual(memory.map((r) => r.chunk_index))
      postgres.forEach((r, i) => {
        expect(Math.abs(r.similarity - memory[i].similarity)).toBeLessThan(0.001)
        expect(r.content).toBe(memory[i].content)
        expect(r.filename).toBe(memory[i].filename)
      })
      compared += memory.length
    }
    // Guard against a vacuous pass where nothing clears the threshold.
    expect(compared).toBeGreaterThan(QUERY_COUNT * 2)
  })

  it('a second migration of the same session copies nothing', async () => {
    const before = await storeA.listDocuments(workspaceA)
    const again = await migrateSessionToPostgres(connection, memorySessionId)

    expect(again).toEqual({ workspaceId: workspaceA, migratedDocuments: 0, migratedChunks: 0 })
    expect(await storeA.listDocuments(workspaceA)).toHaveLength(before.length)
    expect(await chunkCount(workspaceA)).toBe(PARITY_CHUNKS)
  })

  it('keeps workspaces isolated', async () => {
    const workspaceB = (await storeA.createWorkspace()).id
    createdWorkspaces.push(workspaceB)
    const storeB = createPostgresStore(connection, workspaceB)
    // B holds the query vectors themselves, so B's chunks would outrank A's if the filter leaked.
    await storeB.storeDocument(workspaceB, 'other.md', toChunks(queries, 0, 'other'))
    const widgetB = await storeB.createWidget(workspaceB, {
      name: 'B widget',
      title: 'B',
      welcome_message: 'hi',
      primary_color: '#000000',
      position: 'bottom-right',
      size: 'medium',
      allowed_domains: [],
    })

    const chunkIdsOf = async (store: KnowledgeStore, workspaceId: string) => {
      const ids = new Set<string>()
      for (const queryEmbedding of queries) {
        const results = await store.searchChunks({ workspaceId, queryEmbedding, threshold: -1, maxResults: 100 })
        results.forEach((r) => ids.add(r.chunk_id))
      }
      return ids
    }
    const idsA = await chunkIdsOf(storeA, workspaceA)
    const idsB = await chunkIdsOf(storeB, workspaceB)

    expect(idsA.size).toBe(PARITY_CHUNKS)
    expect(idsB.size).toBe(QUERY_COUNT)
    for (const id of idsB) expect(idsA.has(id)).toBe(false)

    expect(await storeA.getWidget(widgetB.id)).toBeNull()
    expect(await storeB.getWidget(widgetB.id)).not.toBeNull()

    const crossCalls: Array<() => Promise<unknown>> = [
      () => storeA.searchChunks({ workspaceId: workspaceB, queryEmbedding: queries[0], threshold: 0, maxResults: 5 }),
      () => storeA.listDocuments(workspaceB),
      () => storeA.storeDocument(workspaceB, 'x.md', toChunks([queries[0]], 0, 'x')),
      () => storeA.searchWidgetChunks(widgetB, { queryEmbedding: queries[0], threshold: 0, maxResults: 5 }),
    ]
    for (const call of crossCalls) {
      const err = await call().then(
        () => null,
        (e: unknown) => e,
      )
      expect(isStorageError(err) && err.code).toBe('workspace_not_found')
    }
    expect(await chunkCount(workspaceB)).toBe(QUERY_COUNT)
  })
})
