'use client'

import { useCallback, useEffect, useId, useState, type FormEvent, type JSX } from 'react'

// Automation keys for the connected database: create (shown once), list and
// revoke. A key lets a script or CI job upload, list and remove documents in
// this workspace and nothing else; see "Automation keys" in the README.

type KeySummary = { id: string; label: string; createdAt: string; lastUsedAt: string | null; revoked: boolean }

const INPUT =
  'h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus:border-accent'
const BUTTON =
  'inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60'

function when(iso: string | null): string {
  if (!iso) return 'never used'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function AutomationKeys({ requestHeaders }: { requestHeaders: Record<string, string> }): JSX.Element {
  const headingId = useId()
  const labelId = useId()
  const [keys, setKeys] = useState<KeySummary[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/storage/keys', { headers: requestHeaders })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.code === 'insufficient_privilege'
          ? "Your database login can't create the keys table. Run scripts/support-bot-schema.sql and scripts/support-bot-role.sql again as an admin, then reload."
          : (body?.error ?? `Couldn't load keys (status ${res.status}).`))
        return
      }
      setKeys(Array.isArray(body?.keys) ? body.keys : [])
    } catch {
      setError("Couldn't reach the server.")
    }
  }, [requestHeaders])

  useEffect(() => { void load() }, [load])

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setNewKey(null)
    setCopied(false)
    try {
      const res = await fetch('/api/storage/keys', {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || typeof body?.key !== 'string') {
        setError(body?.error ?? `Couldn't create a key (status ${res.status}).`)
        return
      }
      setNewKey(body.key)
      setLabel('')
      await load()
    } catch {
      setError("Couldn't reach the server.")
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (k: KeySummary) => {
    if (!window.confirm(`Revoke "${k.label}"? Anything using it stops working immediately.`)) return
    setError(null)
    try {
      const res = await fetch(`/api/storage/keys?id=${encodeURIComponent(k.id)}`, { method: 'DELETE', headers: requestHeaders })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? `Couldn't revoke (status ${res.status}).`)
      }
      await load()
    } catch {
      setError("Couldn't reach the server.")
    }
  }

  const copy = async () => {
    if (!newKey) return
    try { await navigator.clipboard.writeText(newKey); setCopied(true) } catch { /* the key stays visible to copy by hand */ }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <section aria-labelledby={headingId} className="mt-6 border-t border-line pt-5">
      <h4 id={headingId} className="text-sm font-semibold text-ink">Automation keys</h4>
      <p className="mt-1 max-w-[60ch] text-sm text-ink-muted">
        For keeping documents in sync from a script or CI job, such as a GitHub Action on every deploy. A key can upload,
        list and remove documents here, and nothing else. Uploading a file with an existing name replaces it.
      </p>

      <form onSubmit={create} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor={labelId} className="sr-only">Key label</label>
        <input id={labelId} value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} placeholder="Label, e.g. GitHub sync" className={INPUT} />
        <button type="submit" disabled={busy} className={BUTTON}>{busy ? 'Creating…' : 'Create key'}</button>
      </form>

      {newKey && (
        <div role="status" className="mt-3 rounded-md border border-line bg-sunken p-3 text-sm text-ink">
          <p className="font-semibold">Copy this key now. It will not be shown again.</p>
          <code className="mt-2 block max-h-24 overflow-auto break-all rounded bg-surface p-2 font-mono text-xs">{newKey}</code>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={copy} className={BUTTON}>{copied ? 'Copied' : 'Copy key'}</button>
            <span className="text-xs text-ink-muted">Store it as a secret (for example a GitHub Actions secret), never in a page or a public repo.</span>
          </div>
          <p className="mt-3 text-xs text-ink-muted">Upload with it:</p>
          <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 font-mono text-xs">{`curl -H "Authorization: Bearer $SUPPORT_BOT_KEY" \\
  -F files=@services.md ${origin}/api/upload`}</pre>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-ink">{error}</p>}

      {keys && keys.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {keys.map((k) => (
            <li key={k.id} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
              <span className="min-w-0">
                <span className={`block truncate text-sm ${k.revoked ? 'text-ink-muted line-through' : 'text-ink'}`}>{k.label}</span>
                <span className="block text-xs text-ink-muted">
                  {k.revoked ? 'Revoked' : `Created ${when(k.createdAt)} · ${k.lastUsedAt ? `last used ${when(k.lastUsedAt)}` : 'never used'}`}
                </span>
              </span>
              {!k.revoked && (
                <button type="button" onClick={() => revoke(k)} aria-label={`Revoke ${k.label}`} className="min-h-9 shrink-0 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-sunken hover:text-ink">
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
