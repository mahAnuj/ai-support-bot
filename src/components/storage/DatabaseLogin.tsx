'use client'

import { useEffect, useState, type JSX } from 'react'

const LINK = 'text-accent underline underline-offset-2'

// "Connected as <login>", and a warning when that login is an admin one:
// embed code and automation keys carry whatever login the builder is using.
export default function DatabaseLogin({ requestHeaders, onReconnect }: { requestHeaders: Record<string, string>; onReconnect: () => void }): JSX.Element | null {
  const [login, setLogin] = useState<{ user: string; admin: boolean } | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/storage/login', { headers: requestHeaders, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (live && b && typeof b.user === 'string') setLogin({ user: b.user, admin: b.admin === true }) })
      .catch(() => {})
    return () => { live = false }
  }, [requestHeaders])
  if (!login) return null
  if (!login.admin) {
    return (
      <p className="mt-1 max-w-[60ch] text-sm text-ink-muted">
        Connected as <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs text-ink">{login.user}</code>, a limited login.
        Embed code and automation keys made here use it.
      </p>
    )
  }
  return (
    <div role="alert" className="mt-3 max-w-[60ch] rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink">
      <p>
        <strong>Connected as <code className="font-mono text-xs">{login.user}</code>, an admin login.</strong> Embed code
        and automation keys made now would carry it. To limit them,{' '}
        <button type="button" onClick={onReconnect} className={`${LINK} font-medium`}>disconnect</button>, connect again with
        the same connection string and <em>Create a limited login for the assistant</em> ticked, then generate new embed code
        and keys. <a href="/docs/database#one-click" className={LINK}>How it works</a>
      </p>
    </div>
  )
}
