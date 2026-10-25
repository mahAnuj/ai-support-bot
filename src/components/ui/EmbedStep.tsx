'use client'

import { useEffect, useId, useRef, useState, type JSX } from 'react'
import AllowedSitesField, { type AllowedSitesHandle } from './AllowedSitesField'
import InstallGuide from './InstallGuide'
import { readableTextOn } from './contrast'
import { STORAGE_ERROR_CODES, storageErrorMessage } from '../../lib/storage/errors'
import { ORIGINS_REQUIRED_MESSAGE } from '../../lib/origins'
import { MODEL_TOKEN_HEADER, isModelErrorCode, modelErrorMessage } from '../../lib/model/shared'

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
  onGenerated?: () => void
  // Called when the connected workspace no longer exists, so the stale link can be cleared
  onWorkspaceMissing?: () => void
  storageToken?: string | null
  modelAttached?: boolean
  modelToken?: string | null
  ownModel?: { model: string; host: string } | null
}

const SIZES: Record<WidgetConfig['size'], { width: number; height: number }> = {
  small: { width: 300, height: 400 },
  medium: { width: 350, height: 500 },
  large: { width: 400, height: 600 },
}

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again."

const primaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60'
const iconButton =
  'inline-flex size-10 items-center justify-center rounded-md text-ink-muted hover:bg-sunken hover:text-ink'

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

function CheckIcon() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
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

export default function EmbedStep({ sessionId, documentCount, config, onGenerated, onWorkspaceMissing, storageToken, modelAttached = false, modelToken, ownModel = null }: EmbedStepProps): JSX.Element {
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [embedCode, setEmbedCode] = useState('')
  const [scriptUrl, setScriptUrl] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [origins, setOrigins] = useState<string[]>([])
  // The guide describes the embed that was generated, not the list as edited since
  const [generatedWithSites, setGeneratedWithSites] = useState(false)
  const [generatedModel, setGeneratedModel] = useState<{ model: string; host: string } | null>(null)

  const generateRef = useRef<HTMLButtonElement>(null)
  const sitesRef = useRef<AllowedSitesHandle>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const copyRef = useRef<HTMLButtonElement>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const titleId = useId()
  const descriptionId = useId()
  const requiredId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (isOpen && dialog && !dialog.open) {
      dialog.showModal()
      copyRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  if (documentCount === 0) {
    return (
      <p className="rounded-md border border-dashed border-line-strong bg-sunken px-4 py-5 text-sm text-ink-muted">
        Upload at least one document in step 2 to generate embed code.
      </p>
    )
  }

  const primary = toSafeHex(config.primary_color)
  const dimensions = SIZES[config.size] ?? SIZES.medium
  const isLeft = config.position === 'bottom-left'
  const onPrimary = readableTextOn(primary)
  const copied = copyStatus === 'Copied'
  const sitesMissing = modelAttached && origins.length === 0

  const generate = async () => {
    if (isGenerating || sitesMissing) return
    const sentOrigins = sitesRef.current ? sitesRef.current.commitPending() : origins
    if (sentOrigins === null) return
    const sentModel = ownModel
    setError(null)
    setIsGenerating(true)
    try {
      const response = await fetch('/api/widget/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(storageToken ? { 'x-storage-token': storageToken } : {}),
          ...(modelToken ? { [MODEL_TOKEN_HEADER]: modelToken } : {}),
        },
        body: JSON.stringify({
          sessionId,
          name: config.name || config.title || 'Support Widget',
          title: config.title || config.name || 'AI Support Assistant',
          welcome_message: config.welcome_message || 'Hi! How can I help you today?',
          primary_color: toSafeHex(config.primary_color),
          position: config.position || 'bottom-right',
          size: config.size || 'medium',
          allowed_origins: sentOrigins,
        }),
      })
      const body = await response.json().catch(() => null)
      const status = response.status

      if (isModelErrorCode(body?.code)) {
        setError(modelErrorMessage(body.code))
      } else if (status === 429) {
        setError('Too many requests from this network in the last minute. Wait a minute and try again.')
      } else if (status === 400 && body?.code === 'origins_required') {
        setError(ORIGINS_REQUIRED_MESSAGE)
      } else if (status === 400 && body?.code === 'invalid_origin' && typeof body?.error === 'string') {
        setError(body.error)
      } else if (status === 400) {
        setError(`Couldn't generate embed code: ${body?.error ?? 'invalid request'}.`)
      } else if (!response.ok || typeof body?.embedCode !== 'string' || typeof body?.scriptUrl !== 'string') {
        if (body?.code === 'workspace_not_found') onWorkspaceMissing?.()
        setError((STORAGE_ERROR_CODES as readonly string[]).includes(body?.code) ? storageErrorMessage(body.code) : `Couldn't generate embed code (status ${status}). Sessions are lost when the server restarts, so upload your documents again and retry.`)
      } else {
        setEmbedCode(body.embedCode)
        setScriptUrl(body.scriptUrl)
        setGeneratedWithSites(sentOrigins.length > 0)
        setGeneratedModel(sentModel)
        setCopyStatus('')
        setIsOpen(true)
        onGenerated?.()
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
      className="flex size-14 shrink-0 items-center justify-center rounded-full shadow-md"
      style={{ backgroundColor: primary, color: onPrimary }}
    >
      <ChatIcon size={24} />
    </span>
  )

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6">
      <div>
        <h3 className="text-base font-semibold text-ink">
          Widget preview
        </h3>
        <div className={`mt-3 flex items-end gap-3 rounded-md border border-line bg-sunken p-4 sm:p-6 ${isLeft ? 'justify-start' : 'justify-end'}`}>
          {isLeft && launcher}
          <div className="min-w-0 max-w-64 flex-1 overflow-hidden rounded-xl bg-surface shadow-lg">
            <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: primary, color: onPrimary }}>
              <ChatIcon size={16} />
              <span className="min-w-0 truncate text-sm font-semibold">{config.title || config.name || 'AI Support Assistant'}</span>
            </div>
            <div className="bg-sunken p-3">
              <p className="max-w-[88%] rounded-lg rounded-bl-sm border border-line bg-surface px-3 py-2 text-xs text-ink wrap-anywhere">
                {config.welcome_message || 'Hi! How can I help you today?'}
              </p>
            </div>
          </div>
          {!isLeft && launcher}
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          Position: {isLeft ? 'bottom left' : 'bottom right'}. Size: {config.size in SIZES ? config.size : 'medium'}, {dimensions.width} × {dimensions.height} px.
        </p>
      </div>

      <div className="mt-6">
        <AllowedSitesField
          ref={sitesRef}
          origins={origins}
          onChange={setOrigins}
          required={modelAttached}
          describedById={sitesMissing ? requiredId : undefined}
        />
      </div>

      <div className="mt-6">
        <button
          ref={generateRef}
          type="button"
          onClick={generate}
          disabled={isGenerating || sitesMissing}
          aria-busy={isGenerating}
          aria-describedby={sitesMissing ? requiredId : undefined}
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
        {sitesMissing && (
          <p id={requiredId} className="mt-2 max-w-[60ch] text-sm text-ink-muted">
            {ORIGINS_REQUIRED_MESSAGE}
          </p>
        )}
      </div>

      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink">
          <AlertIcon />
          <p>{error}</p>
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={handleDialogClose}
        className="m-auto w-[min(48rem,calc(100vw-1rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-surface p-0 text-ink shadow-lg motion-safe:animate-pop backdrop:bg-ink/60"
      >
        <div className="flex flex-col gap-5 p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={titleId} className="text-xl font-semibold text-ink">
                Embed code
              </h2>
              <p id={descriptionId} className="mt-1 max-w-[60ch] text-sm text-ink-muted">
                {generatedWithSites
                  ? 'One line adds the assistant to your allowed sites. Paste it before the closing body tag of their pages, or follow the steps for your platform below.'
                  : 'One line adds the assistant to any website. Paste it before the closing body tag of your pages, or follow the steps for your platform below.'}
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={closeDialog} className={`${iconButton} -mr-2 -mt-1 shrink-0`}>
              <CloseIcon />
            </button>
          </div>
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-3 rounded-t-md border border-b-0 border-line bg-sunken py-1 pl-4 pr-1">
              <span className="text-sm font-semibold text-ink">Your embed code</span>
              <button
                ref={copyRef}
                type="button"
                onClick={copyCode}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-semibold text-accent hover:bg-accent-tint hover:text-accent-strong"
              >
                {copied ? (
                  <>
                    <CheckIcon />
                    Copied
                  </>
                ) : (
                  'Copy code'
                )}
              </button>
            </div>
            <pre
              tabIndex={0}
              aria-label="Embed code"
              className="max-h-[50vh] overflow-auto whitespace-pre rounded-b-md bg-code-bg p-4 font-mono text-sm text-code-ink"
            >
              {embedCode}
            </pre>
            <p role="status" aria-live="polite" className={copyStatus && !copied ? 'mt-2 text-sm text-ink-muted' : 'sr-only'}>
              {copyStatus}
            </p>
          </div>
          {scriptUrl && (
            <InstallGuide embedCode={embedCode} scriptUrl={scriptUrl} apiBaseUrl={new URL(scriptUrl).origin} persistent={!!storageToken} hasAllowedSites={generatedWithSites} ownModel={generatedModel} />
          )}
        </div>
      </dialog>
    </div>
  )
}
