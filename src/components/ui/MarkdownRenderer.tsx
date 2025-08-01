import React from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  content: string
  className?: string
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  // Ensure content is always a string
  const safeContent = typeof content === 'string' ? content : String(content || '')
  // Custom components for markdown rendering
  const components: Components = {
    // Headings
    h1: ({ children }) => (
      <h1 className="text-xl font-bold text-gray-900 mb-3 mt-2">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-lg font-semibold text-gray-900 mb-2 mt-2">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-base font-semibold text-gray-900 mb-2 mt-2">{children}</h3>
    ),
    
    // Paragraphs
    p: ({ children }) => (
      <p className="mb-3 leading-relaxed">{children}</p>
    ),
    
    // Lists
    ol: ({ children }) => (
      <ol className="list-decimal list-inside mb-3 space-y-1 ml-4">{children}</ol>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-inside mb-3 space-y-1 ml-4">{children}</ul>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed">{children}</li>
    ),
    
    // Emphasis
    strong: ({ children }) => (
      <strong className="font-semibold text-gray-900">{children}</strong>
    ),
    em: ({ children }) => (
      <em className="italic text-gray-700">{children}</em>
    ),
    
    // Code
    code: ({ children, className }) => {
      const isInline = !className
      if (isInline) {
        return (
          <code className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-sm font-mono">
            {children}
          </code>
        )
      }
      return (
        <code className="block bg-gray-100 text-gray-800 p-3 rounded-lg text-sm font-mono overflow-x-auto mb-3">
          {children}
        </code>
      )
    },
    
    // Pre (code blocks)
    pre: ({ children }) => (
      <pre className="bg-gray-100 text-gray-800 p-3 rounded-lg text-sm font-mono overflow-x-auto mb-3">
        {children}
      </pre>
    ),
    
    // Blockquotes
    blockquote: ({ children }) => (
      <blockquote className="border-l-4 border-blue-200 pl-4 py-2 mb-3 italic text-gray-700 bg-blue-50">
        {children}
      </blockquote>
    ),
    
    // Links
    a: ({ href, children }) => (
      <a 
        href={href} 
        target="_blank" 
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-800 underline"
      >
        {children}
      </a>
    ),
    
    // Horizontal rules
    hr: () => (
      <hr className="border-gray-300 my-4" />
    ),
    
    // Tables
    table: ({ children }) => (
      <div className="overflow-x-auto mb-3">
        <table className="min-w-full border border-gray-300 rounded-lg">
          {children}
        </table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-gray-300 bg-gray-50 px-3 py-2 text-left font-semibold">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="border border-gray-300 px-3 py-2">
        {children}
      </td>
    ),
  }

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown components={components}>
        {safeContent}
      </ReactMarkdown>
    </div>
  )
}

export default MarkdownRenderer 