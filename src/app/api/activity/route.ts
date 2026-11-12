import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '@/lib/guard'
import { describeActivity, isActivityEvent, MAX_ACTIVITY_EVENTS, type ActivityEvent } from '@/lib/activity-shared'

// One Telegram message per builder session, edited in place as the visitor
// tries things: the operator's way to see that someone visited and how far
// they got. Opt-in per deployment (ACTIVITY_TELEGRAM_BOT_TOKEN and
// ACTIVITY_TELEGRAM_CHAT_ID); without both it does nothing.
//
// It receives only event names from a fixed list, a referrer and an elapsed
// time. City and country come from Vercel's headers; the IP address is used
// for the rate limit only and is never stored, logged or sent.

export const dynamic = 'force-dynamic'

const BOT = /bot|crawl|spider|slurp|bingpreview|headless|lighthouse|preview|monitor|curl|wget|python-requests|axios|node-fetch/i
const TELEGRAM_TIMEOUT_MS = 5000
const OK = () => NextResponse.json({ ok: true })

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function formatElapsed(seconds: number): string {
  if (seconds < 5) return ''
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

async function telegram(method: 'sendMessage' | 'editMessageText', payload: Record<string, unknown>): Promise<number | null> {
  const token = process.env.ACTIVITY_TELEGRAM_BOT_TOKEN
  const chatId = process.env.ACTIVITY_TELEGRAM_CHAT_ID
  if (!token || !chatId) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true, ...payload }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => null)) as { result?: { message_id?: unknown } } | null
    const id = body?.result?.message_id
    return typeof id === 'number' ? id : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.ACTIVITY_TELEGRAM_BOT_TOKEN || !process.env.ACTIVITY_TELEGRAM_CHAT_ID) return OK()
  if (isRateLimited(`activity:${clientIp(request)}`, 30)) return OK()

  // Only the builder itself reports: a page elsewhere sends another Origin.
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (origin && host && new URL(origin).host !== host) return OK()

  const ua = request.headers.get('user-agent') ?? ''
  if (!ua || BOT.test(ua)) return OK()

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object') return OK()
    body = parsed as Record<string, unknown>
  } catch {
    return OK()
  }

  const events = Array.isArray(body.events) ? body.events.filter(isActivityEvent).slice(0, MAX_ACTIVITY_EVENTS) : []
  if (!events.includes('visit')) return OK()
  const messageId = typeof body.messageId === 'number' && Number.isInteger(body.messageId) && body.messageId > 0 ? body.messageId : undefined
  const elapsed = typeof body.elapsed === 'number' && Number.isFinite(body.elapsed) ? Math.min(86_400, Math.max(0, Math.round(body.elapsed))) : 0
  const rawReferrer = typeof body.referrer === 'string' ? body.referrer.trim().slice(0, 300) : ''
  let referrer = 'direct'
  try {
    if (rawReferrer && new URL(rawReferrer).host !== host) referrer = new URL(rawReferrer).host
  } catch {
    referrer = 'direct'
  }

  const country = request.headers.get('x-vercel-ip-country') ?? ''
  let city = ''
  try { city = decodeURIComponent(request.headers.get('x-vercel-ip-city') ?? '') } catch { city = '' }
  const where = [city, country].filter(Boolean).join(', ')

  const steps = describeActivity(events as ActivityEvent[])
  const tried = steps.length > 1
  const text = [
    `${tried ? '🧪' : '👀'} <b>Support bot builder</b>${host ? ` · ${escapeHtml(host)}` : ''}`,
    `<b>From:</b> ${escapeHtml(referrer)}${where ? ` · ${escapeHtml(where)}` : ''}`,
    `<b>Did:</b> ${steps.map(escapeHtml).join(' → ')}`,
    [formatElapsed(elapsed), ua.includes('Mobile') ? 'mobile' : 'desktop'].filter(Boolean).join(' · '),
  ].join('\n')

  // Awaited: a serverless instance can be frozen as soon as the response returns.
  let id: number | null = null
  if (messageId) id = await telegram('editMessageText', { message_id: messageId, text })
  // An edit fails when the message is over 48 hours old or unchanged; send afresh.
  if (id === null) id = await telegram('sendMessage', { text })
  return NextResponse.json({ ok: true, messageId: id ?? messageId })
}
