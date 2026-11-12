/** @jest-environment node */
import { DEFAULT_DAYS, looksLikeDontKnow, normalizeDays } from '../daily-stats'

describe('daily stats helpers', () => {
  it('recognises the "don\'t know" phrasing the visitor rule asks for', () => {
    expect(looksLikeDontKnow("I don't have that information. Please contact Anuj directly.")).toBe(true)
    expect(looksLikeDontKnow('I don’t have a specific price listed for an AI system review.')).toBe(true)
    expect(looksLikeDontKnow("I'm not able to confirm availability.")).toBe(true)
    expect(looksLikeDontKnow('Pricing is fixed per deliverable.')).toBe(false)
    expect(looksLikeDontKnow('We have that information on the services page.')).toBe(false)
  })

  it('keeps the range between 7 and 365 days, 30 by default', () => {
    expect(normalizeDays('90')).toBe(90)
    expect(normalizeDays(1)).toBe(7)
    expect(normalizeDays(10_000)).toBe(365)
    expect(normalizeDays(undefined)).toBe(DEFAULT_DAYS)
    expect(normalizeDays('abc')).toBe(DEFAULT_DAYS)
  })
})
