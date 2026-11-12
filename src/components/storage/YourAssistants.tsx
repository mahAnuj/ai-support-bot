'use client'

import { useCallback, useEffect, useId, useState, type FormEvent, type JSX } from 'react'
import { MODEL_TOKEN_HEADER } from '../../lib/model/shared'

// "Your assistants": every assistant stored in the connected database, edited
// in place. A save is live on the owner's site from the next page load, with
// the same embed code: the widget reads these settings on every request.

type Assistant = {
  id: string
  title: string
  welcomeMessage: string
  primaryColor: string
  position: 'bottom-right' | 'bottom-left'
  size: 'small' | 'medium' | 'large'
  instructions: string
  createdAt: string
  updatedAt: string
  starterQuestions: string[] | null
  allowedOrigins: string[] | null
  model: 'embed' | 'demo' | 'owner'
}

type Draft = {
  title: string
  welcomeMessage: string
  primaryColor: string
  position: Assistant['position']
  size: Assistant['size']
  instructions: string
  starters: string[]
  sites: string
  // Allowed sites left as sealed in the embed code until the owner edits them.
  sitesFromEmbed: boolean
  // No questions saved here yet: the fields were pre-filled from the builder setup.
  startersPrefilled: boolean
  model: 'keep' | 'demo' | 'builder'
}

const INPUT = 'h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-subtle focus:border-accent'
const AREA = 'block w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:border-accent'
const LABEL = 'text-sm font-medium text-ink'
const HELP = 'mt-1 text-xs text-ink-subtle'
const BUTTON = 'inline-flex h-11 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60'
const PRIMARY = 'inline-flex h-11 items-center justify-center rounded-md bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60'

function day(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function toDraft(a: Assistant, builderStarters: readonly string[]): Draft {
  // Until questions are saved here, the site shows the ones in its script tag.
  // The builder's own questions are the best guess at those, so start from them.
  const prefilled = a.starterQuestions === null
  const starters = [...(prefilled ? builderStarters : (a.starterQuestions ?? []))].slice(0, 4)
  while (starters.length < 4) starters.push('')
  return {
    title: a.title,
    welcomeMessage: a.welcomeMessage,
    primaryColor: a.primaryColor,
    position: a.position,
    size: a.size,
    instructions: a.instructions,
    starters,
    sites: (a.allowedOrigins ?? []).join('\n'),
    sitesFromEmbed: a.allowedOrigins === null,
    startersPrefilled: prefilled,
    model: 'keep',
  }
}

const MODEL_LABEL: Record<Assistant['model'], string> = {
  embed: 'As set when the embed code was made',
  demo: 'Shared demo model',
  owner: 'Your own model',
}

export default function YourAssistants({
  requestHeaders,
  ownModel,
  builderStarters = [],
}: {
  requestHeaders: Record<string, string>
  ownModel: { token: string; model: string; host: string } | null
  // The suggested questions set in the builder's Set up step.
  builderStarters?: readonly string[]
}): JSX.Element | null {
  const headingId = useId()
  const [assistants, setAssistants] = useState<Assistant[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // The assistant whose save just finished: its form closes and its row says so.
  const [savedId, setSavedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/storage/widgets', { headers: requestHeaders, cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (res.ok && Array.isArray(body?.assistants)) {
        setAssistants(body.assistants)
        setAvailable(body.settingsAvailable !== false)
      }
    } catch {
      // The panel stays hidden; the rest of the builder still works.
    }
  }, [requestHeaders])

  useEffect(() => { void load() }, [load])

  if (!assistants || assistants.length === 0) return null

  const start = (a: Assistant) => {
    setEditing(a.id)
    setDraft(toDraft(a, builderStarters))
    setMessage(null)
    setSavedId(null)
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d))

  const save = async (e: FormEvent<HTMLFormElement>, a: Assistant) => {
    e.preventDefault()
    if (!draft || busy) return
    setBusy(true)
    setMessage(null)
    const sites = draft.sites.split(/\s+/).map((s) => s.trim()).filter(Boolean)
    try {
      const res = await fetch(`/api/storage/widgets?id=${encodeURIComponent(a.id)}`, {
        method: 'PATCH',
        headers: {
          ...requestHeaders,
          'Content-Type': 'application/json',
          ...(draft.model === 'builder' && ownModel ? { [MODEL_TOKEN_HEADER]: ownModel.token } : {}),
        },
        body: JSON.stringify({
          title: draft.title,
          welcomeMessage: draft.welcomeMessage,
          primaryColor: draft.primaryColor,
          position: draft.position,
          size: draft.size,
          instructions: draft.instructions,
          starterQuestions: draft.starters.map((s) => s.trim()).filter(Boolean),
          allowedOrigins: draft.sitesFromEmbed ? null : sites,
          model: draft.model,
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.assistant) {
        setMessage({ ok: false, text: body?.error ?? `Couldn't save (status ${res.status}).` })
        return
      }
      setAssistants((list) => (list ?? []).map((x) => (x.id === a.id ? body.assistant : x)))
      setEditing(null)
      setDraft(null)
      setMessage(null)
      setSavedId(a.id)
    } catch {
      setMessage({ ok: false, text: "Couldn't reach the server." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={headingId} className="mt-6 border-t border-line pt-5">
      <h4 id={headingId} className="text-sm font-semibold text-ink">Your assistants</h4>
      <p className="mt-1 max-w-[60ch] text-sm text-ink-muted">
        Change an assistant that is already on your site. Saving updates it in place: the embed code stays the same, and
        visitors see the change on their next page load. Documents are shared by every assistant here; add or remove them
        above.
      </p>
      {!available && (
        <p role="alert" className="mt-3 max-w-[60ch] rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink">
          Suggested questions, allowed sites and the model can be saved here once the settings table exists. Run{' '}
          <code className="font-mono text-xs">scripts/support-bot-schema.sql</code> and{' '}
          <code className="font-mono text-xs">scripts/support-bot-role.sql</code> as an admin, or connect once with your admin login
          and one-click setup.
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {assistants.map((a) => (
          <li key={a.id} className="rounded-md border border-line px-3 py-2">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-line" style={{ background: a.primaryColor }} />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{a.title}</span>
                  {savedId === a.id && (
                    <span role="status" className="mt-0.5 flex items-center gap-1 text-xs font-medium text-accent">
                      <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      Saved. Live on your site from the next page load, with the same embed code.
                    </span>
                  )}
                  <span className="block text-xs text-ink-muted">
                    {`Created ${day(a.createdAt)}`}{a.updatedAt !== a.createdAt ? ` · edited ${day(a.updatedAt)}` : ''}
                  </span>
                </span>
              </span>
              {editing !== a.id && (
                <button type="button" onClick={() => start(a)} aria-label={`Edit ${a.title}`} className="min-h-9 shrink-0 rounded-md px-2 text-xs font-medium text-accent hover:bg-sunken">
                  Edit
                </button>
              )}
            </div>

            {editing === a.id && draft && (
              <form onSubmit={(e) => save(e, a)} className="mt-3 flex flex-col gap-4 border-t border-line pt-3">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL}>Title</span>
                    <input className={INPUT} value={draft.title} maxLength={80} onChange={(e) => set('title', e.target.value)} />
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL}>Brand colour</span>
                    <span className="flex gap-2">
                      <input type="color" aria-label="Pick a colour" className="h-11 w-12 shrink-0 rounded-md border border-line-strong bg-surface" value={/^#[0-9a-f]{6}$/i.test(draft.primaryColor) ? draft.primaryColor : '#000000'} onChange={(e) => set('primaryColor', e.target.value)} />
                      <input className={`${INPUT} font-mono`} value={draft.primaryColor} maxLength={7} onChange={(e) => set('primaryColor', e.target.value)} />
                    </span>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL}>Position</span>
                    <select className={INPUT} value={draft.position} onChange={(e) => set('position', e.target.value as Draft['position'])}>
                      <option value="bottom-right">Bottom right</option>
                      <option value="bottom-left">Bottom left</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1.5">
                    <span className={LABEL}>Size</span>
                    <select className={INPUT} value={draft.size} onChange={(e) => set('size', e.target.value as Draft['size'])}>
                      <option value="small">Small (300×400)</option>
                      <option value="medium">Medium (350×500)</option>
                      <option value="large">Large (400×600)</option>
                    </select>
                  </label>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className={LABEL}>Welcome message</span>
                  <textarea className={AREA} rows={2} maxLength={500} value={draft.welcomeMessage} onChange={(e) => set('welcomeMessage', e.target.value)} />
                </label>

                <fieldset className="flex flex-col gap-2">
                  <legend className={LABEL}>Suggested questions</legend>
                  {draft.starters.map((q, i) => (
                    <input key={i} aria-label={`Suggested question ${i + 1}`} className={INPUT} value={q} maxLength={120} onChange={(e) => set('starters', draft.starters.map((x, j) => (j === i ? e.target.value : x)))} />
                  ))}
                  <p className={HELP}>
                    {draft.startersPrefilled
                      ? builderStarters.length
                        ? 'Not saved here yet, so your site shows the questions written in its script tag. These are the questions from your builder setup; save to manage them here from now on.'
                        : 'Not saved here yet, so your site shows any questions written in its script tag. Add them here to manage them from the builder.'
                      : 'Saved here, these replace any questions written in the script tag on your site.'}
                  </p>
                </fieldset>

                <label className="flex flex-col gap-1.5">
                  <span className={LABEL}>Instructions</span>
                  <textarea
                    className={AREA}
                    rows={4}
                    maxLength={4000}
                    value={draft.instructions}
                    placeholder="e.g. You are the assistant on Anuj's website, not Anuj himself: call him Anuj or he. Never quote prices."
                    onChange={(e) => set('instructions', e.target.value)}
                  />
                  <span className={HELP}>
                    How the assistant should talk and what to avoid. Instructions cannot make it state facts your documents don&apos;t
                    contain: that rule always comes last.
                  </span>
                </label>

                <fieldset className="flex flex-col gap-1.5">
                  <legend className={LABEL}>Allowed sites</legend>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" className="h-4 w-4 accent-accent" checked={draft.sitesFromEmbed} onChange={(e) => set('sitesFromEmbed', e.target.checked)} />
                    Keep the sites set when the embed code was made
                  </label>
                  {!draft.sitesFromEmbed && (
                    <>
                      <textarea className={`${AREA} font-mono`} rows={3} value={draft.sites} placeholder={'https://example.com\nhttps://www.example.com'} onChange={(e) => set('sites', e.target.value)} />
                      <span className={HELP}>One site per line, with https://. Leave empty to allow any site (not possible with your own model).</span>
                    </>
                  )}
                </fieldset>

                <fieldset className="flex flex-col gap-1.5">
                  <legend className={LABEL}>Model</legend>
                  <p className={HELP}>Now: {MODEL_LABEL[a.model]}.</p>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="radio" name={`model-${a.id}`} checked={draft.model === 'keep'} onChange={() => set('model', 'keep')} /> Keep it
                  </label>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input type="radio" name={`model-${a.id}`} checked={draft.model === 'demo'} onChange={() => set('model', 'demo')} /> Shared demo model
                  </label>
                  <label className={`flex items-center gap-2 text-sm ${ownModel ? 'text-ink' : 'text-ink-subtle'}`}>
                    <input type="radio" name={`model-${a.id}`} disabled={!ownModel} checked={draft.model === 'builder'} onChange={() => set('model', 'builder')} />
                    {ownModel ? `Your model: ${ownModel.model} at ${ownModel.host}` : 'Your own model (add it under "Use your own model" first)'}
                  </label>
                </fieldset>

                {message && (
                  <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-ink' : 'text-danger'}`}>{message.text}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={busy} className={PRIMARY}>{busy ? 'Saving…' : 'Save changes'}</button>
                  <button type="button" onClick={() => { setEditing(null); setDraft(null); setMessage(null) }} className={BUTTON}>Close</button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
