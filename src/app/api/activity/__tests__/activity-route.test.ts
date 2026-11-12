/** @jest-environment node */
import { NextRequest } from 'next/server'
import { POST } from '../route'
import { describeActivity } from '@/lib/activity-shared'

// Builder activity pings: opt-in, event names only, one message edited in place.
describe('POST /api/activity', () => {
  const env = { ...process.env }
  let calls: { url: string; body: Record<string, unknown> }[]
  let ip = 0

  beforeEach(() => {
    calls = []
    ip += 1
    process.env.ACTIVITY_TELEGRAM_BOT_TOKEN = 'test-token'
    process.env.ACTIVITY_TELEGRAM_CHAT_ID = '42'
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 })
    }) as typeof fetch
  })
  afterEach(() => { process.env = { ...env } })

  function req(body: unknown, headers: Record<string, string> = {}) {
    return new NextRequest('https://bot.example/api/activity', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        host: 'bot.example',
        origin: 'https://bot.example',
        'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/130',
        'x-real-ip': `10.0.0.${ip}`,
        'x-vercel-ip-city': 'Bengaluru',
        'x-vercel-ip-country': 'IN',
        ...headers,
      },
    })
  }

  it('sends one message describing what was tried, and only event names', async () => {
    const res = await POST(req({
      events: ['visit', 'samples', 'question', 'question', 'question', 'embed', 'connect', 'secret-doc.pdf'],
      referrer: 'https://news.ycombinator.com/item?id=1',
      elapsed: 252,
    }))
    expect(await res.json()).toEqual({ ok: true, messageId: 7 })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.telegram.org/bottest-token/sendMessage')
    const text = String(calls[0].body.text)
    expect(text).toContain('🧪 <b>Support bot builder</b> · bot.example')
    expect(text).toContain('<b>From:</b> news.ycombinator.com · Bengaluru, IN')
    expect(text).toContain('opened the builder → loaded the sample documents → asked 3 questions in the preview → generated embed code → connected a database')
    expect(text).toContain('4m 12s · desktop')
    expect(text).not.toContain('secret-doc')
    expect(text).not.toContain('10.0.0.')
  })

  it('edits the session message after the first send', async () => {
    await POST(req({ events: ['visit', 'upload'], messageId: 7 }))
    expect(calls[0].url).toContain('/editMessageText')
    expect(calls[0].body.message_id).toBe(7)
  })

  it('does nothing when the deployment has not opted in, or for bots, other sites and non-visits', async () => {
    delete process.env.ACTIVITY_TELEGRAM_BOT_TOKEN
    await POST(req({ events: ['visit'] }))
    process.env.ACTIVITY_TELEGRAM_BOT_TOKEN = 'test-token'
    await POST(req({ events: ['visit'] }, { 'user-agent': 'Googlebot/2.1' }))
    await POST(req({ events: ['visit'] }, { origin: 'https://evil.example' }))
    await POST(req({ events: ['question'] }))
    await POST(req('not json'))
    expect(calls).toHaveLength(0)
  })

  it('collapses repeats in first-seen order', () => {
    expect(describeActivity(['visit', 'question', 'monitor', 'question'])).toEqual([
      'opened the builder', 'asked 2 questions in the preview', 'opened Monitor',
    ])
  })
})
