'use client'

import { useState, type JSX } from 'react'

// A dark code block with a copy button, for the setup guide.
export default function CodeBlock({ code, label }: { code: string; label: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // The text stays selectable to copy by hand.
    }
  }
  return (
    <div className="relative mt-3 min-w-0">
      <pre className="max-h-[28rem] overflow-auto rounded-md bg-code-bg p-4 pr-20 font-mono text-xs leading-relaxed text-code-ink">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className="absolute right-2 top-2 rounded border border-hero-line bg-hero px-2 py-1 text-xs font-medium text-hero-ink hover:bg-accent-strong"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
