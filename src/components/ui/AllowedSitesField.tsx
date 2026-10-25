'use client'

import { useEffect, useId, useImperativeHandle, useRef, useState, type JSX, type KeyboardEvent, type Ref } from 'react'
import { MAX_ALLOWED_ORIGINS, normalizeOrigin, ORIGIN_ERROR_MESSAGES } from '../../lib/origins'

export interface AllowedSitesFieldProps {
  origins: string[]
  onChange: (origins: string[]) => void
  required: boolean
  describedById?: string
  ref?: Ref<AllowedSitesHandle>
}

export interface AllowedSitesHandle {
  // Adds a typed-but-not-added site before generating. Returns the list to use, or null when the
  // typed text is not a valid site (the inline error is shown and the input focused).
  commitPending(): string[] | null
}

const INPUT =
  'h-11 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-sm text-ink placeholder:text-ink-subtle focus:border-accent'
const SECONDARY_BUTTON =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 text-sm font-semibold text-ink hover:bg-sunken'
const ICON_BUTTON =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface hover:text-ink'

function CloseIcon() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export default function AllowedSitesField({ origins, onChange, required, describedById, ref }: AllowedSitesFieldProps): JSX.Element {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const removeRefs = useRef<(HTMLButtonElement | null)[]>([])
  // Index to focus once the parent has applied a removal; -1 means the input
  const pendingFocus = useRef<number | null>(null)

  const baseId = useId()
  const labelId = `${baseId}-label`
  const inputId = `${baseId}-input`
  const hintId = `${baseId}-hint`
  const errorId = `${baseId}-error`
  const countId = `${baseId}-count`
  const recommendId = `${baseId}-recommend`

  const showRecommendation = origins.length === 0 && !required

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    const next = target >= 0 ? removeRefs.current[target] : null
    if (next) next.focus()
    else inputRef.current?.focus()
  }, [origins])

  const tryAdd = (): string[] | null => {
    const result = normalizeOrigin(value)
    let problem: string | null = null
    if (!result.ok) problem = ORIGIN_ERROR_MESSAGES[result.code]
    else if (origins.includes(result.origin)) problem = ORIGIN_ERROR_MESSAGES.origin_duplicate
    else if (origins.length >= MAX_ALLOWED_ORIGINS) problem = ORIGIN_ERROR_MESSAGES.origin_too_many

    if (problem !== null || !result.ok) {
      setError(problem)
      setAnnouncement('')
      return null
    }
    const next = [...origins, result.origin]
    setError(null)
    setValue('')
    setAnnouncement(`Added ${result.origin}`)
    onChange(next)
    return next
  }

  const add = () => {
    tryAdd()
  }

  useImperativeHandle(ref, () => ({
    commitPending() {
      if (value.trim() === '') return origins
      const result = normalizeOrigin(value)
      if (result.ok && origins.includes(result.origin)) {
        setValue('')
        setError(null)
        return origins
      }
      const next = tryAdd()
      if (next === null) inputRef.current?.focus()
      return next
    },
  }))

  const remove = (index: number) => {
    const removed = origins[index]
    const next = origins.filter((_, i) => i !== index)
    pendingFocus.current = index < next.length ? index : -1
    setError(null)
    setAnnouncement(`Removed ${removed}`)
    onChange(next)
  }

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    add()
  }

  const describedBy = [hintId, countId, showRecommendation ? recommendId : null, error ? errorId : null, describedById ?? null]
    .filter(Boolean)
    .join(' ')

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label id={labelId} htmlFor={inputId} className="text-sm font-medium text-ink">
          Allowed sites{required ? '' : ' (optional)'}
        </label>
        <span id={countId} className="text-xs text-ink-subtle">
          {origins.length} of {MAX_ALLOWED_ORIGINS}
        </span>
      </div>
      <p id={hintId} className="mt-1 max-w-[60ch] text-xs text-ink-subtle">
        Only pages on these sites can use the widget. Enter each site with no path, like https://example.com. With and
        without www, http and https, and different ports each count as a separate site.
      </p>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={inputId}
          name="allowed-site"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={onInputKey}
          placeholder="https://example.com"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`min-w-0 ${INPUT}`}
        />
        <button type="button" onClick={add} className={SECONDARY_BUTTON}>
          Add site
        </button>
      </div>
      <p id={errorId} aria-live="polite" className={error ? 'mt-1.5 text-sm text-danger [overflow-wrap:anywhere]' : 'sr-only'}>
        {error ?? ''}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {origins.length > 0 && (
        <ul aria-labelledby={labelId} className="mt-3 flex flex-col gap-2">
          {origins.map((origin, index) => (
            <li key={origin} className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-sunken py-0.5 pl-3 pr-0.5">
              <span className="min-w-0 flex-1 font-mono text-sm text-ink [overflow-wrap:anywhere]">{origin}</span>
              <button
                ref={(el) => {
                  removeRefs.current[index] = el
                }}
                type="button"
                aria-label={`Remove ${origin}`}
                onClick={() => remove(index)}
                className={ICON_BUTTON}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      {showRecommendation && (
        <p id={recommendId} className="mt-2 max-w-[60ch] text-sm text-ink-muted">
          Recommended: without a list, anyone who copies your tag can run this widget on their site.
        </p>
      )}
    </div>
  )
}
