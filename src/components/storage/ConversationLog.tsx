'use client'

import { useCallback, useEffect, useId, useState, type JSX } from 'react'

// The conversation log, kept in the owner's own database: what visitors asked
// and what the assistant answered, to check the answers. Off by default.
// While it is on, the widget tells visitors their questions are saved.

type Turn = { id: string; chatId: string | null; question: string; answer: string; matched: boolean; matchScore: number | null; sources: string[]; at: string }

const LOW_MATCH = 40
type Settings = { enabled: boolean; retentionDays: number; available: boolean }

const PRESETS = [30, 90, 180, 365]
const BUTTON = 'inline-flex h-11 items-center justify-center rounded-md border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60'
const INPUT = 'h-11 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent'

function when(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ConversationLog({ requestHeaders }: { requestHeaders: Record<string, string> }): JSX.Element | null {
  const headingId = useId()
  const toggleId = useId()
  const daysId = useId()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [days, setDays] = useState('90')
  const [turns, setTurns] = useState<Turn[]>([])
  const [more, setMore] = useState(false)
  const [unmatchedOnly, setUnmatchedOnly] = useState(false)
  const [lowOnly, setLowOnly] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  const loadTurns = useCallback(async (before: string | null, onlyUnmatched: boolean, onlyLow = false) => {
    const q = new URLSearchParams()
    if (onlyUnmatched) q.set('unmatched', '1')
    if (onlyLow) q.set('low', '1')
    if (before) q.set('before', before)
    const res = await fetch(`/api/storage/conversations?${q}`, { headers: requestHeaders, cache: 'no-store' })
    const body = await res.json().catch(() => null)
    const page: Turn[] = res.ok && Array.isArray(body?.turns) ? body.turns : []
    setTurns((prev) => (before ? [...prev, ...page] : page))
    setMore(page.length === 50)
  }, [requestHeaders])

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const res = await fetch('/api/storage/conversations/settings', { headers: requestHeaders, cache: 'no-store' })
        const body = await res.json().catch(() => null)
        if (!live || !res.ok || typeof body?.enabled !== 'boolean') return
        setSettings(body)
        setDays(String(body.retentionDays))
        await loadTurns(null, false)
      } catch {
        // The panel stays hidden; nothing else depends on it.
      }
    })()
    return () => { live = false }
  }, [requestHeaders, loadTurns])

  if (!settings) return null

  const save = async (enabled: boolean) => {
    // Flip at once; put it back if the save fails.
    const before = settings
    setSettings({ ...settings, enabled })
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/storage/conversations/settings', {
        method: 'PUT',
        headers: { ...requestHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, retentionDays: Number(days) }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setSettings(before)
        setNote({ ok: false, text: body?.error ?? `Couldn't save (status ${res.status}).` })
        return
      }
      setSettings(body)
      setDays(String(body.retentionDays))
      setNote({
        ok: true,
        text: body.enabled
          ? `Saved. Questions are logged from now on and kept for ${body.retentionDays} days. Visitors see a notice under the chat box.`
          : 'Saved. Logging is off; entries already kept stay until they expire or you delete them.',
      })
      await loadTurns(null, unmatchedOnly, lowOnly)
    } catch {
      setSettings(before)
      setNote({ ok: false, text: "Couldn't reach the server." })
    } finally {
      setBusy(false)
    }
  }

  const download = async () => {
    const q = new URLSearchParams({ format: 'csv' })
    if (unmatchedOnly) q.set('unmatched', '1')
    if (lowOnly) q.set('low', '1')
    const res = await fetch(`/api/storage/conversations?${q}`, { headers: requestHeaders, cache: 'no-store' })
    if (!res.ok) { setNote({ ok: false, text: `Couldn't download (status ${res.status}).` }); return }
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url
    a.download = `conversations-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const removeAll = async () => {
    if (!window.confirm('Delete every logged question and answer? This cannot be undone.')) return
    const res = await fetch('/api/storage/conversations', { method: 'DELETE', headers: requestHeaders })
    const body = await res.json().catch(() => null)
    setNote(res.ok ? { ok: true, text: `Deleted ${body?.deleted ?? 0} entries.` } : { ok: false, text: body?.error ?? `Couldn't delete (status ${res.status}).` })
    await loadTurns(null, unmatchedOnly, lowOnly)
  }

  const filter = async (on: boolean) => {
    setUnmatchedOnly(on)
    if (on) setLowOnly(false)
    await loadTurns(null, on, false)
  }

  const filterLow = async (on: boolean) => {
    setLowOnly(on)
    if (on) setUnmatchedOnly(false)
    await loadTurns(null, false, on)
  }

  return (
    <section aria-labelledby={headingId} className="mt-6 border-t border-line pt-5">
      <h4 id={headingId} className="text-sm font-semibold text-ink">Conversation log</h4>
      <p className="mt-1 max-w-[60ch] text-sm text-ink-muted">
        Keep what visitors ask and what the assistant answers, to check the answers and see what your documents are missing.
        Saved in your database only, never on this server. No IP address, browser details or cookies are kept.
      </p>

      {!settings.available ? (
        <p role="alert" className="mt-3 max-w-[60ch] rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink">
          The log needs two more tables. Run <code className="font-mono text-xs">scripts/support-bot-schema.sql</code> and{' '}
          <code className="font-mono text-xs">scripts/support-bot-role.sql</code> as an admin, or connect once with your admin login
          and one-click setup.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label htmlFor={toggleId} className="flex items-center gap-2 text-sm font-medium text-ink">
              <input id={toggleId} type="checkbox" className="h-4 w-4 accent-accent" checked={settings.enabled} disabled={busy} onChange={(e) => save(e.target.checked)} />
              Keep a log of questions and answers
            </label>
            <span className="flex items-center gap-2 text-sm text-ink">
              <label htmlFor={daysId}>Keep for</label>
              <input id={daysId} type="number" min={1} max={730} list={`${daysId}-presets`} className={`${INPUT} w-24`} value={days} onChange={(e) => setDays(e.target.value)} />
              <datalist id={`${daysId}-presets`}>{PRESETS.map((d) => <option key={d} value={d} />)}</datalist>
              days
              <button type="button" className={BUTTON} disabled={busy || String(settings.retentionDays) === days} onClick={() => save(settings.enabled)}>Save</button>
            </span>
          </div>
          <p className="mt-1.5 max-w-[60ch] text-xs text-ink-subtle">
            1 to 730 days; older entries are deleted automatically. While the log is on, visitors see &ldquo;Questions and
            answers are saved to improve this assistant.&rdquo; under the chat box, and only questions sent with that notice
            showing are kept. Questions you ask in the preview here are never logged.
          </p>
          {note && <p role={note.ok ? 'status' : 'alert'} className={`mt-2 text-sm ${note.ok ? 'text-ink' : 'text-danger'}`}>{note.text}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={unmatchedOnly} onChange={(e) => filter(e.target.checked)} />
              Only questions with no matching documents
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-accent" checked={lowOnly} onChange={(e) => filterLow(e.target.checked)} />
              {`Only low-match answers (score below ${LOW_MATCH})`}
            </label>
            <button type="button" className={BUTTON} onClick={download} disabled={turns.length === 0}>Download CSV</button>
            <button type="button" className="min-h-9 rounded-md px-2 text-xs font-medium text-ink-muted hover:bg-sunken hover:text-ink" onClick={removeAll} disabled={turns.length === 0}>
              Delete all
            </button>
          </div>

          {turns.length === 0 ? (
            <p className="mt-3 text-sm text-ink-muted">{settings.enabled ? 'Nothing logged yet.' : 'The log is off.'}</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {turns.map((t) => (
                <li key={t.id} className="rounded-md border border-line px-3 py-2">
                  <details>
                    <summary className="cursor-pointer list-none">
                      <span className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{t.question}</span>
                      <span className="mt-0.5 block text-xs text-ink-muted">
                        {when(t.at)}{t.matched ? (t.matchScore !== null ? ` · match ${t.matchScore}${t.matchScore < LOW_MATCH ? ' (low)' : ''}` : '') : ' · no matching documents'}
                      </span>
                    </summary>
                    <div className="mt-2 border-t border-line pt-2 text-sm text-ink-muted">
                      <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{t.answer}</p>
                      {t.sources.length > 0 && <p className="mt-1.5 text-xs">From: {t.sources.join(', ')}</p>}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {more && (
            <button type="button" className={`${BUTTON} mt-3`} onClick={() => loadTurns(turns[turns.length - 1]?.at ?? null, unmatchedOnly, lowOnly)}>Show older</button>
          )}
        </>
      )}
    </section>
  )
}
