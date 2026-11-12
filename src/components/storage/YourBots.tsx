'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import { forgetBot, loadBotList, rememberBot, type SavedBot } from '@/lib/bot-list'

// "Your bots": one bot per site, each with its own database and its own
// settings. Every database connected in this browser is remembered here, so
// any bot opens again without its connection string. The builder form is
// kept per bot (builder-settings, keyed by workspace), so opening one brings
// back its title and questions, and a new bot starts from the defaults.

const BUTTON = 'inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface px-3 text-sm font-semibold text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60'
const PRIMARY = 'inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60'
const INPUT = 'h-10 min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent'

type Current = { key: string; projectId: string }

export default function YourBots({
  connected,
  token,
  requestHeaders,
  switchTo,
  onProjectChange,
  onNewBot,
}: {
  connected: boolean
  token: string | null
  requestHeaders: Record<string, string>
  switchTo: (token: string) => Promise<void>
  /** Told which workspace is open, so the page can load that bot's settings. */
  onProjectChange?: (id: string, isNew: boolean) => void
  /** Leave this bot (it stays in the list) and show the connect form for another database. */
  onNewBot?: () => void
}): JSX.Element | null {
  const headingId = useId()
  const nameId = useId()
  const [bots, setBots] = useState<SavedBot[]>([])
  const [current, setCurrent] = useState<Current | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const announced = useRef<string | null>(null)

  useEffect(() => { setBots(loadBotList()) }, [connected])

  // Connected: learn which database and bot this is, and remember it.
  useEffect(() => {
    if (!connected || !token) { setCurrent(null); announced.current = null; return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/storage/projects', { headers: requestHeaders, cache: 'no-store' })
        const body = await res.json().catch(() => null)
        if (cancelled || !res.ok || !Array.isArray(body?.projects) || typeof body?.database?.key !== 'string') return
        const open = (body.projects as { id: string; name: string | null; current: boolean }[]).find((p) => p.current)
        if (!open) return
        const saved = loadBotList().find((b) => b.key === body.database.key)
        setBots(rememberBot({ key: body.database.key, label: String(body.database.label), name: open.name ?? saved?.name ?? null, token }))
        setCurrent({ key: body.database.key, projectId: open.id })
        if (announced.current !== open.id) {
          announced.current = open.id
          onProjectChange?.(open.id, false)
        }
      } catch {
        // Without it the list just doesn't show this bot yet; everything else works.
      }
    })()
    return () => { cancelled = true }
  }, [connected, token, requestHeaders, onProjectChange])

  if (!connected && bots.length === 0) return null

  const open = async (bot: SavedBot) => {
    if (busy) return
    setBusy(true)
    setNote(null)
    try {
      await switchTo(bot.token)
    } finally {
      setBusy(false)
    }
  }

  const forget = (bot: SavedBot) => {
    setBots(forgetBot({ key: bot.key }))
    setNote(null)
  }

  const rename = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const bot = bots.find((b) => b.key === current?.key)
    const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!bot || !current || !trimmed || busy) return
    setBusy(true)
    try {
      // Kept in this browser either way; saved in the database too when it has the names table.
      setBots(rememberBot({ ...bot, name: trimmed }))
      const res = await fetch('/api/storage/projects', {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', id: current.projectId, name: trimmed }),
      })
      setNote(res.ok
        ? { ok: true, text: 'Renamed.' }
        : { ok: true, text: 'Renamed in this browser. To keep the name in the database too, run the upgrade SQL (see the database guide).' })
      setRenaming(false)
    } catch {
      setNote({ ok: false, text: "Couldn't reach the server." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-4 rounded-md border border-line bg-sunken p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-sm font-semibold text-ink">Your bots</h4>
        {connected && onNewBot && <button type="button" className={PRIMARY} disabled={busy} onClick={onNewBot}>+ New bot</button>}
      </div>
      <p className="mt-1 text-xs text-ink-subtle">
        One bot per site, each with its own database and settings. Bots you connect in this browser are listed here; open
        one to change it. Embed code already on a site keeps working whichever bot is open.
      </p>
      {bots.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-surface">
          {bots.map((bot) => {
            const isOpen = connected && bot.key === current?.key
            return (
              <li key={bot.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">
                    {bot.name ?? 'Unnamed bot'}
                    {isOpen && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">Editing</span>}
                  </p>
                  <p className="text-xs text-ink-subtle [overflow-wrap:anywhere]">{bot.label}</p>
                </div>
                <div className="flex gap-2">
                  {isOpen
                    ? <button type="button" className={BUTTON} disabled={busy} onClick={() => { setRenaming(!renaming); setName(bot.name ?? ''); setNote(null) }}>Rename</button>
                    : (
                      <>
                        <button type="button" className={BUTTON} disabled={busy} onClick={() => open(bot)} aria-label={`Open ${bot.name ?? bot.label}`}>Open</button>
                        <button type="button" className={BUTTON} disabled={busy} onClick={() => forget(bot)} aria-label={`Forget ${bot.name ?? bot.label}`}>Forget</button>
                      </>
                    )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {renaming && (
        <form onSubmit={rename} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor={nameId} className="sr-only">Bot name</label>
          <input id={nameId} className={`${INPUT} sm:flex-1`} value={name} maxLength={60} autoFocus placeholder="e.g. shubhagya.com" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className={BUTTON} disabled={busy || !name.trim()}>Save name</button>
        </form>
      )}
      {!connected && <p className="mt-2 text-xs text-ink-subtle">Or connect a new bot&apos;s database below.</p>}
      {note && <p role={note.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${note.ok ? 'text-ink' : 'text-danger'}`}>{note.text}</p>}
    </section>
  )
}
