// Client-safe: the builder activity events the operator can be told about.
//
// What someone did in the builder, never what they typed: no document names,
// no questions, no answers, no connection details, no tokens. Off unless the
// deployment sets ACTIVITY_TELEGRAM_BOT_TOKEN and ACTIVITY_TELEGRAM_CHAT_ID.

export const ACTIVITY_EVENTS = [
  'visit',
  'samples',
  'upload',
  'question',
  'embed',
  'connect',
  'new_bot',
  'monitor',
] as const

export type ActivityEvent = (typeof ACTIVITY_EVENTS)[number]

// How each event reads in the notification, singular and plural.
export const ACTIVITY_LABELS: Record<ActivityEvent, [string, string]> = {
  visit: ['opened the builder', 'opened the builder'],
  samples: ['loaded the sample documents', 'loaded the sample documents'],
  upload: ['uploaded documents', 'uploaded documents'],
  question: ['asked a question in the preview', 'asked {n} questions in the preview'],
  embed: ['generated embed code', 'generated embed code {n} times'],
  connect: ['connected a database', 'connected {n} databases'],
  new_bot: ['started a new bot', 'started {n} new bots'],
  monitor: ['opened Monitor', 'opened Monitor'],
}

export const MAX_ACTIVITY_EVENTS = 60

/** "asked 3 questions in the preview": repeats of an event collapse into one step, in first-seen order. */
export function describeActivity(events: readonly ActivityEvent[]): string[] {
  const counts = new Map<ActivityEvent, number>()
  for (const e of events) counts.set(e, (counts.get(e) ?? 0) + 1)
  return [...counts].map(([e, n]) => {
    const [one, many] = ACTIVITY_LABELS[e]
    return n === 1 ? one : many.replace('{n}', String(n))
  })
}

export function isActivityEvent(value: unknown): value is ActivityEvent {
  return typeof value === 'string' && (ACTIVITY_EVENTS as readonly string[]).includes(value)
}
