import React from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  content: string
  className?: string
}

const majorHeading = 'mt-3 mb-1.5 text-base font-semibold text-ink'
const minorHeading = 'mt-3 mb-1 text-sm font-semibold text-ink'

const components: Components = {
  // Answers sit under the chat title (h3), so markdown headings are demoted to keep the outline intact.
  h1: ({ children }) => <h4 className={majorHeading}>{children}</h4>,
  h2: ({ children }) => <h4 className={majorHeading}>{children}</h4>,
  h3: ({ children }) => <h5 className={minorHeading}>{children}</h5>,
  h4: ({ children }) => <h5 className={minorHeading}>{children}</h5>,
  h5: ({ children }) => <h5 className={minorHeading}>{children}</h5>,
  h6: ({ children }) => <h5 className={minorHeading}>{children}</h5>,

  p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,

  ol: ({ children }) => <ol className="mb-3 ml-5 list-decimal space-y-1">{children}</ol>,
  ul: ({ children }) => <ul className="mb-3 ml-5 list-disc space-y-1">{children}</ul>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  // Block code is reset inside <pre> by the .markdown-content rule in globals.css.
  code: ({ children }) => (
    <code className="rounded-sm border border-line bg-sunken px-1 font-mono text-[0.875em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 overflow-x-auto rounded-md bg-code-bg p-3 font-mono text-sm text-code-ink">
      {children}
    </pre>
  ),

  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-line-strong pl-3 text-ink-muted">
      {children}
    </blockquote>
  ),

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2 hover:text-accent-strong"
    >
      {children}
    </a>
  ),

  hr: () => <hr className="my-4 border-line" />,

  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto">
      <table className="min-w-full border border-line text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line bg-sunken px-3 py-2 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-line px-3 py-2">{children}</td>,
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const safeContent = typeof content === 'string' ? content : String(content || '')

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown components={components}>{safeContent}</ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer
