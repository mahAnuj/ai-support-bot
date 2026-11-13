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
  title,
}: {
  connected: boolean
  token: string | null
  requestHeaders: Record<string, string>
  switchTo: (token: string) => Promise<void>
  /** Told which workspace is open, so the page can load that bot's settings. */
  onProjectChange?: (id: string, isNew: boolean) => void
  /** Start a new bot from a blank builder; the open one stays in the list. */
  onNewBot?: () => void
  /** The open bot's display title and the workspace it belongs to: names a bot nobody named. */
  title?: { projectId: string | null; text: string } | null
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

  // A bot nobody named is named for you, so the list never fills with
  // "Unnamed bot". First choice: the title of its live assistant, from the
  // database (the most recently edited one), which is what Settings shows and
  // is the same in every browser. Otherwise, once there is no live assistant,
  // the builder's display title, but only when that title is known to belong
  // to the open workspace and typing has paused. Never over a chosen name.
  const [liveTitle, setLiveTitle] = useState<{ projectId: string; text: string | null } | null>(null)
  useEffect(() => {
    if (!current) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/storage/widgets', { headers: requestHeaders, cache: 'no-store' })
        const body = await res.json().catch(() => null)
        const list = res.ok && Array.isArray(body?.assistants) ? (body.assistants as { title?: unknown; updatedAt?: unknown }[]) : []
        const latest = list
          .filter((a) => typeof a.title === 'string' && a.title.trim())
          .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]
        if (!cancelled) setLiveTitle({ projectId: current.projectId, text: latest ? String(latest.title) : null })
      } catch {
        if (!cancelled) setLiveTitle({ projectId: current.projectId, text: null })
      }
    })()
    return () => { cancelled = true }
  }, [current, requestHeaders])

  const fromLive = liveTitle && current && liveTitle.projectId === current.projectId ? liveTitle.text : undefined
  const fromForm = fromLive === null && title && current && title.projectId === current.projectId ? title.text : ''
  const autoName = (fromLive || fromForm || '').replace(/\s+/g, ' ').trim().slice(0, 60)
  useEffect(() => {
    if (!current || !autoName) return
    // A live title is applied at once; a form title waits for typing to pause.
    const timer = window.setTimeout(() => {
      const bot = loadBotList().find((b) => b.key === current.key)
      if (!bot || bot.name) return
      setBots(rememberBot({ ...bot, name: autoName }))
      fetch('/api/storage/projects', {
        method: 'POST',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', id: current.projectId, name: autoName }),
      }).catch(() => { /* kept in this browser either way */ })
    }, fromLive ? 0 : 2000)
    return () => window.clearTimeout(timer)
  }, [current, autoName, fromLive, requestHeaders])

  // A message is about the bot it was written for; another bot clears it.
  useEffect(() => { setNote(null); setRenaming(false) }, [connected, current?.key])

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

  const draft = !connected
  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="text-base font-semibold text-ink">Your bots</h2>
          <p className="mt-0.5 max-w-[64ch] text-sm text-ink-muted">
            One bot per site, each with its own database and settings. Open one to change it or see how it is doing; embed code
            already on a site keeps working whichever bot is open here.
          </p>
        </div>
        {onNewBot && <button type="button" className={PRIMARY} disabled={busy} onClick={onNewBot}>+ New bot</button>}
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {draft && (
          <li className="flex min-w-0 flex-col justify-between gap-2 rounded-md border-2 border-dashed border-accent bg-accent-tint/40 p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                New bot <span className="ml-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">Editing</span>
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">Not saved yet. Connect its database in step 2 to keep it.</p>
            </div>
          </li>
        )}
        {bots.map((bot) => {
          const isOpen = connected && bot.key === current?.key
          return (
            <li
              key={bot.key}
              className={`flex min-w-0 flex-col justify-between gap-3 rounded-md border p-3 ${isOpen ? 'border-2 border-accent bg-accent-tint/40' : 'border-line bg-surface'}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                  {bot.name ?? 'Unnamed bot'}
                  {isOpen && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">Open</span>}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle [overflow-wrap:anywhere]">{bot.label}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {isOpen
                  ? <button type="button" className={BUTTON} disabled={busy} onClick={() => { setRenaming(!renaming); setName(bot.name ?? ''); setNote(null) }}>Rename</button>
                  : (
                    <>
                      <button type="button" className={BUTTON} disabled={busy} onClick={() => open(bot)} aria-label={`Open ${bot.name ?? bot.label}`}>Open</button>
                      <button type="button" className="inline-flex h-10 items-center rounded-md px-2 text-sm font-medium text-ink-muted hover:bg-sunken hover:text-ink disabled:opacity-60" disabled={busy} onClick={() => forget(bot)} aria-label={`Forget ${bot.name ?? bot.label}`}>Forget</button>
                    </>
                  )}
              </div>
            </li>
          )
        })}
      </ul>
      {renaming && (
        <form onSubmit={rename} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor={nameId} className="sr-only">Bot name</label>
          <input id={nameId} className={`${INPUT} sm:flex-1`} value={name} maxLength={60} autoFocus placeholder="e.g. shubhagya.com" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className={BUTTON} disabled={busy || !name.trim()}>Save name</button>
        </form>
      )}
      {note && <p role={note.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${note.ok ? 'text-ink' : 'text-danger'}`}>{note.text}</p>}
    </section>
  )
}
