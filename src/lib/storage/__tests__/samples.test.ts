/** @jest-environment node */
import { exportMemorySession, memoryStore } from '../memory-store'

const chunk = (content: string) => [{ content, embedding: Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)), index: 0 }]

describe('sample documents', () => {
  beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}) })
  afterAll(() => { jest.restoreAllMocks() })

  it('are never exported for copying into an owner database', async () => {
    const session = await memoryStore.createWorkspace()
    await memoryStore.storeDocument(session.id, 'juniper-lane-returns.md', chunk('sample'), { sample: true })
    await memoryStore.storeDocument(session.id, 'services.md', chunk('real'))
    const exported = exportMemorySession(session.id).map((d) => d.filename)
    expect(exported).toEqual(['services.md'])
    // They still answer in the demo session itself.
    expect((await memoryStore.listDocuments(session.id)).map((d) => d.filename).sort()).toEqual(['juniper-lane-returns.md', 'services.md'])
  })

  it('replace by filename also works in a demo session', async () => {
    const session = await memoryStore.createWorkspace()
    await memoryStore.storeDocument(session.id, 'a.md', chunk('one'))
    const second = await memoryStore.storeDocument(session.id, 'a.md', chunk('two'), { replace: true })
    expect(second.replaced).toBe(1)
    expect(await memoryStore.listDocuments(session.id)).toHaveLength(1)
    expect(await memoryStore.deleteDocument(session.id, second.documentId)).toBe(true)
    expect(await memoryStore.listDocuments(session.id)).toHaveLength(0)
  })
})
