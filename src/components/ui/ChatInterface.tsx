
'use client'

import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import MarkdownRenderer from './MarkdownRenderer'
import { ChatMessage, ChatInterfaceProps } from '@/types'

interface ChatResponse {
  message: string
  confidence: number
  sources: string[]
  isEnhanced: boolean
  sessionId: string
}

const ChatInterface = forwardRef<{ sendQuestion: (question: string) => void }, ChatInterfaceProps>(({ onShareResult, systemPrompt, roleContext, suggestedQuestions, onSessionUpdate, onGenerateWidget, hasUploadedFiles = false, sessionId: propSessionId = null, title = "Your Business AI Assistant", welcomeMessage = "I'm ready to answer questions about your business. Try asking something, then upload your documents to see how much smarter I become!" }, ref) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [lowConfidenceCount, setLowConfidenceCount] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Sync session ID from parent prop
  useEffect(() => {
    if (propSessionId) {
      console.log('🔄 ChatInterface received session ID from parent:', propSessionId)
      setSessionId(propSessionId)
    }
  }, [propSessionId])

  useEffect(() => {
    onSessionUpdate?.(sessionId, hasUploadedFiles)
  }, [sessionId, hasUploadedFiles, onSessionUpdate])

  // Expose the sendQuestion method to parent components
  useImperativeHandle(ref, () => ({
    sendQuestion: handleSuggestedQuestionClick
  }))

  const handleSendMessage = async () => {
    if (!inputValue.trim()) return

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: inputValue,
      sender: 'user',
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputValue('')
    setIsTyping(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: inputValue,
          sessionId: sessionId || undefined,
          systemPrompt: systemPrompt,
          roleContext: roleContext
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      const data: ChatResponse = await response.json()
      
      // Update session ID if we got a new one
      if (data.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId)
      }

      // Build well-formatted markdown response
      let messageText = 'Error: No message received'
      
      if (typeof data.message === 'string') {
        messageText = data.message
      } else if (data.message && typeof data.message === 'object') {
        const messageObj = data.message as any
        messageText = messageObj.answer || 
                     messageObj.text || 
                     messageObj.content || 
                     JSON.stringify(data.message)
      } else if (data.message) {
        messageText = String(data.message)
      }

      let formattedResponse = messageText

      // Add sources section if available and enhanced
      if (data.isEnhanced && data.sources && data.sources.length > 0) {
        const sourceList = data.sources
          .filter(source => source && source !== 'general_knowledge')
          .map(source => `📄 ${source}`)
          .join('\n')
        
        if (sourceList) {
          formattedResponse += `\n\n### 📚 Sources\n${sourceList}`
        }
      }

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: formattedResponse,
        sender: 'ai',
        confidence: data.confidence,
        sources: data.sources,
        isEnhanced: data.isEnhanced,
        timestamp: new Date()
      }

      setMessages(prev => [...prev, aiMessage])

      // Track low confidence responses
      if (data.confidence < 50) {
        setLowConfidenceCount(prev => prev + 1)
      }

    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: 'Sorry, I encountered an error. Please try again.',
        sender: 'ai',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsTyping(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleSuggestedQuestionClick = (question: string) => {
    setInputValue(question)
    setTimeout(() => handleSendMessage(), 100)
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl overflow-hidden shadow-lg">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
            <span className="text-xl">🤖</span>
          </div>
          <div>
            <h3 className="font-bold text-lg">{title}</h3>
            <p className="text-blue-100 text-sm">
              {hasUploadedFiles ? '⚡ Enhanced with your knowledge' : '💭 Ready to help'}
            </p>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="mb-8">
              <div className="text-6xl mb-4 animate-float">🤖</div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">
                Welcome to {title}
              </h3>
              <p className="text-gray-600 max-w-md mx-auto leading-relaxed">
                {welcomeMessage}
              </p>
            </div>
            
            {/* Suggested Questions */}
            {suggestedQuestions && suggestedQuestions.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-700 mb-3">Try asking:</p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {suggestedQuestions.map((question, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestedQuestionClick(question)}
                      className="bg-white border border-blue-200 text-blue-700 px-4 py-2 rounded-full text-sm hover:bg-blue-50 hover:border-blue-300 transition-all duration-200 hover:shadow-md"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${
              message.sender === 'user' ? 'justify-end' : 'justify-start'
            }`}
          >
            <div
              className={`max-w-[80%] p-4 rounded-2xl shadow-lg ${
                message.sender === 'user'
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'
                  : 'bg-white text-gray-900 border border-gray-200'
              }`}
            >
              <MarkdownRenderer content={message.text} />
              
              {message.sender === 'ai' && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center space-x-4">
                      {message.isEnhanced && (
                        <div className="flex items-center space-x-1 text-green-600 bg-green-50 px-2 py-1 rounded-full">
                          <span>⚡</span>
                          <span className="font-medium">Enhanced</span>
                        </div>
                      )}
                      {message.confidence && (
                        <div className={`flex items-center space-x-1 px-2 py-1 rounded-full ${
                          message.confidence > 70 ? 'bg-green-50 text-green-600' :
                          message.confidence > 50 ? 'bg-yellow-50 text-yellow-600' :
                          'bg-red-50 text-red-600'
                        }`}>
                          <span>{message.confidence > 70 ? '🎯' : message.confidence > 50 ? '⚠️' : '❌'}</span>
                          <span className="font-medium">{message.confidence}% confident</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-500 mb-2 font-medium">📚 Sources:</div>
                      <div className="flex flex-wrap gap-1">
                        {message.sources.map((source, index) => (
                          <span
                            key={index}
                            className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full border border-blue-200"
                          >
                            {source}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white text-gray-900 p-4 rounded-2xl max-w-[80%] shadow-lg border border-gray-200">
              <div className="flex items-center space-x-3">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span className="text-sm text-gray-600 font-medium">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Enhanced Status */}
      {hasUploadedFiles && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-l-4 border-green-400 p-4 mx-6 mb-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-sm text-green-700">
              <span className="text-lg">✅</span>
              <span><strong>Enhanced Mode Active</strong> - Providing answers from your documents</span>
            </div>
            {onGenerateWidget && (
              <button
                onClick={onGenerateWidget}
                className="bg-gradient-to-r from-yellow-400 to-orange-400 text-gray-900 px-4 py-2 rounded-lg font-bold hover:from-yellow-300 hover:to-orange-300 transition-all duration-200 flex items-center gap-2 text-sm shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
              >
                <span>🚀</span>
                Generate Code
              </button>
            )}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="border-t border-gray-200 p-4 bg-white">
        <div className="flex space-x-4">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasUploadedFiles 
              ? "Ask me anything about your business..." 
              : "Ask me anything (upload docs for better answers)..."
            }
            className="flex-1 p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 placeholder-gray-500"
            disabled={isTyping}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isTyping}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium transition-all duration-200 hover:shadow-lg transform hover:-translate-y-0.5 disabled:transform-none"
          >
            <span className="flex items-center gap-2">
              {isTyping ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Sending...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Send
                </>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  )
})

ChatInterface.displayName = 'ChatInterface'

export default ChatInterface 
