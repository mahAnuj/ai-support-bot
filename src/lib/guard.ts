import type { NextRequest } from 'next/server'
import { exactOriginAllowed, type OriginPolicy } from './origins'

// Every chat request spends the deployment's Groq quota, and the chat routes
// are reachable from any site. These checks bound what one client can spend.
//
// Counts live in memory, like the rest of this app: each server instance keeps
// its own, and a restart resets them. That stops one client hammering an
// instance. It is not a global quota - see GOVERNANCE.md.

const windows = new Map<string, { start: number; count: number }>()

export const LIMITS = {
  message: 2000,
  systemPrompt: 4000,
  roleContext: 2000,
}

export function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    'unknown'
  )
}

/** Fixed-window limiter. Returns true when this call is over the limit. */
export function isRateLimited(key: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now()

  if (windows.size > 10_000) {
    for (const [k, w] of Array.from(windows.entries())) {
      if (now - w.start >= windowMs) windows.delete(k)
    }
  }

  const current = windows.get(key)
  if (!current || now - current.start >= windowMs) {
    windows.set(key, { start: now, count: 1 })
    return false
  }
  current.count++
  return current.count > limit
}

/** Optional strings from a request body: absent is fine, wrong type or too long is not. */
export function isWithinLimit(value: unknown, max: number): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= max)
}

/**
 * A widget with allowed_domains only answers pages on those domains (or their
 * subdomains). An empty list means any site, which is the default.
 * The Origin header is set by the browser, so this stops other websites from
 * embedding a widget; it does not stop a script that forges the header.
 */
export function originAllowed(origin: string | null, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true
  if (!origin) return false

  let hostname: string
  try {
    hostname = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }

  return allowedDomains.some((entry) => {
    const domain = entry.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[/:].*$/, '')
    return domain.length > 0 && (hostname === domain || hostname.endsWith(`.${domain}`))
  })
}

/** Whether a widget's access policy lets a page with this Origin use it. */
export function widgetOriginAllowed(policy: OriginPolicy, origin: string | null): boolean {
  switch (policy.kind) {
    case 'any':
      return true
    case 'legacy':
      return originAllowed(origin, policy.domains)
    case 'exact':
      return exactOriginAllowed(policy.origins, origin)
  }
}

/**
 * CORS headers for widget chat responses. A widget with an exact list echoes
 * the request origin only when it is allowed, never `*`; other widgets keep `*`.
 */
export function widgetCorsHeaders(policy: OriginPolicy, origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
  if (policy.kind === 'exact') {
    headers['Vary'] = 'Origin'
    if (origin && exactOriginAllowed(policy.origins, origin)) {
      headers['Access-Control-Allow-Origin'] = origin
    }
  } else {
    headers['Access-Control-Allow-Origin'] = '*'
  }
  return headers
}
