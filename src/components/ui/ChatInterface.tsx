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

  // Notify parent of session state changes
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
          sessionId: sessionId || undefined, // Send undefined instead of empty string
          systemPrompt: systemPrompt,
          roleContext: roleContext
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      const data: ChatResponse = await response.json()
      
      console.log('📨 Received API response:', data)
      console.log('💬 Message field:', data.message)
      
      // Update session ID if we got a new one
      if (data.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId)
      }

      // Build well-formatted markdown response
      let messageText = 'Error: No message received'
      
      if (typeof data.message === 'string') {
        messageText = data.message
      } else if (data.message && typeof data.message === 'object') {
        // If it's an object, try to extract text from common properties
        const messageObj = data.message as any
        messageText = messageObj.answer || 
                     messageObj.text || 
                     messageObj.content || 
                     JSON.stringify(data.message)
      } else if (data.message) {
        messageText = String(data.message)
      }

      // Use the properly formatted markdown response from OpenAI directly
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
      
      console.log('📝 Final formatted response:', formattedResponse)

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

      // Track low confidence responses (removed smart upload logic)
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

  const simulateTyping = async (message: string, setCurrentMessage: React.Dispatch<React.SetStateAction<string>>) => {
    const words = message.split(' ')
    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      setCurrentMessage(words.slice(0, i + 1).join(' '))
    }
  }

  const handleSuggestedQuestionClick = (question: string) => {
    setInputValue(question)
    handleSendMessage()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="mb-6">
              <div className="text-6xl mb-4">🤖</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {title}
              </h3>
              <p className="text-gray-600 max-w-md mx-auto">
                {welcomeMessage}
              </p>
            </div>
            

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
              className={`max-w-[80%] p-4 rounded-lg ${
                message.sender === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}
            >
              <MarkdownRenderer content={message.text} />
              
              {message.sender === 'ai' && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center space-x-4">
                      {message.isEnhanced && (
                        <div className="flex items-center space-x-1 text-green-600">
                          <span>⚡</span>
                          <span>Enhanced with your docs</span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-2">
                      <div className="text-xs text-gray-500 mb-1">📚 Sources:</div>
                      <div className="flex flex-wrap gap-1">
                        {message.sources.map((source, index) => (
                          <span
                            key={index}
                            className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded"
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
            <div className="bg-gray-100 text-gray-900 p-4 rounded-lg max-w-[80%]">
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span className="text-sm text-gray-600">AI is thinking...</span>
              </div>
            </div>
          </div>
        )}



        <div ref={messagesEndRef} />
      </div>

      {/* Enhanced Status */}
      {hasUploadedFiles && (
        <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-sm text-green-700">
              <span>✅</span>
              <span><strong>Enhanced Mode Active</strong> - I can now provide specific answers from your documents</span>
            </div>
            {onGenerateWidget && (
              <button
                onClick={onGenerateWidget}
                className="bg-yellow-400 text-gray-900 px-4 py-2 rounded-lg font-bold hover:bg-yellow-300 transition-colors flex items-center gap-2 text-sm animate-pulse"
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
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            placeholder={hasUploadedFiles 
              ? "Ask me anything about your business..." 
              : "Ask me anything (upload docs for better answers)..."
            }
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            disabled={isTyping}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isTyping}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
})

ChatInterface.displayName = 'ChatInterface'

export default ChatInterface 