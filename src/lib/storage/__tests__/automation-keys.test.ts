/** @jest-environment node */
import { randomBytes, randomUUID } from 'node:crypto'
import { normalizeKeyLabel } from '../api-keys'
import { STORAGE_TOKEN_HEADER } from '../errors'
import { resolveDocumentAccess } from '../resolve'
import {
  AUTOMATION_KEY_PREFIX,
  isAutomationKeyShape,
  openAutomationKey,
  openBuilderToken,
  sealAutomationKey,
  sealBuilderToken,
} from '../token'

const CONN = 'postgresql://user:pw@db.example.com:5432/app?sslmode=verify-full'
const key = randomBytes(32)
const payload = { conn: CONN, workspaceId: randomUUID(), keyId: randomUUID() }

describe('automation key token', () => {
  it('round-trips and has its own prefix', () => {
    const t = sealAutomationKey(payload, key)
    expect(t.startsWith(AUTOMATION_KEY_PREFIX)).toBe(true)
    expect(isAutomationKeyShape(t)).toBe(true)
    expect(openAutomationKey(t, key)).toEqual(payload)
  })

  it('does not open with another key, when tampered, or as a builder token', () => {
    const t = sealAutomationKey(payload, key)
    expect(openAutomationKey(t, randomBytes(32))).toBeNull()
    expect(openAutomationKey(t.slice(0, -2) + (t.endsWith('A') ? 'BB' : 'AA'), key)).toBeNull()
    // Relabelled as a builder token, the AAD no longer matches.
    expect(openBuilderToken('sbb1_' + t.slice(AUTOMATION_KEY_PREFIX.length), key)).toBeNull()
    // And a builder token is not a key.
    const b = sealBuilderToken({ conn: CONN, workspaceId: payload.workspaceId }, key)
    expect(openAutomationKey(AUTOMATION_KEY_PREFIX + b.slice(5), key)).toBeNull()
  })

  it('normalises labels', () => {
    expect(normalizeKeyLabel('  GitHub   sync ')).toBe('GitHub sync')
    expect(normalizeKeyLabel('')).toBe('Automation key')
    expect(normalizeKeyLabel(42)).toBe('Automation key')
    expect(normalizeKeyLabel('x'.repeat(200))).toHaveLength(80)
  })
})

describe('resolveDocumentAccess (no database needed)', () => {
  const savedEnv = process.env
  const KEY = randomBytes(32).toString('base64')
  beforeEach(() => { process.env = { ...savedEnv, EMBED_TOKEN_KEY: KEY, NODE_ENV: 'test' } })
  afterAll(() => { process.env = savedEnv })

  const req = (headers: Record<string, string>) => new Request('http://localhost/api/storage/documents', { headers })

  it('without Authorization behaves like the builder path (demo memory)', async () => {
    const r = await resolveDocumentAccess(req({}))
    expect(r.ok && r.ctx.kind).toBe('memory')
  })

  it('refuses a builder token sent as a bearer key', async () => {
    const builder = sealBuilderToken({ conn: CONN, workspaceId: randomUUID() })
    const r = await resolveDocumentAccess(req({ authorization: `Bearer ${builder}` }))
    expect(!r.ok && r.error.code).toBe('invalid_key')
  })

  it('refuses a forged or garbage key', async () => {
    for (const bad of ['sbk1_not-a-token', 'Basic abc', `Bearer ${AUTOMATION_KEY_PREFIX}AAAA`]) {
      const r = await resolveDocumentAccess(req({ authorization: bad.startsWith('Bearer') ? bad : `Bearer ${bad}` }))
      expect(r.ok).toBe(false)
    }
  })

  it('refuses a key sent together with a builder token', async () => {
    const k = sealAutomationKey(payload)
    const r = await resolveDocumentAccess(req({ authorization: `Bearer ${k}`, [STORAGE_TOKEN_HEADER]: 'sbb1_x' }))
    expect(!r.ok && r.error.code).toBe('token_wrong_purpose')
  })

  it('is unavailable when the server has no token key', async () => {
    delete process.env.EMBED_TOKEN_KEY
    const r = await resolveDocumentAccess(req({ authorization: 'Bearer sbk1_x' }))
    expect(!r.ok && r.error.code).toBe('storage_unavailable')
  })
})
