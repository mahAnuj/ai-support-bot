'use client'

import { useId, useState, type FormEvent, type JSX } from 'react'
import type { StorageConnection } from './useStorageConnection'

export interface ConnectDatabaseStepProps {
  storage: StorageConnection
  sessionId: string | null
  onDisconnect?: () => void
  // When set, the form is shown disabled with this one-line reason.
  disabledReason?: string | null
}

const SCHEMA_SQL_URL = 'https://github.com/mahAnuj/ai-support-bot/blob/main/scripts/support-bot-schema.sql'
const ROLE_SQL_URL = 'https://github.com/mahAnuj/ai-support-bot/blob/main/scripts/support-bot-role.sql'

const WRAPPER = 'mt-6 rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6'
const HEADING = 'text-base font-semibold text-ink'
const BODY = 'mt-1 max-w-[60ch] text-sm text-ink-muted'
const INPUT =
  'h-11 w-full rounded-md border border-line-strong bg-surface px-3 font-mono text-sm text-ink placeholder:text-ink-subtle focus:border-accent'
const PRIMARY_BUTTON =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 text-sm font-semibold text-ink hover:bg-sunken'
const CODE = 'rounded bg-sunken px-1 py-0.5 font-mono text-xs text-ink'
const LINK = 'text-accent underline underline-offset-2'
const REASON = 'mt-3 max-w-[60ch] rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink'

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

function DatabaseIcon() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0 text-accent">
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13" />
      <path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
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

export default function ConnectDatabaseStep({ storage, sessionId, onDisconnect, disabledReason = null }: ConnectDatabaseStepProps): JSX.Element | null {
  const [value, setValue] = useState('')
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const inputId = `${baseId}-input`
  const helpId = `${baseId}-help`
  const reasonId = `${baseId}-reason`

  if (!storage.ready) return null

  if (!storage.available) {
    return (
      <section aria-labelledby={headingId} className={WRAPPER}>
        <h3 id={headingId} className={HEADING}>Make it permanent: connect your database</h3>
        <p className={BODY}>Connecting a database isn&apos;t available on this deployment.</p>
      </section>
    )
  }

  if (storage.connected) {
    const disconnect = () => {
      storage.disconnect()
      onDisconnect?.()
    }
    const migration = storage.lastMigration
    return (
      <section aria-labelledby={headingId} className={WRAPPER}>
        <h3 id={headingId} className={`${HEADING} flex items-start gap-2`}>
          <DatabaseIcon />
          Stored in your database.
        </h3>
        {migration && (
          <p className={BODY} role="status">
            {`Moved ${migration.documents} ${migration.documents === 1 ? 'document' : 'documents'} (${migration.chunks} ${migration.chunks === 1 ? 'chunk' : 'chunks'}) from this demo session.`}
          </p>
        )}
        <p className={BODY}>
          Generate new embed code below. Embed code made before connecting keeps working only until this server restarts.
        </p>
        {storage.error && <ErrorMessage message={storage.error.message} />}
        <div className="mt-4 flex flex-col items-start gap-2">
          <button type="button" onClick={disconnect} className={SECONDARY_BUTTON}>
            Disconnect this browser
          </button>
          <p className="max-w-[60ch] text-xs text-ink-muted">
            This forgets the link in this browser only. Nothing is deleted from your database. Connecting again from this
            browser may start a new, empty workspace; your earlier documents stay in your database. To keep adding to this
            one, stay connected. To cut off access, change the database user&apos;s password; that
            also stops every embed made with it.
          </p>
        </div>
      </section>
    )
  }

  const disabled = !!disabledReason

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const connectionString = value.trim()
    if (disabled || !connectionString || storage.connecting) return
    setValue('')
    await storage.connect(connectionString, sessionId)
  }

  return (
    <section aria-labelledby={headingId} className={WRAPPER}>
      <h3 id={headingId} className={HEADING}>Make it permanent: connect your database</h3>
      <p className={BODY}>
        Demo documents and widgets are deleted when this server restarts. Connect your own Postgres database with pgvector
        to keep them. Documents already in this session are moved across.
      </p>

      <details className="mt-4 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-muted">
        <summary className="cursor-pointer py-1 font-medium text-ink">Before you connect: run the setup SQL</summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pb-1 pl-5">
          <li>
            Turn on pgvector once, as an admin: <code className={CODE}>CREATE EXTENSION vector;</code>
          </li>
          <li>
            Run{' '}
            <a href={SCHEMA_SQL_URL} target="_blank" rel="noreferrer" className={LINK}>scripts/support-bot-schema.sql</a>{' '}
            to create the <code className={CODE}>support_bot</code> tables. It is safe to run twice.
          </li>
          <li>
            Optional: create a user that can only reach those tables with{' '}
            <a href={ROLE_SQL_URL} target="_blank" rel="noreferrer" className={LINK}>scripts/support-bot-role.sql</a>, and
            connect as that user. The README has the details.
          </li>
        </ol>
      </details>

      {disabledReason && <p id={reasonId} className={REASON}>{disabledReason}</p>}

      <form onSubmit={submit} className="mt-4">
        <fieldset disabled={disabled} aria-describedby={disabled ? reasonId : undefined} className="m-0 min-w-0 border-0 p-0">
          <label htmlFor={inputId} className="text-sm font-medium text-ink">Connection string</label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              name="pg-connection"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="postgresql://user:password@host:5432/database"
              aria-describedby={helpId}
              aria-invalid={storage.error ? true : undefined}
              className={`min-w-0 ${INPUT} disabled:cursor-not-allowed disabled:bg-sunken`}
            />
            <button type="submit" disabled={disabled || storage.connecting || value.trim() === ''} aria-busy={storage.connecting} className={PRIMARY_BUTTON}>
              {storage.connecting ? (
                <>
                  <Spinner />
                  Connecting
                </>
              ) : (
                'Connect'
              )}
            </button>
          </div>
          <p id={helpId} className="mt-1.5 text-xs text-ink-subtle">
            Sent to this server once to set up the link. The server does not save it; this browser keeps only an encrypted
            link to your database.
          </p>
        </fieldset>
      </form>

      {storage.error && !disabled && <ErrorMessage message={storage.error.message} />}
    </section>
  )
}
