'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import { CONNECTOR_LIMITS, type AnswerPath } from '@/lib/connector/shared'
import { CONNECTOR_ANSWER_COPY } from '@/components/ui/DataDisclosure'
import type { Connector } from './useConnector'

export interface ConnectBackendStepProps {
  connector: Connector
  disabledReason?: string | null
  // Whether a model is saved in "Use your own model"; decides which answer path applies without `answer`.
  ownModelSaved?: boolean
  onConnected?: () => void
  onDisconnect?: () => void
}

const API_DOC_URL = 'https://github.com/mahAnuj/ai-support-bot/blob/main/docs/connector-api.md'
const REFERENCE_URL = 'https://github.com/mahAnuj/ai-support-bot/tree/main/connector'

const WRAPPER = 'mt-6 rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6'
const HEADING = 'text-base font-semibold text-ink'
const BODY = 'mt-1 max-w-[60ch] text-sm text-ink-muted'
const INPUT =
  'h-11 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-sm text-ink placeholder:text-ink-subtle focus:border-accent disabled:cursor-not-allowed disabled:bg-sunken'
const PRIMARY_BUTTON =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 text-sm font-semibold text-ink hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60'
const CODE = 'rounded bg-sunken px-1 py-0.5 font-mono text-xs text-ink'
const LINK = 'text-accent underline underline-offset-2'
const VALUE = 'font-mono text-sm text-ink break-all'
const SECRET_BOX = 'block w-full rounded-md border border-line-strong bg-sunken px-3 py-2.5 font-mono text-sm text-ink break-all'
const REASON = 'mt-3 max-w-[60ch] rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink'

const E5_NOTE =
  'Documents you uploaded before connecting stay in this demo session and are not sent to your backend. Upload them again.'

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
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0 text-accent">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  )
}

function ServerIcon() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0 text-accent">
      <rect x="3.5" y="4" width="17" height="7" rx="1.5" />
      <rect x="3.5" y="13" width="17" height="7" rx="1.5" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink">
      <AlertIcon />
      <p className="min-w-0 [overflow-wrap:anywhere]">{message}</p>
    </div>
  )
}

function answerPathFor(answer: boolean, ownModelSaved: boolean): AnswerPath {
  return answer ? 'backend' : ownModelSaved ? 'owner' : 'demo'
}

function capabilityList(capabilities: string[]): string {
  return capabilities.length > 0 ? capabilities.join(', ') : 'none'
}

export default function ConnectBackendStep({
  connector,
  disabledReason = null,
  ownModelSaved = false,
  onConnected,
  onDisconnect,
}: ConnectBackendStepProps): JSX.Element | null {
  const [value, setValue] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [returnFocusTo, setReturnFocusTo] = useState<string | null>(null)
  const [showMovedNote, setShowMovedNote] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingHeadingRef = useRef<HTMLHeadingElement>(null)
  const connectedHeadingRef = useRef<HTMLHeadingElement>(null)
  const docsHeadingRef = useRef<HTMLHeadingElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingFocus = useRef<'pending' | 'connected' | 'idle' | null>(null)

  const baseId = useId()
  const headingId = `${baseId}-heading`
  const introId = `${baseId}-intro`
  const inputId = `${baseId}-input`
  const helpId = `${baseId}-help`
  const reasonId = `${baseId}-reason`
  const secretId = `${baseId}-secret`
  const setupId = `${baseId}-setup`
  const onceId = `${baseId}-once`
  const docsHeadingId = `${baseId}-docs`
  const disconnectHelpId = `${baseId}-disconnect-help`

  const state = connector.connected ? 'connected' : connector.pending ? 'pending' : 'idle'

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null || target !== state) return
    if (target === 'pending') pendingHeadingRef.current?.focus()
    else if (target === 'connected') connectedHeadingRef.current?.focus()
    else inputRef.current?.focus()
    pendingFocus.current = null
  }, [state])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  if (!connector.ready) return null

  const heading = 'Connect your backend (optional)'

  if (!connector.available) {
    return (
      <section aria-labelledby={headingId} className={WRAPPER}>
        <h3 id={headingId} className={HEADING}>{heading}</h3>
        <p className={BODY}>Connecting a backend isn&apos;t available on this deployment.</p>
      </section>
    )
  }

  const copy = async (text: string) => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus('Copied')
      copyTimerRef.current = setTimeout(() => setCopyStatus(''), 2000)
    } catch {
      setCopyStatus("Couldn't copy. Select the text and copy it manually.")
    }
  }

  const liveRegion = (
    <p role="status" aria-live="polite" className={copyStatus ? 'mt-2 text-sm text-ink-muted' : 'sr-only'}>
      {copyStatus}
    </p>
  )

  if (state === 'connected' && connector.info) {
    const info = connector.info
    const path = answerPathFor(info.answer, ownModelSaved)
    const testing = connector.busy === 'test'
    const deleting = connector.busy === 'delete'
    const result = connector.testResult
    const documents = connector.documents
    const listStatus = connector.documentsStatus
    // A reload keeps the previous list on screen until the new one arrives.
    const showList = documents !== null && (listStatus === 'loaded' || listStatus === 'loading')

    const disconnect = () => {
      pendingFocus.current = 'idle'
      setShowMovedNote(false)
      setConfirmingDelete(null)
      connector.disconnect()
      onDisconnect?.()
    }

    const remove = async (id: string) => {
      const ok = await connector.deleteDocument(id)
      if (ok) {
        setConfirmingDelete(null)
        docsHeadingRef.current?.focus()
      }
    }

    return (
      <section aria-labelledby={headingId} className={WRAPPER}>
        <h3 id={headingId} ref={connectedHeadingRef} tabIndex={-1} className={`${HEADING} flex items-start gap-2`}>
          <ServerIcon />
          Using your backend
        </h3>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-sm text-ink-muted">Address</dt>
          <dd className={VALUE}>{info.host}</dd>
          <dt className="mt-1 text-sm text-ink-muted sm:mt-0">Key id</dt>
          <dd className={VALUE}>{info.keyId}</dd>
        </dl>
        <p className={BODY}>{CONNECTOR_ANSWER_COPY[path]}</p>
        {showMovedNote && <p className={REASON}>{E5_NOTE}</p>}

        <div className="mt-4 flex flex-col items-start gap-2">
          <button type="button" onClick={() => void connector.test()} disabled={testing} aria-busy={testing} className={SECONDARY_BUTTON}>
            {testing ? (
              <>
                <Spinner />
                Testing
              </>
            ) : (
              'Test connection'
            )}
          </button>
          <div role="status" aria-live="polite" className="w-full">
            {result && (
              result.ok ? (
                <p className="flex items-start gap-2 text-sm text-ink">
                  <CheckIcon />
                  <span className="min-w-0">
                    {`Connection works. Your backend accepted a signed request and answered a test search (${result.passagesReturned} ${result.passagesReturned === 1 ? 'passage' : 'passages'}).`}
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-2 text-sm text-ink">
                  <AlertIcon />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {`Test failed${result.stage === 'health' ? ' at the health check' : result.stage === 'search' ? ' at the test search' : ''}. ${result.message}`}
                  </span>
                </p>
              )
            )}
          </div>
        </div>

        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 id={docsHeadingId} ref={docsHeadingRef} tabIndex={-1} className="text-sm font-semibold text-ink">
              {showList ? `Documents on your backend (${documents.length})` : 'Documents on your backend'}
            </h4>
            <button
              type="button"
              onClick={() => void connector.refreshDocuments()}
              className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-accent underline underline-offset-2 hover:text-accent-strong"
            >
              Refresh list
            </button>
          </div>
          <div role="status" aria-live="polite">
            {listStatus === 'loading' && !showList && <p className="mt-2 text-sm text-ink-muted">Loading the list…</p>}
            {listStatus === 'unconfigured' && (
              <p className="mt-2 max-w-[60ch] text-sm text-ink-muted">
                Your backend doesn&apos;t accept this key yet. Add the setup line to <code className={CODE}>CONNECTOR_KEYS</code>,
                restart your backend, then use Test connection. The list loads once the test passes.
              </p>
            )}
          </div>
          {listStatus === 'failed' ? (
            <div role="alert" className="mt-2 flex items-start gap-2 text-sm text-ink">
              <AlertIcon />
              <p className="min-w-0 [overflow-wrap:anywhere]">
                Couldn&apos;t load the list. {connector.documentsError} Use Refresh list to try again.
              </p>
            </div>
          ) : !showList ? null : documents.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No documents yet. Upload them above; they go to your backend.</p>
          ) : (
            <ul aria-labelledby={docsHeadingId} className="mt-3 flex flex-col gap-2">
              {documents.map(doc => {
                const confirming = confirmingDelete === doc.id
                return (
                  <li key={doc.id} className="rounded-md border border-line px-3 py-2">
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0 break-all text-sm text-ink">{doc.filename}</span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="text-xs text-ink-muted tabular-nums">
                          {`${doc.passageCount} ${doc.passageCount === 1 ? 'passage' : 'passages'}`}
                        </span>
                        {!confirming && (
                          <button
                            type="button"
                            onClick={() => {
                              setReturnFocusTo(null)
                              setConfirmingDelete(doc.id)
                            }}
                            autoFocus={returnFocusTo === doc.id}
                            aria-label={`Delete ${doc.filename}`}
                            className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-danger underline underline-offset-2"
                          >
                            Delete
                          </button>
                        )}
                      </span>
                    </div>
                    {confirming && (
                      <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
                        <p className="text-sm text-ink [overflow-wrap:anywhere]">{`Delete ${doc.filename}?`} It is removed from your backend.</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            autoFocus
                            onClick={() => void remove(doc.id)}
                            disabled={deleting}
                            aria-busy={deleting}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-danger px-5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {deleting ? (
                              <>
                                <Spinner />
                                Deleting
                              </>
                            ) : (
                              'Confirm delete'
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmingDelete(null)
                              setReturnFocusTo(doc.id)
                            }}
                            disabled={deleting}
                            className={SECONDARY_BUTTON}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {connector.error && <ErrorMessage message={connector.error.message} />}

        <div className="mt-6 flex flex-col items-start gap-2">
          <button type="button" onClick={disconnect} aria-describedby={disconnectHelpId} className={SECONDARY_BUTTON}>
            Disconnect this browser
          </button>
          <p id={disconnectHelpId} className="max-w-[60ch] text-xs text-ink-muted">
            This forgets the link in this browser only. Nothing is deleted from your backend. Embeds you generated keep
            working until you remove key id <code className={`${CODE} break-all`}>{info.keyId}</code> from{' '}
            <code className={CODE}>CONNECTOR_KEYS</code> on your backend.
          </p>
        </div>
      </section>
    )
  }

  if (state === 'pending' && connector.pending) {
    const pending = connector.pending
    const path = answerPathFor(pending.answer, ownModelSaved)
    const setupLine = `CONNECTOR_KEYS=${pending.keyId}:${pending.secret}`

    const confirm = () => {
      pendingFocus.current = 'connected'
      setCopyStatus('')
      setShowMovedNote(true)
      connector.confirmSaved()
      onConnected?.()
    }

    const cancel = () => {
      pendingFocus.current = 'idle'
      setCopyStatus('')
      connector.cancelPending()
    }

    return (
      <section aria-labelledby={headingId} className={WRAPPER}>
        <h3 id={headingId} ref={pendingHeadingRef} tabIndex={-1} className={`${HEADING} flex items-start gap-2`}>
          <ServerIcon />
          Your backend answered. Add this key to it.
        </h3>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-sm text-ink-muted">Address</dt>
          <dd className={VALUE}>{pending.host}</dd>
          <dt className="mt-1 text-sm text-ink-muted sm:mt-0">API version</dt>
          <dd className={VALUE}>{pending.version}</dd>
          <dt className="mt-1 text-sm text-ink-muted sm:mt-0">Capabilities</dt>
          <dd className={VALUE}>{capabilityList(pending.capabilities)}</dd>
        </dl>
        <p className={BODY}>{CONNECTOR_ANSWER_COPY[path]}</p>

        <p id={onceId} className={`${REASON} font-medium`}>
          This secret is shown once. If you leave or reload this page before confirming, connect again to get a new key.
        </p>

        <div className="mt-4">
          <p id={`${secretId}-label`} className="text-sm font-medium text-ink">Signing secret</p>
          <output id={secretId} aria-labelledby={`${secretId}-label`} aria-describedby={onceId} className={`mt-1.5 ${SECRET_BOX}`}>
            {pending.secret}
          </output>
          <button type="button" onClick={() => void copy(pending.secret)} className={`mt-2 ${SECONDARY_BUTTON}`}>
            Copy secret
          </button>
        </div>

        <div className="mt-4">
          <p id={`${setupId}-label`} className="text-sm font-medium text-ink">Setup line for your backend</p>
          <output id={setupId} aria-labelledby={`${setupId}-label`} aria-describedby={`${setupId}-help`} className={`mt-1.5 ${SECRET_BOX}`}>
            {setupLine}
          </output>
          <p id={`${setupId}-help`} className="mt-1.5 max-w-[60ch] text-xs text-ink-subtle">
            Add this to your backend&apos;s environment and restart it. If <code className={CODE}>CONNECTOR_KEYS</code> already
            has keys, append <code className={`${CODE} break-all`}>{`,${pending.keyId}:…`}</code> with a comma instead of
            replacing the line.
          </p>
          <button type="button" onClick={() => void copy(setupLine)} className={`mt-2 ${SECONDARY_BUTTON}`}>
            Copy setup line
          </button>
        </div>

        {liveRegion}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={confirm} className={PRIMARY_BUTTON}>
            I&apos;ve saved it
          </button>
          <button type="button" onClick={cancel} className={SECONDARY_BUTTON}>
            Cancel
          </button>
        </div>

        {connector.error && <ErrorMessage message={connector.error.message} />}
      </section>
    )
  }

  const disabled = !!disabledReason
  const connecting = connector.busy === 'connect'

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const baseUrl = value.trim()
    if (disabled || !baseUrl || connecting) return
    pendingFocus.current = 'pending'
    const ok = await connector.connect(baseUrl)
    if (ok) setValue('')
    else pendingFocus.current = null
  }

  return (
    <section aria-labelledby={headingId} className={WRAPPER}>
      <h3 id={headingId} className={HEADING}>{heading}</h3>
      <p id={introId} className={BODY}>
        Keep documents and search on a server you run. It speaks a small signed API:{' '}
        <a href={API_DOC_URL} target="_blank" rel="noreferrer" className={LINK}>docs/connector-api.md</a>. The{' '}
        <a href={REFERENCE_URL} target="_blank" rel="noreferrer" className={LINK}>reference server</a> runs on Postgres
        with pgvector. Documents already in this demo session are not sent; upload them again after connecting.
      </p>
      {disabledReason && (
        <p id={reasonId} className={REASON}>{disabledReason}</p>
      )}

      <form onSubmit={submit} className="mt-4">
        <fieldset disabled={disabled} aria-describedby={disabled ? reasonId : undefined} className="m-0 min-w-0 border-0 p-0">
          <label htmlFor={inputId} className="text-sm font-medium text-ink">Backend base URL</label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              ref={inputRef}
              name="connector-base-url"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              maxLength={CONNECTOR_LIMITS.baseUrl}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="https://support.example.com"
              aria-describedby={helpId}
              aria-invalid={connector.error ? true : undefined}
              className={`min-w-0 ${INPUT}`}
            />
            <button type="submit" disabled={disabled || connecting || value.trim() === ''} aria-busy={connecting} className={PRIMARY_BUTTON}>
              {connecting ? (
                <>
                  <Spinner />
                  Checking
                </>
              ) : (
                'Check backend'
              )}
            </button>
          </div>
          <p id={helpId} className="mt-1.5 text-xs text-ink-subtle">
            This server asks your backend for its version and capabilities, without a key. If it answers, you get a new
            key id and signing secret to add to it.
          </p>
        </fieldset>
      </form>

      {connector.error && !disabled && <ErrorMessage message={connector.error.message} />}
    </section>
  )
}
