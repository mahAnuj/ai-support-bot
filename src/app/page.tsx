'use client'

import React, { useCallback, useEffect, useId, useState } from 'react'
import ChatInterface from '@/components/ui/ChatInterface'
import FileUpload from '@/components/ui/FileUpload'
import DataDisclosure from '@/components/ui/DataDisclosure'
import EmbedStep, { DEFAULT_PRIMARY_COLOR, toSafeHex, type WidgetConfig } from '@/components/ui/EmbedStep'
import { readableTextOn } from '@/components/ui/contrast'
import ConnectDatabaseStep from '@/components/storage/ConnectDatabaseStep'
import StorageModeLabel from '@/components/storage/StorageModeLabel'
import { useStorageConnection } from '@/components/storage/useStorageConnection'
import OwnModelStep from '@/components/model/OwnModelStep'
import { useOwnModel } from '@/components/model/useOwnModel'

// Assistant configurations
const UNIVERSAL_ASSISTANT = {
  systemPrompt: "You are a professional business AI assistant. Provide accurate, helpful responses based on the uploaded business documents. If you don't have specific information from the documents, provide general business guidance while noting that more specific answers could be provided with relevant documentation.",
  suggestedQuestions: [
    "What services does our company offer?",
    "What are our business hours?",
    "How can customers contact support?",
    "What is our return policy?"
  ]
}

const LABEL = 'text-sm font-medium text-ink'
const HELPER = 'mt-1.5 text-xs text-ink-subtle'
const INPUT = 'h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-subtle focus:border-accent'
const TEXTAREA = 'block w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 max-sm:min-h-24 text-base text-ink placeholder:text-ink-subtle focus:border-accent'
const PANEL = 'rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6'

const SIZE_OPTIONS: { value: WidgetConfig['size']; label: string; dimensions: string }[] = [
  { value: 'small', label: 'Small', dimensions: '300×400' },
  { value: 'medium', label: 'Medium', dimensions: '350×500' },
  { value: 'large', label: 'Large', dimensions: '400×600' },
]

type UploadedDocument = { filename: string; chunks: number }

type StepStatus = 'done' | 'current' | 'upcoming'

const RAIL_STEPS = [
  { href: '#setup', label: 'Set up' },
  { href: '#documents', label: 'Add documents' },
  { href: '#try', label: 'Try it' },
  { href: '#embed', label: 'Embed' },
] as const

const STATUS_SUFFIX: Record<StepStatus, string> = {
  done: ', completed',
  current: ', current step',
  upcoming: ', not started',
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function ProgressRail({ statuses }: { statuses: StepStatus[] }) {
  return (
    <nav aria-label="Progress" className="mt-8 motion-safe:animate-enter [animation-delay:120ms]">
      <ol className="grid grid-cols-4 gap-2 md:flex md:gap-0">
        {RAIL_STEPS.map((step, i) => {
          const status = statuses[i]
          const isLast = i === RAIL_STEPS.length - 1
          return (
            <li key={step.href} className={`flex min-w-0 justify-center md:items-center md:justify-start ${isLast ? 'md:flex-none' : 'md:flex-1'}`}>
              <a
                href={step.href}
                aria-current={status === 'current' ? 'step' : undefined}
                className="flex min-h-10 min-w-0 flex-col items-center gap-1.5 rounded-md px-1 py-1 text-center focus-visible:outline-white md:flex-row md:gap-3 md:text-left"
              >
                {status === 'done' ? (
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-hero-accent text-hero">
                    <CheckIcon />
                  </span>
                ) : status === 'current' ? (
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-hero tabular-nums ring-2 ring-hero-accent ring-offset-2 ring-offset-hero">
                    {i + 1}
                  </span>
                ) : (
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-hero-muted text-sm text-hero-muted tabular-nums">
                    {i + 1}
                  </span>
                )}
                <span
                  className={`text-xs md:whitespace-nowrap md:text-sm ${
                    status === 'current' ? 'font-semibold text-hero-ink' : status === 'done' ? 'text-hero-ink' : 'text-hero-muted'
                  }`}
                >
                  {step.label}
                  <span className="sr-only">{STATUS_SUFFIX[status]}</span>
                </span>
              </a>
              {!isLast && <span aria-hidden="true" className="mx-2 hidden h-px min-w-4 flex-1 bg-hero-line md:block lg:mx-3" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function StepHeader({
  id,
  n,
  title,
  description,
  status,
}: {
  id: string
  n: number
  title: string
  description: string
  status: StepStatus
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {status === 'done' ? (
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-white">
          <CheckIcon />
          <span className="sr-only">Step {n}, completed</span>
        </span>
      ) : status === 'current' ? (
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white tabular-nums ring-4 ring-accent-tint">
          <span className="sr-only">Step </span>
          {n}
        </span>
      ) : (
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line-strong text-sm font-semibold text-ink-muted tabular-nums">
          <span className="sr-only">Step </span>
          {n}
        </span>
      )}
      <div className="min-w-0">
        <h2 id={id} className="text-xl font-semibold text-ink">{title}</h2>
        <p className="mt-0.5 max-w-[60ch] text-sm text-ink-muted">{description}</p>
      </div>
    </div>
  )
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  )
}

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadComplete, setUploadComplete] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [hasTried, setHasTried] = useState(false)
  const [hasEmbed, setHasEmbed] = useState(false)
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig>({
    name: 'Business Support Assistant',
    title: 'AI Support Assistant',
    welcome_message: 'Hi! I\'m your AI assistant. I can help answer questions about our business. How can I assist you today?',
    primary_color: DEFAULT_PRIMARY_COLOR,
    position: 'bottom-right',
    size: 'medium',
  })
  const storage = useStorageConnection()
  useEffect(() => { if (storage.documents) setUploadedDocuments(storage.documents) }, [storage.documents])
  const ownModel = useOwnModel(storage.available)
  const savedModel = ownModel.model
  const modelInfo = savedModel ? { model: savedModel.model, host: savedModel.host } : null
  const handleDisconnect = useCallback(() => { setUploadedDocuments([]); setSessionId(null) }, [])

  const step1Id = useId()
  const step2Id = useId()
  const step3Id = useId()
  const step4Id = useId()
  const fieldId = useId()
  const titleId = `${fieldId}-title`
  const nameId = `${fieldId}-name`
  const welcomeId = `${fieldId}-welcome`
  const colorId = `${fieldId}-color`
  const positionId = `${fieldId}-position`
  const docsHeadingId = `${fieldId}-docs`

  const hasUploadedFiles = uploadedDocuments.length > 0
  const safeColor = toSafeHex(widgetConfig.primary_color)

  const done = [hasUploadedFiles || hasTried || hasEmbed, hasUploadedFiles, hasTried, hasEmbed]
  const current = done.indexOf(false)
  const statuses: StepStatus[] = done.map((isDone, i) => (isDone ? 'done' : i === current ? 'current' : 'upcoming'))

  const updateConfig = <K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) => {
    setWidgetConfig(prev => ({ ...prev, [key]: value }))
  }

  const handleFileUpload = async (files: File[]) => {
    setIsUploading(true)
    setUploadComplete(false)
    setUploadError(null)

    const formData = new FormData()
    files.forEach(file => formData.append('files', file))

    if (sessionId) {
      formData.append('sessionId', sessionId)
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: storage.requestHeaders,
        body: formData,
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        // The workspace was deleted from the owner's database; recheck the link so it is cleared
        if (body?.code === 'workspace_not_found') void storage.refreshDocuments()
        if (response.status === 400) {
          const details = Array.isArray(body?.details) ? body.details.join(' ') : ''
          setUploadError(details || body?.error || 'These files couldn\'t be uploaded.')
        } else if (response.status === 429) {
          setUploadError('Too many uploads from this network in the last minute. Wait a minute and try again.')
        } else {
          // The server's message names the file and the reason (no text, password, unreadable PDF)
          const reason = typeof body?.details === 'string' ? body.details.slice(0, 300) : ''
          setUploadError(
            reason
              ? reason
              : `These files couldn't be indexed (status ${response.status}). Check that each file has readable text, then try again.`
          )
        }
        return
      }

      const result = await response.json()

      if (result.sessionId && result.sessionId !== sessionId) {
        setSessionId(result.sessionId)
      }

      if (Array.isArray(result.documents)) {
        const added: UploadedDocument[] = result.documents.map((d: { filename: string; chunks: number }) => ({
          filename: d.filename,
          chunks: d.chunks,
        }))
        setUploadedDocuments(prev => [...prev, ...added])
      }

      setUploadComplete(true)
    } catch {
      setUploadError('Couldn\'t reach the server. Check your connection and try again.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleSessionUpdate = useCallback((newSessionId: string | null, _hasFiles: boolean) => {
    if (newSessionId) {
      setSessionId(prev => (prev === newSessionId ? prev : newSessionId))
    }
  }, [])

  const handleMessageSent = useCallback(() => setHasTried(true), [])
  const handleGenerated = useCallback(() => setHasEmbed(true), [])

  return (
    <>
      <header className="bg-hero text-hero-ink">
        <div className="h-14 border-b border-hero-line">
          <div className="mx-auto flex h-full max-w-page items-center gap-2 px-4 sm:px-8">
            <svg aria-hidden="true" className="text-hero-ink" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
              <path d="M9 13h6M9 17h4" />
            </svg>
            <p className="text-base font-semibold text-hero-ink">Support assistant builder</p>
          </div>
        </div>
        <div className="mx-auto max-w-page px-4 pb-8 pt-10 sm:px-8 sm:pb-10 sm:pt-14">
          <h1 className="max-w-[22ch] text-3xl font-bold motion-safe:animate-enter sm:text-display">
            Build a support assistant from your own documents
          </h1>
          <p className="mt-4 max-w-[60ch] text-lg text-hero-muted motion-safe:animate-enter [animation-delay:60ms]">
            Upload your FAQs, policies or manuals, check its answers in a live preview, then add it to your website with one line of code.
          </p>
          <ProgressRail statuses={statuses} />
        </div>
      </header>

      <main className="mx-auto max-w-page px-4 pb-28 pt-10 sm:px-8">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_auto_1fr]">
          <section id="setup" aria-labelledby={step1Id} className="min-w-0 scroll-mt-6 lg:col-start-1 lg:row-start-1">
            <StepHeader
              id={step1Id}
              n={1}
              title="Set up the assistant"
              description="Name it and choose how the chat window looks on your site."
              status={statuses[0]}
            />
            <div className={`${PANEL} grid grid-cols-1 gap-4 sm:grid-cols-6`}>
              <div className="min-w-0 sm:col-span-2">
                <label htmlFor={titleId} className={LABEL}>Display title</label>
                <input
                  id={titleId}
                  type="text"
                  value={widgetConfig.title}
                  onChange={e => updateConfig('title', e.target.value)}
                  aria-describedby={`${titleId}-help`}
                  className={`mt-1.5 ${INPUT}`}
                />
                <p id={`${titleId}-help`} className={HELPER}>Shown in the chat header.</p>
              </div>

              <div className="min-w-0 sm:col-span-2">
                <label htmlFor={nameId} className={LABEL}>Assistant name</label>
                <input
                  id={nameId}
                  type="text"
                  value={widgetConfig.name}
                  onChange={e => updateConfig('name', e.target.value)}
                  aria-describedby={`${nameId}-help`}
                  className={`mt-1.5 ${INPUT}`}
                />
                <p id={`${nameId}-help`} className={HELPER}>Internal name for this widget.</p>
              </div>

              <div className="min-w-0 sm:col-span-2">
                <label htmlFor={positionId} className={LABEL}>Position</label>
                <select
                  id={positionId}
                  value={widgetConfig.position}
                  onChange={e => updateConfig('position', e.target.value as WidgetConfig['position'])}
                  className={`mt-1.5 ${INPUT}`}
                >
                  <option value="bottom-right">Bottom right</option>
                  <option value="bottom-left">Bottom left</option>
                </select>
              </div>

              <div className="min-w-0 sm:col-span-6">
                <label htmlFor={welcomeId} className={LABEL}>Welcome message</label>
                <textarea
                  id={welcomeId}
                  rows={2}
                  value={widgetConfig.welcome_message}
                  onChange={e => updateConfig('welcome_message', e.target.value)}
                  aria-describedby={`${welcomeId}-help`}
                  className={`mt-1.5 ${TEXTAREA}`}
                />
                <p id={`${welcomeId}-help`} className={HELPER}>The first message visitors see.</p>
              </div>

              <div className="min-w-0 sm:col-span-3 lg:col-span-6 xl:col-span-3">
                <label htmlFor={colorId} className={LABEL}>Brand colour</label>
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Brand colour picker"
                    value={safeColor}
                    onChange={e => updateConfig('primary_color', e.target.value)}
                    className="size-11 shrink-0 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
                  />
                  <input
                    id={colorId}
                    type="text"
                    value={widgetConfig.primary_color}
                    onChange={e => updateConfig('primary_color', e.target.value)}
                    aria-describedby={`${colorId}-help`}
                    placeholder={DEFAULT_PRIMARY_COLOR}
                    spellCheck={false}
                    autoComplete="off"
                    className={`min-w-0 ${INPUT}`}
                  />
                </div>
                <p id={`${colorId}-help`} className={HELPER}>
                  Text on this colour switches between white and dark to stay readable.
                </p>
              </div>

              <fieldset className="min-w-0 sm:col-span-3 lg:col-span-6 xl:col-span-3">
                <legend className={LABEL}>Widget size</legend>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {SIZE_OPTIONS.map(option => {
                    const selected = widgetConfig.size === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => updateConfig('size', option.value)}
                        className={`min-h-11 rounded-md border px-2 py-2 text-left ${
                          selected ? 'border-accent bg-accent-tint ring-1 ring-accent' : 'border-line-strong bg-surface hover:bg-sunken'
                        }`}
                      >
                        <span className={`block text-sm text-ink ${selected ? 'font-semibold' : 'font-medium'}`}>{option.label}</span>
                        <span className="block whitespace-nowrap text-xs text-ink-muted tabular-nums">{option.dimensions}</span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            </div>
          </section>

          <section id="documents" aria-labelledby={step2Id} className="min-w-0 scroll-mt-6 lg:col-start-1 lg:row-start-2">
            <StepHeader
              id={step2Id}
              n={2}
              title="Add your documents"
              description="The assistant answers from these: FAQs, policies, price lists or manuals."
              status={statuses[1]}
            />
            <div className={PANEL}>
              <DataDisclosure connected={storage.connected} ownModel={modelInfo} />
              <StorageModeLabel storage={storage} place="documents" />
              <div className="mt-5">
                <FileUpload
                  onUpload={handleFileUpload}
                  isProcessing={isUploading}
                  isComplete={uploadComplete}
                  maxFiles={5}
                  maxSize={10 * 1024 * 1024}
                  serverError={uploadError}
                />
              </div>

              {hasUploadedFiles && (
                <div className="mt-6">
                  <h3 id={docsHeadingId} className="text-base font-semibold text-ink">
                    {`Documents in this session (${uploadedDocuments.length})`}
                  </h3>
                  <ul aria-labelledby={docsHeadingId} className="mt-3 flex flex-col gap-2">
                    {uploadedDocuments.map((doc, index) => (
                      <li key={`${doc.filename}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2">
                          <FileIcon className="shrink-0 text-accent" />
                          <span className="min-w-0 truncate text-sm text-ink">{doc.filename}</span>
                        </span>
                        <span className="shrink-0 text-xs text-ink-muted tabular-nums">
                          {`${doc.chunks} ${doc.chunks === 1 ? 'chunk' : 'chunks'}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <ConnectDatabaseStep storage={storage} sessionId={sessionId} onDisconnect={handleDisconnect} />
            <OwnModelStep available={storage.available} ready={storage.ready} ownModel={ownModel} />
          </section>

          <section
            id="try"
            aria-labelledby={step3Id}
            className="min-w-0 scroll-mt-6 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start"
          >
            <StepHeader
              id={step3Id}
              n={3}
              title="Try it"
              description="Ask questions the way a visitor would and check the answers."
              status={statuses[2]}
            />
            <div className="h-[560px] overflow-hidden rounded-xl border border-line bg-surface shadow-md lg:h-[min(680px,calc(100dvh-3rem))]">
              <ChatInterface
                systemPrompt={UNIVERSAL_ASSISTANT.systemPrompt}
                roleContext="universal"
                suggestedQuestions={UNIVERSAL_ASSISTANT.suggestedQuestions}
                onSessionUpdate={handleSessionUpdate}
                hasUploadedFiles={hasUploadedFiles}
                sessionId={sessionId}
                title={widgetConfig.title}
                welcomeMessage={widgetConfig.welcome_message}
                primaryColor={safeColor}
                onPrimaryColor={readableTextOn(safeColor)}
                onMessageSent={handleMessageSent}
                storageToken={storage.token}
                modelToken={savedModel?.token ?? null}
              />
            </div>
            {savedModel ? (
              <p className="mt-2 text-xs text-ink-muted">
                Answers here and in the widget come from{' '}
                <span className="font-mono break-all text-ink">{savedModel.model}</span> at{' '}
                <span className="font-mono break-all text-ink">{savedModel.host}</span>, using your API key. Your
                provider&apos;s rate limits, pricing and data retention apply.
              </p>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">
                This demo answers, here and in the widget, with a free-tier model on Groq, so replies can be slow or
                briefly unavailable when the shared rate limit is reached.
              </p>
            )}
          </section>

          <section id="embed" aria-labelledby={step4Id} className="min-w-0 scroll-mt-6 lg:col-start-1 lg:row-start-3">
            <StepHeader
              id={step4Id}
              n={4}
              title="Get the embed code"
              description="Generate a script to paste into your site's HTML."
              status={statuses[3]}
            />
            <EmbedStep
              sessionId={sessionId}
              documentCount={uploadedDocuments.length}
              config={widgetConfig}
              onGenerated={handleGenerated}
              onWorkspaceMissing={storage.refreshDocuments}
              storageToken={storage.token}
              modelAttached={!!savedModel}
              modelToken={savedModel?.token ?? null}
              ownModel={modelInfo}
            />
            <StorageModeLabel storage={storage} place="embed" />
          </section>
        </div>
      </main>
    </>
  )
}
