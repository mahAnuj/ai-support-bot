'use client'

import { useId, useState, type FormEvent, type JSX } from 'react'
import type { StorageConnection } from './useStorageConnection'
import AutomationKeys from './AutomationKeys'
import DatabaseLogin from './DatabaseLogin'
import YourAssistants from './YourAssistants'
import ConversationLog from './ConversationLog'

export interface ConnectDatabaseStepProps {
  storage: StorageConnection
  sessionId: string | null
  // Demo documents this browser uploaded, to check the copy on Connect brought them all
  sessionDocumentCount?: number
  onDisconnect?: () => void
  // When set, the form is shown disabled with this one-line reason.
  disabledReason?: string | null
  // The model connected under "Use your own model", if any, for "Your assistants".
  ownModel?: { token: string; model: string; host: string } | null
  // The suggested questions set in the builder, to pre-fill "Your assistants".
  builderStarters?: readonly string[]
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
const SETUP_DOCS = '/docs/database'
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

export default function ConnectDatabaseStep({ storage, sessionId, sessionDocumentCount = 0, onDisconnect, disabledReason = null, ownModel = null, builderStarters = [] }: ConnectDatabaseStepProps): JSX.Element | null {
  const [expectedCopies, setExpectedCopies] = useState(0)
  const [value, setValue] = useState('')
  const [secure, setSecure] = useState(true)
  const baseId = useId()
  const headingId = `${baseId}-heading`
  const inputId = `${baseId}-input`
  const helpId = `${baseId}-help`
  const secureId = `${baseId}-secure`
  const secureHelpId = `${baseId}-secure-help`
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
        <DatabaseLogin requestHeaders={storage.requestHeaders} onReconnect={disconnect} />
        {migration && (
          <div className={BODY} role="status">
            {migration.setup?.status === 'created' && (
              <p className="font-medium text-ink">
                {`Secured: this assistant uses its own login, ${migration.setup.role}, which can reach only its own tables. The login you entered was used once and not saved.`}
              </p>
            )}
            {migration.setup?.status === 'not_possible' && (
              <p className="font-medium text-ink">
                Couldn&apos;t create a limited login, so this assistant uses the login you entered. To limit it, follow the{' '}
                <a href={SETUP_DOCS} className={LINK}>manual setup</a>.
              </p>
            )}
            {migration.reopened && (
              <p>{`Reopened the assistant already in this database (${migration.existing} ${migration.existing === 1 ? 'document' : 'documents'}).`}</p>
            )}
            {migration.documents > 0 && (
              <p>{`Moved ${migration.documents} ${migration.documents === 1 ? 'document' : 'documents'} (${migration.chunks} ${migration.chunks === 1 ? 'chunk' : 'chunks'}) from this demo session.`}</p>
            )}
            {migration.skipped > 0 && (
              <p>{`Kept the database's copy of ${migration.skipped} ${migration.skipped === 1 ? 'file' : 'files'} with the same name.`}</p>
            )}
            {expectedCopies > migration.documents + migration.skipped && (
              <p className="font-medium text-ink">
                {`${expectedCopies - migration.documents - migration.skipped} of your demo documents could not be copied, because the server that indexed them did not handle this request. Upload them again: a file with the same name replaces the old one, so nothing is duplicated.`}
              </p>
            )}
          </div>
        )}
        <p className={BODY}>
          Generate new embed code below. Embed code made before connecting keeps working only until this server restarts.
        </p>
        {storage.error && <ErrorMessage message={storage.error.message} />}
        <YourAssistants requestHeaders={storage.requestHeaders} ownModel={ownModel} builderStarters={builderStarters} />
        <ConversationLog requestHeaders={storage.requestHeaders} />
        <AutomationKeys requestHeaders={storage.requestHeaders} />
        <div className="mt-4 flex flex-col items-start gap-2">
          <button type="button" onClick={disconnect} className={SECONDARY_BUTTON}>
            Disconnect this browser
          </button>
          <p className="max-w-[60ch] text-xs text-ink-muted">
            This forgets the link in this browser only. Nothing is deleted from your database, and connecting it again,
            here or in another browser, reopens this assistant with its documents. To cut off access, change the
            database user&apos;s password; that also stops every embed and automation key made with it.
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
    setExpectedCopies(sessionDocumentCount)
    await storage.connect(connectionString, sessionId, { secureSetup: secure })
  }

  return (
    <section aria-labelledby={headingId} className={WRAPPER}>
      <h3 id={headingId} className={HEADING}>Make it permanent: connect your database</h3>
      <p className={BODY}>
        Demo documents and widgets are deleted when this server restarts. Connect your own Postgres database with pgvector
        to keep them. Documents already in this session are moved across.
      </p>

      <details className="mt-4 rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink-muted">
        <summary className="cursor-pointer py-1 font-medium text-ink">Which login should I use?</summary>
        <div className="mt-2 flex flex-col gap-2 pb-1">
          <p>
            Your admin login, such as <code className={CODE}>neondb_owner</code> on Neon or <code className={CODE}>postgres</code> on
            Supabase, with the box below ticked. The assistant then sets everything up itself: it turns on pgvector if needed,
            creates its <code className={CODE}>support_bot</code> tables, and creates its own login that can reach only those
            tables. Only that login is kept.
          </p>
          <p>
            Prefer to do it yourself, or your login can&apos;t create other logins? Follow the{' '}
            <a href={SETUP_DOCS} className={LINK}>manual setup</a>{' '}
            (<a href={SCHEMA_SQL_URL} target="_blank" rel="noreferrer" className={LINK}>schema SQL</a>,{' '}
            <a href={ROLE_SQL_URL} target="_blank" rel="noreferrer" className={LINK}>role SQL</a>) and connect with the limited login.
          </p>
        </div>
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
          <div className="mt-3 flex items-start gap-2">
            <input
              id={secureId}
              type="checkbox"
              checked={secure}
              onChange={e => setSecure(e.target.checked)}
              aria-describedby={secureHelpId}
              className="mt-1 h-4 w-4 shrink-0 accent-accent"
            />
            <div>
              <label htmlFor={secureId} className="text-sm font-medium text-ink">Create a limited login for the assistant (recommended)</label>
              <p id={secureHelpId} className="text-xs text-ink-subtle">
                Keeps your admin password out of the embed code and automation keys.{' '}
                <a href={SETUP_DOCS} className={LINK}>How it works</a>
              </p>
            </div>
          </div>
        </fieldset>
      </form>

      {storage.error && !disabled && <ErrorMessage message={storage.error.message} />}
    </section>
  )
}
