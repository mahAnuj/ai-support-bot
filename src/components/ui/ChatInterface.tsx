'use client'

import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import { ChatMessage, ChatInterfaceProps } from '@/types'

interface ChatResponse {
  message: unknown
  confidence?: number
  sources?: string[]
  isEnhanced?: boolean
  sessionId?: string
}

const primaryBg = 'bg-[var(--preview-primary,var(--color-accent))]'

const iconProps = {
  'aria-hidden': true,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
} as const

function ChatIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
    </svg>
  )
}

function DocumentIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  )
}

function FileIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </svg>
  )
}

function InfoIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  )
}

function AlertIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16h.01" />
    </svg>
  )
}

function ArrowIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg {...iconProps} className={className}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function extractAnswer(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const candidate = obj.answer ?? obj.text ?? obj.content
    return typeof candidate === 'string' ? candidate : JSON.stringify(value)
  }
  return value == null ? '' : String(value)
}

function errorTextFor(status: number, body: unknown): string {
  if (status === 429) {
    return 'Too many messages from this network in the last minute. Wait a minute and try again.'
  }
  if (status === 400) {
    const error = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined
    return `The message couldn't be sent: ${typeof error === 'string' ? error : 'invalid request'}.`
  }
  return `No answer. The server returned an error (status ${status}). If you run this app, check that OPENAI_API_KEY is set and valid.`
}

function documentSources(sources?: string[]): string[] {
  if (!sources) return []
  return Array.from(new Set(sources.filter(source => source && source !== 'general_knowledge')))
}

const aiBubble = 'self-start max-w-[85%] rounded-xl rounded-bl-sm border px-4 py-3 text-ink'

const ChatInterface = forwardRef<{ sendQuestion: (question: string) => void }, ChatInterfaceProps>(({
  systemPrompt,
  roleContext,
  suggestedQuestions,
  onSessionUpdate,
  hasUploadedFiles = false,
  sessionId: propSessionId = null,
  title = 'Your Business AI Assistant',
  welcomeMessage = 'Ask a question to see how the assistant answers.',
}, ref) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = logRef.current
    if (container && (messages.length > 0 || isTyping)) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages, isTyping])

  useEffect(() => {
    if (propSessionId) {
      setSessionId(propSessionId)
    }
  }, [propSessionId])

  useEffect(() => {
    onSessionUpdate?.(sessionId, hasUploadedFiles)
  }, [sessionId, hasUploadedFiles, onSessionUpdate])

  const addSystemMessage = (text: string) => {
    setMessages(prev => [...prev, {
      id: `${Date.now()}-system`,
      text,
      sender: 'system',
      timestamp: new Date(),
    }])
  }

  const sendMessage = async (raw?: string) => {
    const text = (raw ?? inputValue).trim()
    if (!text || isTyping) return

    setMessages(prev => [...prev, {
      id: `${Date.now()}-user`,
      text,
      sender: 'user',
      timestamp: new Date(),
    }])
    setInputValue('')
    setIsTyping(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionId || undefined,
          systemPrompt: systemPrompt,
          roleContext: roleContext,
        }),
      })

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        addSystemMessage(errorTextFor(response.status, body))
        return
      }

      const data = (await response.json()) as ChatResponse

      if (data.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId)
      }

      const answer = extractAnswer(data.message)
      if (!answer) {
        addSystemMessage('The server replied without an answer. Try asking again.')
        return
      }

      setMessages(prev => [...prev, {
        id: `${Date.now()}-ai`,
        text: answer,
        sender: 'ai',
        confidence: data.confidence,
        sources: data.sources,
        isEnhanced: data.isEnhanced,
        timestamp: new Date(),
      }])
    } catch {
      addSystemMessage("Couldn't reach the server. Check your connection and try again.")
    } finally {
      setIsTyping(false)
    }
  }

  useImperativeHandle(ref, () => ({
    sendQuestion: (question: string) => {
      void sendMessage(question)
    },
  }))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const renderAiFooter = (message: ChatMessage) => {
    const enhanced = message.isEnhanced === true
    const sources = documentSources(message.sources)
    if (!enhanced && sources.length === 0) return null

    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-xs text-ink-muted">
        {enhanced && (
          <span className="inline-flex items-center gap-1">
            <DocumentIcon />
            Used your documents
          </span>
        )}
        {enhanced && typeof message.confidence === 'number' && (
          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-sm">
              Match score {message.confidence}%
              <InfoIcon />
            </summary>
            <p className="mt-1 max-w-[40ch] text-xs text-ink-muted">
              How closely the retrieved passages match the question. It does not measure whether the answer is correct.
            </p>
          </details>
        )}
        {sources.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <span>Sources</span>
            <ul className="flex flex-wrap gap-2">
              {sources.map(source => (
                <li
                  key={source}
                  className="inline-flex max-w-[16rem] items-center gap-1 rounded-sm border border-line bg-sunken px-2 py-1 text-ink"
                >
                  <FileIcon className="size-4 shrink-0" />
                  <span className="truncate">{source}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    )
  }

  const renderMessage = (message: ChatMessage) => {
    if (message.sender === 'user') {
      return (
        <div key={message.id} className={`self-end max-w-[85%] rounded-xl rounded-br-sm px-4 py-2.5 text-white ${primaryBg}`}>
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
      )
    }

    if (message.sender === 'system') {
      return (
        <div key={message.id} className={`${aiBubble} border-danger/40 bg-danger-tint`}>
          <p className="flex items-center gap-1.5 font-semibold text-danger">
            <AlertIcon className="size-4 shrink-0" />
            Couldn&apos;t get an answer.
          </p>
          <p className="mt-1 text-sm">{message.text}</p>
        </div>
      )
    }

    return (
      <div key={message.id} className={`${aiBubble} border-line bg-surface`}>
        <MarkdownRenderer content={message.text} />
        {renderAiFooter(message)}
      </div>
    )
  }

  const canSend = inputValue.trim().length > 0 && !isTyping

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className={`flex items-center gap-3 px-4 py-3 text-white ${primaryBg}`}>
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15">
          <ChatIcon />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{title}</h3>
          <p className="text-xs text-white">
            {hasUploadedFiles ? 'Preview using your indexed documents' : 'Preview with no documents yet'}
          </p>
        </div>
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        className="flex flex-1 flex-col gap-4 overflow-y-auto bg-sunken p-4 sm:p-5"
      >
        <div className={`${aiBubble} border-line bg-surface`}>
          <p className="whitespace-pre-wrap">{welcomeMessage}</p>
        </div>

        {messages.length === 0 && suggestedQuestions && suggestedQuestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-ink-muted">Try asking</p>
            <div className="flex flex-wrap gap-2">
              {suggestedQuestions.map(question => (
                <button
                  key={question}
                  type="button"
                  onClick={() => void sendMessage(question)}
                  className="min-h-11 rounded-full border border-line-strong bg-surface px-4 text-left text-sm text-ink hover:bg-accent-tint"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(renderMessage)}

        {isTyping && (
          <div className={`${aiBubble} border-line bg-surface`}>
            <div className="flex items-center gap-3">
              <span className="flex gap-1" aria-hidden="true">
                <span className="size-1.5 rounded-full bg-ink-muted motion-safe:animate-bounce" />
                <span className="size-1.5 rounded-full bg-ink-muted motion-safe:animate-bounce [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-ink-muted motion-safe:animate-bounce [animation-delay:300ms]" />
              </span>
              <span className="text-sm text-ink-muted">Writing an answer</span>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-line bg-surface p-3">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Message"
          maxLength={2000}
          placeholder="Ask a question"
          className="h-11 w-full min-w-0 flex-1 scroll-mb-28 rounded-md border border-line-strong bg-surface px-3 text-base text-ink placeholder:text-ink-subtle focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void sendMessage()}
          disabled={!canSend}
          className={`inline-flex h-11 scroll-mb-28 items-center justify-center gap-2 rounded-md px-5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${primaryBg}`}
        >
          {isTyping ? (
            <>
              <span
                aria-hidden="true"
                className="size-4 rounded-full border-2 border-white border-t-transparent motion-safe:animate-spin"
              />
              <span className="sr-only">Sending</span>
            </>
          ) : (
            <>
              <ArrowIcon />
              Send
            </>
          )}
        </button>
      </div>
    </div>
  )
})

ChatInterface.displayName = 'ChatInterface'

export default ChatInterface
