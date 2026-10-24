'use client'

import React, { useCallback, useId, useState } from 'react'
import ChatInterface from '@/components/ui/ChatInterface'
import FileUpload from '@/components/ui/FileUpload'
import DataDisclosure from '@/components/ui/DataDisclosure'
import EmbedStep, { DEFAULT_PRIMARY_COLOR, toSafeHex, type WidgetConfig } from '@/components/ui/EmbedStep'

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
const PANEL = 'rounded-lg border border-line bg-surface p-4 sm:p-6'

const SIZE_OPTIONS: { value: WidgetConfig['size']; label: string; dimensions: string }[] = [
  { value: 'small', label: 'Small', dimensions: '300×400' },
  { value: 'medium', label: 'Medium', dimensions: '350×500' },
  { value: 'large', label: 'Large', dimensions: '400×600' },
]

type UploadedDocument = { filename: string; chunks: number }

function StepHeader({
  id,
  n,
  title,
  description,
  done = false,
}: {
  id: string
  n: number
  title: string
  description: string
  done?: boolean
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {done ? (
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accent bg-accent text-white">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          <span className="sr-only">Step {n}, completed</span>
        </span>
      ) : (
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accent text-sm font-semibold text-accent tabular-nums">
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
  const [widgetConfig, setWidgetConfig] = useState<WidgetConfig>({
    name: 'Business Support Assistant',
    title: 'AI Support Assistant',
    welcome_message: 'Hi! I\'m your AI assistant. I can help answer questions about our business. How can I assist you today?',
    primary_color: DEFAULT_PRIMARY_COLOR,
    position: 'bottom-right',
    size: 'medium',
  })

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
        body: formData,
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        if (response.status === 400) {
          const details = Array.isArray(body?.details) ? body.details.join(' ') : ''
          setUploadError(details || body?.error || 'These files couldn\'t be uploaded.')
        } else if (response.status === 429) {
          setUploadError('Too many uploads from this network in the last minute. Wait a minute and try again.')
        } else {
          setUploadError(`These files couldn't be indexed (status ${response.status}). If you run this app, check that OPENAI_API_KEY is set and valid, then try again.`)
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

  return (
    <>
      <header className="h-14 border-b border-line bg-white">
        <div className="mx-auto flex h-full max-w-page items-center gap-2 px-4 sm:px-8">
          <svg aria-hidden="true" className="text-accent" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 3v5h5" />
            <path d="M9 13h6M9 17h4" />
          </svg>
          <p className="text-base font-semibold text-ink">Support assistant builder</p>
        </div>
      </header>

      <main className="mx-auto max-w-page px-4 pb-28 pt-8 sm:px-8">
        <h1 className="text-2xl font-[650] text-ink sm:text-3xl">Build a support assistant from your own documents</h1>
        <p className="mt-3 max-w-[60ch] text-base text-ink-muted lg:max-w-none">
          Set how it looks, upload the documents it should answer from, try it here, then copy the embed code onto your site.
        </p>

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[auto_auto_1fr]">
          <section aria-labelledby={step1Id} className="min-w-0 lg:col-start-1 lg:row-start-1">
            <StepHeader
              id={step1Id}
              n={1}
              title="Set up the assistant"
              description="Name it and choose how the chat window looks on your site."
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

              <div className="min-w-0 sm:col-span-3">
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
                  Pick a colour dark enough for white text.
                </p>
              </div>

              <fieldset className="min-w-0 sm:col-span-3">
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
                          selected ? 'border-accent bg-accent-tint' : 'border-line-strong bg-surface hover:bg-sunken'
                        }`}
                      >
                        <span className="block text-sm font-semibold text-ink">{option.label}</span>
                        <span className="block whitespace-nowrap text-xs text-ink-muted tabular-nums">{option.dimensions}</span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            </div>
          </section>

          <section aria-labelledby={step2Id} className="min-w-0 lg:col-start-1 lg:row-start-2">
            <StepHeader
              id={step2Id}
              n={2}
              title="Add your documents"
              description="The assistant answers from these: FAQs, policies, price lists or manuals."
              done={hasUploadedFiles}
            />
            <div className={PANEL}>
              <DataDisclosure />
              <div className="mt-5">
                <FileUpload
                  onUpload={handleFileUpload}
                  isProcessing={isUploading}
                  isComplete={uploadComplete}
                  maxFiles={5}
                  maxSize={10 * 1024 * 1024}
                />
              </div>

              {uploadError && (
                <div role="alert" className="mt-3 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink">
                  <svg aria-hidden="true" className="mt-0.5 shrink-0 text-danger" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7.5v5.5M12 16.5h.01" />
                  </svg>
                  <p>
                    <span className="font-semibold text-danger">Upload failed.</span> {uploadError}
                  </p>
                </div>
              )}

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
          </section>

          <section
            aria-labelledby={step3Id}
            className="min-w-0 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:self-start"
          >
            <StepHeader
              id={step3Id}
              n={3}
              title="Try it"
              description="Ask questions the way a visitor would and check the answers."
            />
            <div
              style={{ ['--preview-primary' as string]: safeColor } as React.CSSProperties}
              className="h-[520px] overflow-hidden rounded-lg border border-line shadow-md lg:h-[640px]"
            >
              <ChatInterface
                systemPrompt={UNIVERSAL_ASSISTANT.systemPrompt}
                roleContext="universal"
                suggestedQuestions={UNIVERSAL_ASSISTANT.suggestedQuestions}
                onSessionUpdate={handleSessionUpdate}
                hasUploadedFiles={hasUploadedFiles}
                sessionId={sessionId}
                title={widgetConfig.title}
                welcomeMessage={widgetConfig.welcome_message}
              />
            </div>
          </section>

          <section aria-labelledby={step4Id} className="min-w-0 lg:col-start-1 lg:row-start-3">
            <StepHeader
              id={step4Id}
              n={4}
              title="Get the embed code"
              description="Generate a script to paste into your site's HTML."
            />
            <EmbedStep sessionId={sessionId} documentCount={uploadedDocuments.length} config={widgetConfig} />
          </section>
        </div>
      </main>
    </>
  )
}
