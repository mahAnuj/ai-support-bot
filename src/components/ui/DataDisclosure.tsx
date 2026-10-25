import { useId } from 'react'
import type { AnswerPath } from '../../lib/connector/shared'

const iconProps = {
  'aria-hidden': true,
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function DocumentIcon() {
  return (
    <svg {...iconProps}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h6" />
    </svg>
  )
}

function QuestionIcon() {
  return (
    <svg {...iconProps}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
    </svg>
  )
}

function MemoryIcon() {
  return (
    <svg {...iconProps}>
      <rect x="4" y="4" width="16" height="7" rx="1.5" />
      <rect x="4" y="13" width="16" height="7" rx="1.5" />
      <path d="M8 7.5h.01M8 16.5h.01" />
    </svg>
  )
}

function LogIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
    </svg>
  )
}

const steps = [
  {
    icon: <DocumentIcon />,
    lead: 'Documents you upload',
    rest: ' are indexed on this server by an open-source embedding model. Their text is not sent anywhere to be indexed.',
  },
  {
    icon: <QuestionIcon />,
    lead: 'Each question',
    rest: ', including questions visitors ask through the widget on your site, is matched to passages on this server, then sent to Groq with those passages to write the answer. In this preview, Groq also rewords the question to widen the search.',
  },
  {
    icon: <MemoryIcon />,
    lead: 'Documents, passages and embeddings',
    rest: " are kept in this server's memory only. They are not saved to a database, are not shared between server instances, and are lost when the server restarts.",
  },
  {
    icon: <LogIcon />,
    lead: 'The server log',
    rest: ' records request diagnostics, such as filenames and the length of each question. The text of questions is not logged.',
  },
]

const GROQ_RETENTION_NOTE =
  "Groq may store the inputs and outputs of each request for up to 30 days, for reliability and compliance, unless Zero Data Retention is turned on for the deployment's Groq organisation."

export type OwnModelInfo = { model: string; host: string }

function OwnModelQuestionRest({ ownModel }: { ownModel: OwnModelInfo }) {
  return (
    <>
      , including questions visitors ask through the widget on your site, is matched to passages on this server. This
      server then sends the question and those passages to{' '}
      <span className="break-all font-mono text-xs text-ink">{ownModel.model}</span> at{' '}
      <span className="break-all font-mono text-xs text-ink">{ownModel.host}</span>, the provider you chose, instead of
      Groq, to write the answer. In this preview, that model also rewords the question to widen the search.
    </>
  )
}

const CONNECTED_MEMORY_REST = " are stored in your own database. The app keeps a link to it only in this browser and inside your embed code, encrypted with this server's key."

export const CONNECTOR_ANSWER_COPY: Record<AnswerPath, string> = {
  backend:
    'Your backend writes every answer. This app sends it the question and the matching passages; no model on this app is used and nothing goes to Groq.',
  owner: 'This app writes the answer with your own model, from the passages your backend returns.',
  demo: 'This app writes the answer with the demo model on Groq, from the passages your backend returns.',
}

export type ConnectorDisclosureInfo = { host: string; answerPath: AnswerPath }

function Mono({ children }: { children: string }) {
  return <span className="break-all font-mono text-xs text-ink">{children}</span>
}

function ConnectorStepRest({
  index,
  connector,
  ownModel,
}: {
  index: number
  connector: ConnectorDisclosureInfo
  ownModel: OwnModelInfo | null
}) {
  if (index === 0) {
    return (
      <>
        {' '}
        are read and split into passages on this server, then sent to your backend at <Mono>{connector.host}</Mono>.
        This server keeps no copy after the request.
      </>
    )
  }
  if (index === 1) {
    return (
      <>
        , including questions visitors ask through the widget on your site, is sent as typed from this server to your
        backend to find matching passages, with no rewording. {CONNECTOR_ANSWER_COPY[connector.answerPath]}
        {connector.answerPath === 'owner' && ownModel && (
          <>
            {' '}
            The question and those passages go to <Mono>{ownModel.model}</Mono> at <Mono>{ownModel.host}</Mono>.
          </>
        )}
      </>
    )
  }
  if (index === 2) return <> are kept by your backend, not on this server.</>
  return (
    <>
      {' '}
      records one line per backend call: the operation, a fingerprint of your backend&apos;s address, the outcome and the
      time taken. It never records the address, the signing secret, questions or passages. Uploads also log filenames.
    </>
  )
}

export default function DataDisclosure({
  className,
  connected,
  ownModel = null,
  connector = null,
}: {
  className?: string
  connected?: boolean
  ownModel?: OwnModelInfo | null
  connector?: ConnectorDisclosureInfo | null
}) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className={`rounded-lg border border-accent/20 bg-accent-tint p-4 sm:p-5${className ? ` ${className}` : ''}`}
    >
      <h3 id={headingId} className="text-base font-semibold text-ink">
        Where your data goes
      </h3>
      <ol className="mt-4 flex flex-col gap-4">
        {steps.map((step, index) => (
          <li key={step.lead} className="relative flex items-start gap-3">
            {index < steps.length - 1 && (
              <span aria-hidden="true" className="absolute top-7 -bottom-4 left-[13px] w-0.5 bg-accent/30" />
            )}
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-accent/40 bg-surface text-accent">
              {step.icon}
            </span>
            <p className="pt-0.5 text-sm text-ink-muted">
              <strong className="font-semibold text-ink">{step.lead}</strong>
              {connector ? (
                <ConnectorStepRest index={index} connector={connector} ownModel={ownModel} />
              ) : ownModel && index === 1 ? (
                <OwnModelQuestionRest ownModel={ownModel} />
              ) : connected && index === 2 ? (
                CONNECTED_MEMORY_REST
              ) : (
                step.rest
              )}
            </p>
          </li>
        ))}
      </ol>
      {connector ? (
        <>
          <p className="mt-4 text-sm text-ink-muted">
            Your backend&apos;s address, key id and signing secret are kept only encrypted with this server&apos;s key, in
            this browser and inside your embed code. Anyone who has one of these tokens and this server&apos;s key can
            recover the secret and use it as this app does, including to add or delete documents on your backend. To
            revoke it, remove the key id from <Mono>CONNECTOR_KEYS</Mono> on your backend.
          </p>
          {connector.answerPath === 'owner' && ownModel && (
            <p className="mt-2 text-sm text-ink-muted">
              Your model API key is stored only encrypted with this server&apos;s key, in this browser and inside your
              embed code. The server does not log or save it.
            </p>
          )}
          {connector.answerPath === 'demo' ? (
            <p className="mt-2 text-xs text-ink-muted">{GROQ_RETENTION_NOTE}</p>
          ) : connector.answerPath === 'owner' ? (
            <p className="mt-2 text-xs text-ink-muted">Your provider&apos;s data retention policy applies.</p>
          ) : (
            <p className="mt-2 text-xs text-ink-muted">What your backend keeps and logs is up to your backend.</p>
          )}
        </>
      ) : ownModel ? (
        <>
          <p className="mt-4 text-sm text-ink-muted">
            Your API key is stored only encrypted with this server&apos;s key, in this browser and inside your embed code.
            The server does not log or save it.
          </p>
          <p className="mt-2 text-xs text-ink-muted">Your provider&apos;s data retention policy applies.</p>
        </>
      ) : (
        <p className="mt-4 text-xs text-ink-muted">{GROQ_RETENTION_NOTE}</p>
      )}
    </section>
  )
}
