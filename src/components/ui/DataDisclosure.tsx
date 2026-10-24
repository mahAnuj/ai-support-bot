import { useId } from 'react'

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

export default function DataDisclosure({ className }: { className?: string }) {
  const headingId = useId()

  return (
    <div
      aria-labelledby={headingId}
      className={`rounded-lg bg-accent-tint p-4 sm:p-5${className ? ` ${className}` : ''}`}
    >
      <h3 id={headingId} className="text-base font-semibold text-ink">
        Where your data goes
      </h3>
      <ol className="mt-4 flex flex-col gap-4">
        {steps.map((step, index) => (
          <li key={step.lead} className="relative flex items-start gap-3">
            {index < steps.length - 1 && (
              <span aria-hidden="true" className="absolute top-7 -bottom-4 left-[13px] w-0.5 bg-accent" />
            )}
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-accent bg-white text-accent">
              {step.icon}
            </span>
            <p className="pt-0.5 text-sm text-ink-muted">
              <strong className="font-semibold text-ink">{step.lead}</strong>
              {step.rest}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-ink-muted">Groq may store the inputs and outputs of each request for up to 30 days, for reliability and compliance, unless Zero Data Retention is turned on for the deployment's Groq organisation.</p>
    </div>
  )
}
