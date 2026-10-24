'use client'

import { useEffect, useId, useRef, useState, type JSX } from 'react'
import DataDisclosure from './DataDisclosure'

export const DEFAULT_PRIMARY_COLOR = '#1E6B58'

export type WidgetConfig = {
  name: string
  title: string
  welcome_message: string
  primary_color: string
  position: 'bottom-right' | 'bottom-left'
  size: 'small' | 'medium' | 'large'
}

export function toSafeHex(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_PRIMARY_COLOR
}

export interface EmbedStepProps {
  sessionId: string | null
  documentCount: number
  config: WidgetConfig
}

const SIZES: Record<WidgetConfig['size'], { width: number; height: number }> = {
  small: { width: 300, height: 400 },
  medium: { width: 350, height: 500 },
  large: { width: 400, height: 600 },
}

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again."

const primaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60'
const secondaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 text-sm font-semibold text-ink hover:bg-sunken'
const iconButton =
  'inline-flex size-11 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink'

function ChatIcon({ size }: { size: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="motion-safe:animate-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0 text-danger">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16h.01" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export default function EmbedStep({ sessionId, documentCount, config }: EmbedStepProps): JSX.Element {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [embedCode, setEmbedCode] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')

  const generateRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (isOpen && dialog && !dialog.open) dialog.showModal()
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  if (documentCount === 0) {
    return <p className="text-sm text-ink-muted">Upload at least one document in step 2 to generate embed code.</p>
  }

  const primary = toSafeHex(config.primary_color)
  const dimensions = SIZES[config.size] ?? SIZES.medium
  const isLeft = config.position === 'bottom-left'

  const generate = async () => {
    if (isGenerating) return
    setError(null)
    setIsGenerating(true)
    try {
      const response = await fetch('/api/widget/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          name: config.name || config.title || 'Support Widget',
          title: config.title || config.name || 'AI Support Assistant',
          welcome_message: config.welcome_message || 'Hi! How can I help you today?',
          primary_color: toSafeHex(config.primary_color),
          position: config.position || 'bottom-right',
          size: config.size || 'medium'
        }),
      })
      const body = await response.json().catch(() => null)
      const status = response.status

      if (status === 429) {
        setError('Too many requests from this network in the last minute. Wait a minute and try again.')
      } else if (status === 400) {
        setError(`Couldn't generate embed code: ${body?.error ?? 'invalid request'}.`)
      } else if (!response.ok || typeof body?.embedCode !== 'string') {
        setError(`Couldn't generate embed code (status ${status}). Sessions are lost when the server restarts, so upload your documents again and retry.`)
      } else {
        setEmbedCode(body.embedCode)
        setCopyStatus('')
        setIsOpen(true)
      }
    } catch {
      setError(NETWORK_ERROR)
    } finally {
      setIsGenerating(false)
    }
  }

  const closeDialog = () => {
    dialogRef.current?.close()
  }

  const handleDialogClose = () => {
    setIsOpen(false)
    generateRef.current?.focus()
  }

  const copyCode = async () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    try {
      await navigator.clipboard.writeText(embedCode)
      setCopyStatus('Copied')
      copyTimerRef.current = setTimeout(() => setCopyStatus(''), 2000)
    } catch {
      setCopyStatus("Couldn't copy. Select the code and copy it manually.")
    }
  }

  const launcher = (
    <span
      aria-hidden="true"
      className="flex size-14 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
      style={{ backgroundColor: primary }}
    >
      <ChatIcon size={24} />
    </span>
  )

  return (
    <div className="rounded-lg border border-line bg-surface p-4 sm:p-6">
      <div>
        <h3 className="text-base font-semibold text-ink">
          Widget preview
        </h3>
        <div className={`mt-3 flex items-end gap-3 rounded-lg bg-sunken p-4 ${isLeft ? 'justify-start' : 'justify-end'}`}>
          {isLeft && launcher}
          <div className="min-w-0 max-w-60 flex-1 overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            <div className="flex items-center gap-2 px-3 py-2.5 text-white" style={{ backgroundColor: primary }}>
              <ChatIcon size={16} />
              <span className="min-w-0 truncate text-sm font-semibold">{config.title || config.name || 'AI Support Assistant'}</span>
            </div>
            <div className="p-3">
              <p className="max-w-[85%] rounded-xl rounded-bl-sm border border-line bg-sunken px-3 py-2 text-xs text-ink break-words">
                {config.welcome_message || 'Hi! How can I help you today?'}
              </p>
            </div>
          </div>
          {!isLeft && launcher}
        </div>
        <p className="mt-1.5 text-xs text-ink-subtle">
          Position: {isLeft ? 'bottom left' : 'bottom right'}. Size: {config.size in SIZES ? config.size : 'medium'}, {dimensions.width} × {dimensions.height} px.
        </p>
      </div>

      <div className="mt-6">
        <button
          ref={generateRef}
          type="button"
          onClick={generate}
          disabled={isGenerating}
          aria-busy={isGenerating}
          className={primaryButton}
        >
          {isGenerating ? (
            <>
              <Spinner />
              Generating
            </>
          ) : (
            'Generate embed code'
          )}
        </button>
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink">
          <AlertIcon />
          <p>{error}</p>
        </div>
      )}

      <DataDisclosure className="mt-6" />

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={handleDialogClose}
        className="m-auto w-[min(42rem,calc(100vw-2rem))] max-h-[calc(100dvh-2rem)] rounded-lg bg-surface p-0 text-ink shadow-lg backdrop:bg-ink/60"
      >
        <div className="flex flex-col gap-4 p-4 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-xl font-semibold text-ink">
              Embed code
            </h2>
            <button type="button" aria-label="Close" onClick={closeDialog} className={iconButton}>
              <CloseIcon />
            </button>
          </div>
          <p id={descriptionId} className="max-w-[60ch] text-sm text-ink-muted">
            Paste this into your site's HTML, just before the closing body tag. Widgets are kept in server memory, so this code stops working if the server restarts; generate it again after a restart.
          </p>
          <pre
            tabIndex={0}
            aria-label="Embed code"
            className="max-h-[50vh] overflow-auto whitespace-pre rounded-md bg-code-bg p-4 font-mono text-sm text-code-ink"
          >
            {embedCode}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={copyCode} className={primaryButton}>
              Copy code
            </button>
            <span role="status" aria-live="polite" className="text-sm text-ink-muted">
              {copyStatus}
            </span>
            <button type="button" onClick={closeDialog} className={`${secondaryButton} ml-auto`}>
              Close
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
