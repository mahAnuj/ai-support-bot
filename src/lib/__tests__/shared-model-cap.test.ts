/** @jest-environment node */
import { DEFAULT_SHARED_MODEL_DAILY_LIMIT, claimSharedModelQuestion, limitFor, parseSiteLimits, resetSharedModelMemory, sharedModelDailyLimit } from '../shared-model-cap'

const env = (v?: string) => ({ SHARED_MODEL_DAILY_LIMIT: v }) as unknown as NodeJS.ProcessEnv

describe('shared model daily cap', () => {
  beforeEach(() => resetSharedModelMemory())

  it('reads the limit, with a default, an off switch and junk falling back', () => {
    expect(sharedModelDailyLimit(env())).toBe(DEFAULT_SHARED_MODEL_DAILY_LIMIT)
    expect(sharedModelDailyLimit(env('50'))).toBe(50)
    expect(sharedModelDailyLimit(env('0'))).toBeNull()
    expect(sharedModelDailyLimit(env('OFF'))).toBeNull()
    expect(sharedModelDailyLimit(env('-3'))).toBe(DEFAULT_SHARED_MODEL_DAILY_LIMIT)
    expect(sharedModelDailyLimit(env('2.5'))).toBe(DEFAULT_SHARED_MODEL_DAILY_LIMIT)
  })

  it('allows the cap per bot per UTC day, then refuses, without affecting other bots', async () => {
    const day = new Date('2026-11-12T10:00:00Z')
    const results = []
    for (let i = 0; i < 4; i++) results.push((await claimSharedModelQuestion({ id: 'a' }, day, env('3'))).allowed)
    expect(results).toEqual([true, true, true, false])
    expect(await claimSharedModelQuestion({ id: 'a' }, day, env('3'))).toEqual({ allowed: false, cap: 3 })
    expect((await claimSharedModelQuestion({ id: 'b' }, day, env('3'))).allowed).toBe(true)
    // A new UTC day starts again.
    expect((await claimSharedModelQuestion({ id: 'a' }, new Date('2026-11-13T00:00:01Z'), env('3'))).allowed).toBe(true)
  })

  it('never refuses with the cap off', async () => {
    for (let i = 0; i < 300; i++) expect((await claimSharedModelQuestion({ id: 'a' }, new Date(), env('off'))).allowed).toBe(true)
  })

  it('parses per-site limits, skipping bad entries', () => {
    const m = parseSiteLimits('anujmahajan.com=off, https://Shubhagya.com/=1000\nwww.x.com=25, bad, y.com=-1, =5, z.com=')
    expect([...m.entries()]).toEqual([['anujmahajan.com', null], ['shubhagya.com', 1000], ['www.x.com', 25]])
  })

  it('uses a verified site\'s own limit, else the default', () => {
    const e = { SHARED_MODEL_DAILY_LIMIT: '200', SHARED_MODEL_SITE_LIMITS: 'a.com=off, b.com=50' } as unknown as NodeJS.ProcessEnv
    expect(limitFor('https://a.com', e)).toBeNull()
    expect(limitFor('https://b.com', e)).toBe(50)
    expect(limitFor('https://www.b.com', e)).toBe(200) // exact hostname only
    expect(limitFor('https://c.com', e)).toBe(200)
    expect(limitFor(null, e)).toBe(200)
    expect(limitFor('not a url', e)).toBe(200)
  })
})
