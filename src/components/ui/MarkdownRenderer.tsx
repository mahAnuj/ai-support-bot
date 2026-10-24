import React from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Root } from 'mdast'

interface MarkdownRendererProps {
  content: string
  className?: string
}

type MdNode = { type: string; value?: string; children?: MdNode[] }

const BR_TAG = /^<br\s*\/?>$/i
const FLOW_PARENTS = new Set(['root', 'listItem', 'blockquote', 'footnoteDefinition'])

// react-markdown shows raw HTML as literal text; keep <br> as a real break and drop every other tag.
function sanitizeHtmlNodes(parent: MdNode) {
  if (!parent.children) return
  const isFlow = FLOW_PARENTS.has(parent.type)
  const next: MdNode[] = []
  for (const child of parent.children) {
    if (child.type === 'html') {
      const raw = child.value ?? ''
      if (isFlow) {
        const text = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim()
        if (text) next.push({ type: 'paragraph', children: [{ type: 'text', value: text }] })
      } else if (BR_TAG.test(raw.trim())) {
        next.push({ type: 'break' })
      }
      continue
    }
    sanitizeHtmlNodes(child)
    next.push(child)
  }
  parent.children = next
}

function remarkSafeHtml() {
  return (tree: Root) => {
    sanitizeHtmlNodes(tree as unknown as MdNode)
  }
}

const remarkPlugins = [remarkGfm, remarkSafeHtml]

const majorHeading = 'not-first:mt-4 text-base font-semibold text-ink'
const minorHeading = 'not-first:mt-4 text-sm font-semibold text-ink'

const components: Components = {
  // Answers sit under the chat title (h3), so markdown headings are demoted to keep the outline intact.
  h1: ({ children }) => <h4 className={majorHeading}>{children}</h4>,
  h2: ({ children }) => <h4 className={majorHeading}>{children}</h4>,
  h3: ({ children }) => <h5 className={minorHeading}>{children}</h5>,
  h4: ({ children }) => <h5 className={minorHeading}>{children}</h5>,
  h5: ({ children }) => <h5 className={minorHeading}>{children}</h5>,
  h6: ({ children }) => <h5 className={minorHeading}>{children}</h5>,

  p: ({ children }) => <p>{children}</p>,

  ol: ({ children }) => (
    <ol className="list-decimal space-y-1.5 pl-5 marker:text-ink-muted">{children}</ol>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-1.5 pl-5 marker:text-ink-subtle">{children}</ul>
  ),
  li: ({ children }) => (
    <li className="[&>ol]:mt-1.5 [&>p]:m-0 [&>ul]:mt-1.5">{children}</li>
  ),

  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => <del className="line-through">{children}</del>,

  input: ({ type, checked }) => (
    <input type={type} checked={checked} disabled readOnly className="mr-1.5 align-middle" />
  ),

  // Block code is reset inside <pre> by the .markdown-content rule in globals.css.
  code: ({ children }) => (
    <code className="rounded-sm border border-line bg-sunken px-1 font-mono text-[0.875em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-md bg-code-bg p-3 font-mono text-sm text-code-ink"
    >
      {children}
    </pre>
  ),

  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-line-strong pl-3 text-ink-muted">{children}</blockquote>
  ),

  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-accent underline underline-offset-2 hover:text-accent-strong"
    >
      {children}
    </a>
  ),

  hr: () => <hr className="border-line" />,

  table: ({ children }) => (
    <div
      role="region"
      aria-label="Table"
      tabIndex={0}
      className="max-w-full overflow-x-auto rounded-md border border-line"
    >
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children, style }) => (
    <th
      style={style}
      className="border-b border-line bg-sunken px-3 py-2 text-left align-bottom font-semibold"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={style}
      className="min-w-24 border-t border-line px-3 py-2 align-top [overflow-wrap:normal] break-words"
    >
      {children}
    </td>
  ),
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const safeContent = typeof content === 'string' ? content : String(content || '')

  return (
    <div
      className={`markdown-content min-w-0 text-[0.9375rem]/relaxed [overflow-wrap:anywhere] [&>*+*]:mt-3 ${className}`}
    >
      <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
        {safeContent}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer
