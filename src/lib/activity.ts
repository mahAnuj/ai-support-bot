'use client'

// Builder activity, reported as one Telegram message per session that is
// edited as the visitor goes (src/app/api/activity/route.ts). Only event names
// from ACTIVITY_EVENTS are sent: never what was typed or uploaded.
//
// Nothing is sent until the visitor has stayed 4 seconds on a visible tab,
// automation that announces itself (navigator.webdriver) is skipped, and
// events before that are queued and sent with the visit. To stop reporting
// your own sessions: localStorage.setItem('activity-optout', '1'), or open the
// builder once with ?nopings=1.

import { MAX_ACTIVITY_EVENTS, type ActivityEvent } from './activity-shared'

const EVENTS_KEY = 'activity-events'
const MSG_KEY = 'activity-message-id'
const START_KEY = 'activity-started'
const OPTOUT_KEY = 'activity-optout'
const DWELL_MS = 4000
const BATCH_MS = 1500

let qualified = false
let timer: number | undefined
let sending = false
let pending = false

const read = (k: string): string | null => { try { return sessionStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { sessionStorage.setItem(k, v) } catch { /* private mode */ } }

function optedOut(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('nopings')) localStorage.setItem(OPTOUT_KEY, '1')
    return !!localStorage.getItem(OPTOUT_KEY)
  } catch {
    return false
  }
}

function events(): ActivityEvent[] {
  try { return JSON.parse(read(EVENTS_KEY) ?? '[]') as ActivityEvent[] } catch { return [] }
}

async function flush() {
  if (!qualified || document.visibilityState !== 'visible') return
  if (sending) { pending = true; return }
  sending = true
  try {
    const started = Number(read(START_KEY) ?? Date.now())
    const res = await fetch('/api/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: events(),
        messageId: Number(read(MSG_KEY) ?? 0) || undefined,
        referrer: document.referrer || undefined,
        elapsed: Math.round((Date.now() - started) / 1000),
      }),
      keepalive: true,
    })
    const body = (await res.json().catch(() => null)) as { messageId?: number } | null
    if (body?.messageId) write(MSG_KEY, String(body.messageId))
  } catch {
    // A failed report never affects the builder.
  } finally {
    sending = false
    if (pending) { pending = false; schedule() }
  }
}

function schedule() {
  if (timer) window.clearTimeout(timer)
  timer = window.setTimeout(flush, BATCH_MS)
}

/** Record that the visitor did something; sent with the session's next update. */
export function trackActivity(event: ActivityEvent): void {
  if (typeof window === 'undefined' || navigator.webdriver || optedOut()) return
  const list = [...events(), event].slice(-MAX_ACTIVITY_EVENTS)
  write(EVENTS_KEY, JSON.stringify(list))
  if (qualified) schedule()
}

/** Called once on load: counts the visit after the dwell, then reports. */
export function startActivity(): () => void {
  if (typeof window === 'undefined' || navigator.webdriver || optedOut()) return () => {}
  if (!read(START_KEY)) write(START_KEY, String(Date.now()))
  if (!events().includes('visit')) write(EVENTS_KEY, JSON.stringify(['visit', ...events()]))
  // A session that already reported (a reload) has stayed before: no new dwell.
  const already = !!read(MSG_KEY)
  let dwell: number | undefined
  const begin = () => {
    if (document.visibilityState !== 'visible' || qualified) return
    dwell = window.setTimeout(() => { qualified = true; void flush() }, already ? 0 : DWELL_MS)
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden' && !qualified && dwell) window.clearTimeout(dwell)
    else begin()
  }
  begin()
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    if (dwell) window.clearTimeout(dwell)
  }
}
