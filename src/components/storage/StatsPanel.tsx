'use client'

import { useCallback, useEffect, useId, useState, type JSX } from 'react'

// Daily counts for the owner: how many questions, how many were answered from
// the documents, "don't know" answers, failures, and the retrieval match score.
// Numbers only, kept in the owner's database (src/lib/storage/daily-stats.ts).

type Day = {
  day: string; questions: number; matched: number; noMatch: number; dontKnow: number; failures: number
  meanScore: number | null; minScore: number | null; lowScore: number
}
type Report = {
  available: boolean; enabled: boolean; days: Day[]; totals: Omit<Day, 'day'>; lowMatch: number
  sharedModel?: { limit: number | null; usedToday: number | null }
}

// Validated for this chart (chroma, lightness band, contrast on the white surface);
// the brand accent #136150 reads as gray at bar size.
const BAR = '#11845f'
const RANGES = [7, 30, 90]

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–'
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border border-line px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-xl font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="text-xs text-ink-subtle">{sub}</p>}
    </div>
  )
}

export default function StatsPanel({ requestHeaders }: { requestHeaders: Record<string, string> }): JSX.Element | null {
  const headingId = useId()
  const [range, setRange] = useState(30)
  const [report, setReport] = useState<Report | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async (days: number) => {
    try {
      const res = await fetch(`/api/storage/stats?days=${days}`, { headers: requestHeaders, cache: 'no-store' })
      const body = await res.json().catch(() => null)
      if (res.ok && body && typeof body.available === 'boolean') setReport(body)
    } catch {
      // The panel stays hidden.
    }
  }, [requestHeaders])

  useEffect(() => { void load(range) }, [load, range])

  if (!report) return null

  const toggle = async (enabled: boolean) => {
    setNote(null)
    const before = report
    setReport({ ...report, enabled })
    const res = await fetch('/api/storage/stats', { method: 'PUT', headers: { ...requestHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })
    const body = await res.json().catch(() => null)
    if (!res.ok) { setReport(before); setNote(body?.error ?? `Couldn't save (status ${res.status}).`); return }
    await load(range)
  }

  const t = report.totals
  const answered = t.questions - t.failures
  const max = Math.max(1, ...report.days.map((d) => d.questions))
  const shown = hover !== null ? report.days[hover] : null

  return (
    <section aria-labelledby={headingId} className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 id={headingId} className="text-sm font-semibold text-ink">Questions and answers</h4>
        <label className="flex items-center gap-2 text-sm text-ink">
          Last
          <select className="h-9 rounded-md border border-line-strong bg-surface px-2 text-sm" value={range} onChange={(e) => setRange(Number(e.target.value))}>
            {RANGES.map((r) => <option key={r} value={r}>{r} days</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1 max-w-[60ch] text-sm text-ink-muted">
        Daily counts from your widget, kept in your database. Numbers only: no question text, so this stays on even with the
        conversation log off.
      </p>
      {report.sharedModel?.limit != null && (
        <p className="mt-2 max-w-[60ch] rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink">
          <span className="font-semibold">Shared demo model:</span>{' '}
          {report.sharedModel.usedToday != null
            ? `${report.sharedModel.usedToday} of ${report.sharedModel.limit} questions used today (UTC). `
            : `up to ${report.sharedModel.limit} questions a day. `}
          After that, visitors are asked to come back tomorrow. Assistants on your own model have no limit: connect one under{' '}
          <em>Use your own model</em> and choose it in <em>Your assistants</em>.
        </p>
      )}

      {!report.available ? (
        <p role="alert" className="mt-3 max-w-[60ch] rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink">
          Counting needs one more table. Run <code className="font-mono text-xs">scripts/support-bot-schema.sql</code> and{' '}
          <code className="font-mono text-xs">scripts/support-bot-role.sql</code> as an admin, or connect once with your admin login
          and one-click setup.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Questions" value={String(t.questions)} />
            <Tile label="Answered from documents" value={pct(t.matched, answered)} sub={`${t.matched} of ${answered}`} />
            <Tile label="“Don’t know” answers" value={String(t.dontKnow)} sub={`about ${pct(t.dontKnow, answered)}`} />
            <Tile label="Failures" value={String(t.failures)} sub={pct(t.failures, t.questions)} />
            <Tile label="Mean match score" value={t.meanScore === null ? '–' : String(t.meanScore)} sub="0–100, answers from documents" />
            <Tile label="Lowest match score" value={t.minScore === null ? '–' : String(t.minScore)} />
            <Tile label={`Low-match answers (below ${report.lowMatch})`} value={String(t.lowScore)} sub={pct(t.lowScore, t.matched)} />
            <Tile label="No matching documents" value={String(t.noMatch)} sub={pct(t.noMatch, answered)} />
          </div>

          <figure className="mt-4">
            <figcaption className="text-xs font-medium text-ink-muted">Questions per day</figcaption>
            {/* A reserved line, not an overlay, so the details never cover the bars. */}
            <p role="status" className="mt-1 min-h-8 text-xs tabular-nums text-ink">
              {shown ? (
                <>
                  <span className="font-semibold">{shortDay(shown.day)}</span>
                  {` · ${n(shown.questions, 'question', 'questions')} · ${shown.matched} from documents · ${shown.dontKnow} don't know · ${n(shown.failures, 'failure', 'failures')}`}
                  <span className="block text-ink-muted">{`Match score: mean ${shown.meanScore ?? '–'}, lowest ${shown.minScore ?? '–'}`}</span>
                </>
              ) : (
                <span className="text-ink-subtle">Point at or tab to a bar for that day.</span>
              )}
            </p>
            <div className="relative mt-2" onMouseLeave={() => setHover(null)}>
              <div className="flex h-28 items-end gap-[2px] border-b border-line" role="list" aria-label="Questions per day">
                {report.days.map((d, i) => (
                  <button
                    key={d.day}
                    type="button"
                    role="listitem"
                    aria-label={`${shortDay(d.day)}: ${d.questions} questions, ${d.matched} from documents, ${d.dontKnow} don't know, ${d.failures} failures`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="flex h-full min-w-0 flex-1 items-end justify-center focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span
                      className="block w-full max-w-6 rounded-t"
                      style={{ height: d.questions ? `${Math.max(4, (d.questions / max) * 100)}%` : '0', background: BAR, opacity: hover === null || hover === i ? 1 : 0.45 }}
                    />
                  </button>
                ))}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-ink-subtle tabular-nums">
                <span>{report.days[0] ? shortDay(report.days[0].day) : ''}</span>
                <span>max {max}/day</span>
                <span>{report.days.length ? shortDay(report.days[report.days.length - 1].day) : ''}</span>
              </div>
            </div>
          </figure>

          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-ink-muted">Show as a table</summary>
            <div className="mt-2 max-h-72 overflow-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="text-ink-muted">
                  <tr><th className="py-1 pr-2">Day</th><th className="pr-2">Questions</th><th className="pr-2">From documents</th><th className="pr-2">Don&apos;t know</th><th className="pr-2">Failures</th><th className="pr-2">Mean match</th><th>Lowest</th></tr>
                </thead>
                <tbody className="text-ink">
                  {[...report.days].reverse().filter((d) => d.questions > 0).map((d) => (
                    <tr key={d.day} className="border-t border-line">
                      <td className="py-1 pr-2">{d.day}</td><td className="pr-2">{d.questions}</td><td className="pr-2">{d.matched}</td><td className="pr-2">{d.dontKnow}</td><td className="pr-2">{d.failures}</td><td className="pr-2">{d.meanScore ?? '–'}</td><td>{d.minScore ?? '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="mt-3 max-w-[60ch] text-xs text-ink-subtle">
            The match score is how closely the best passage in your documents matched the question (0–100), not a measure of
            whether the answer is right; low scores are where weak answers come from. &ldquo;Don&apos;t know&rdquo; is counted
            from the assistant&apos;s wording, so it can miss a reworded refusal. A failure while your database is unreachable
            cannot be counted in it. Days are in UTC.
          </p>
          <label className="mt-2 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" className="h-4 w-4 accent-accent" checked={report.enabled} onChange={(e) => toggle(e.target.checked)} />
            Count questions (numbers only)
          </label>
          {note && <p role="alert" className="mt-2 text-sm text-danger">{note}</p>}
        </>
      )}
    </section>
  )
}
