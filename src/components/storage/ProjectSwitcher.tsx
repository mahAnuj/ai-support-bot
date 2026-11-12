'use client'

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'

// Projects: one per site, each with its own documents, assistants, keys,
// conversation log and stats, all in the connected database. Switching swaps
// this browser's builder link for that project's; the rest of the panel
// follows because everything reads the link.

type Project = { id: string; name: string | null; documents: number; assistants: number; createdAt: string; current: boolean }

const INPUT = 'h-11 min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent'
const BUTTON = 'inline-flex h-11 shrink-0 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60'

function label(p: Project): string {
  const name = p.name ?? `Unnamed project (${new Date(p.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })})`
  return `${name} · ${p.documents} ${p.documents === 1 ? 'document' : 'documents'} · ${p.assistants} ${p.assistants === 1 ? 'assistant' : 'assistants'}`
}

export default function ProjectSwitcher({
  requestHeaders,
  switchTo,
  onProjectChange,
  documentCount = 0,
}: {
  requestHeaders: Record<string, string>
  switchTo: (token: string) => Promise<void>
  onProjectChange?: (id: string, isNew: boolean) => void
  // The open project's document count, so the list's counts follow uploads and removals.
  documentCount?: number
}): JSX.Element | null {
  const selectId = useId()
  const nameId = useId()
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [mode, setMode] = useState<'idle' | 'new' | 'rename'>('idle')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  // Tells the page which project is open, once per project.
  const announced = useRef<string | null>(null)
  const pendingNew = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/storage/projects', { headers: requestHeaders, cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(body?.projects)) return
      setProjects(body.projects)
      const current = (body.projects as Project[]).find((p) => p.current)
      if (current && announced.current !== current.id) {
        announced.current = current.id
        onProjectChange?.(current.id, pendingNew.current === current.id)
        pendingNew.current = null
      }
    } catch {
      // Without the list the panel simply has no switcher; the project still works.
    }
  }, [requestHeaders, onProjectChange])

  useEffect(() => { void load() }, [load, documentCount])

  if (!projects) return null
  const current = projects.find((p) => p.current)

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/storage/projects', {
      method: 'POST',
      headers: { ...requestHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { res, body: await res.json().catch(() => null) }
  }

  const open = async (id: string) => {
    if (busy || id === current?.id) return
    setBusy(true)
    setNote(null)
    try {
      const { res, body } = await post({ action: 'switch', id })
      if (!res.ok || typeof body?.token !== 'string') { setNote({ ok: false, text: body?.error ?? `Couldn't open it (status ${res.status}).` }); return }
      await switchTo(body.token)
    } catch {
      setNote({ ok: false, text: "Couldn't reach the server." })
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy || !name.trim()) return
    setBusy(true)
    setNote(null)
    try {
      if (mode === 'new') {
        const { res, body } = await post({ action: 'create', name })
        if (!res.ok || typeof body?.token !== 'string') { setNote({ ok: false, text: body?.error ?? `Couldn't create it (status ${res.status}).` }); return }
        pendingNew.current = body.id
        await switchTo(body.token)
        setNote({ ok: true, text: body.warning ?? `Created “${name.trim()}”. Add its documents above, then generate its embed code below.` })
      } else if (mode === 'rename' && current) {
        const { res, body } = await post({ action: 'rename', id: current.id, name })
        if (!res.ok) { setNote({ ok: false, text: body?.error ?? `Couldn't rename it (status ${res.status}).` }); return }
        await load()
        setNote({ ok: true, text: 'Renamed.' })
      }
      setMode('idle')
      setName('')
    } catch {
      setNote({ ok: false, text: "Couldn't reach the server." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 rounded-md border border-line bg-sunken p-3">
      <label htmlFor={selectId} className="text-sm font-medium text-ink">Project</label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <select id={selectId} className={`${INPUT} sm:flex-1`} value={current?.id ?? ''} disabled={busy} onChange={(e) => open(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{label(p)}</option>)}
        </select>
        <div className="flex gap-2">
          <button type="button" className={BUTTON} disabled={busy} onClick={() => { setMode(mode === 'new' ? 'idle' : 'new'); setName(''); setNote(null) }}>New project</button>
          <button type="button" className={BUTTON} disabled={busy || !current} onClick={() => { setMode(mode === 'rename' ? 'idle' : 'rename'); setName(current?.name ?? ''); setNote(null) }}>Rename</button>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-ink-subtle">
        One project per site: each has its own documents, assistants, automation keys, log and stats. Switching changes
        everything below to that project; embed code already on a site keeps working.
      </p>
      {mode !== 'idle' && (
        <form onSubmit={submit} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor={nameId} className="sr-only">{mode === 'new' ? 'New project name' : 'Project name'}</label>
          <input id={nameId} className={`${INPUT} sm:flex-1`} value={name} maxLength={60} autoFocus placeholder="e.g. shubhagya.com" onChange={(e) => setName(e.target.value)} />
          <button type="submit" className={BUTTON} disabled={busy || !name.trim()}>{mode === 'new' ? 'Create project' : 'Save name'}</button>
        </form>
      )}
      {note && <p role={note.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${note.ok ? 'text-ink' : 'text-danger'}`}>{note.text}</p>}
    </div>
  )
}
