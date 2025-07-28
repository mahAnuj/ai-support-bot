'use client'

import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react'
import FileUpload from './FileUpload'
import MarkdownRenderer from './MarkdownRenderer'
import { ChatMessage, ChatInterfaceProps } from '@/types'

interface ChatResponse {
  message: string
  confidence: number
  sources: string[]
  isEnhanced: boolean
  sessionId: string
}

const ChatInterface = forwardRef<{ sendQuestion: (question: string) => void }, ChatInterfaceProps>(({ onShareResult, systemPrompt, roleContext, suggestedQuestions, onSessionUpdate }, ref) => {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [sessionId, setSessionId] = useState<string>('')
  const [hasUploadedFiles, setHasUploadedFiles] = useState(false)
  const [showUploadPrompt, setShowUploadPrompt] = useState(false)
  const [lowConfidenceCount, setLowConfidenceCount] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Notify parent of session state changes
  useEffect(() => {
    onSessionUpdate?.(sessionId || null, hasUploadedFiles)
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

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: data.message,
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

  const handleFileUpload = async (files: File[]) => {
    setIsUploading(true)
    setUploadProgress(0)

    try {
      const formData = new FormData()
      files.forEach(file => formData.append('files', file))
      
      if (sessionId) {
        formData.append('sessionId', sessionId)
      }

      // Simulate progress for better UX
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => Math.min(prev + 5, 85))
      }, 300)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      clearInterval(progressInterval)
      setUploadProgress(100)

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      const result = await response.json()
      
      // Update session ID if we got a new one
      if (result.sessionId && result.sessionId !== sessionId) {
        setSessionId(result.sessionId)
      }

      setHasUploadedFiles(true)

      // Add a system message showing upload success
      const uploadMessage: ChatMessage = {
        id: Date.now().toString(),
        text: `✅ Successfully processed ${result.details.documentsProcessed} document(s) with ${result.details.totalChunks} knowledge chunks. Your responses will now be enhanced with this information!`,
        sender: 'system',
        isEnhanced: true,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, uploadMessage])

      // Small delay to show completion state
      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
      }, 500)

    } catch (error) {
      console.error('Upload error:', error)
      setIsUploading(false)
      setUploadProgress(0)
      
      // Better error messaging based on error type
      let errorText = '❌ Failed to upload documents. Please try again.'
      if (error instanceof Error) {
        if (error.message.includes('PDF')) {
          errorText = '❌ Failed to process PDF file. Please ensure the PDF is not corrupted and try again.'
        } else if (error.message.includes('size')) {
          errorText = '❌ File too large. Please upload files smaller than 10MB.'
        } else if (error.message.includes('type')) {
          errorText = '❌ Unsupported file type. Please upload PDF, TXT, or DOCX files.'
        }
      }
      
      const errorMessage: ChatMessage = {
        id: Date.now().toString(),
        text: errorText,
        sender: 'system',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const handleSuggestedQuestionClick = async (question: string) => {
    // Set the input value and send immediately
    setInputValue(question)
    
    // Create a user message directly
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      text: question,
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
          message: question,
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

      const aiMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        text: data.message,
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

  return (
    <div className="flex flex-col h-full bg-white">

      {/* Compact Document Upload Section */}
      <div className="bg-blue-50 border-b border-blue-200 p-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-blue-600">📚</div>
            <div>
              <h3 className="text-sm font-medium text-blue-900">
                Upload Documents to Enhance AI
                {hasUploadedFiles && <span className="text-green-600 ml-2">✅ Enhanced</span>}
              </h3>
              <p className="text-xs text-blue-600">
                Add PDF, TXT, DOCX files for specific answers
                {sessionId && <span className="ml-2 text-gray-500">• Session: {sessionId.slice(0, 8)}...</span>}
              </p>
            </div>
          </div>
          <div className="flex-shrink-0">
            <FileUpload 
              onUpload={handleFileUpload}
              isProcessing={isUploading}
              progress={uploadProgress}
              isComplete={false}
              compact={true}
            />
          </div>
        </div>
      </div>

      

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-8">
            <div className="text-6xl mb-4">🤖</div>
            <h2 className="text-xl font-semibold mb-2">Try asking me anything!</h2>
            <p className="text-sm mb-4">
              Start with a question, then upload documents above to see how responses improve
            </p>
            
            {suggestedQuestions && suggestedQuestions.length > 0 && (
              <div className="mt-6 max-w-md mx-auto">
                <p className="text-sm font-medium text-gray-700 mb-3">💡 Try these questions:</p>
                <div className="space-y-2">
                  {suggestedQuestions.map((question, index) => (
                    <button
                      key={index}
                      onClick={() => handleSuggestedQuestionClick(question)}
                      className="w-full p-3 text-left bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-sm text-blue-800 transition-colors duration-200 hover:shadow-sm"
                    >
                      "{question}"
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  Click any question to ask it automatically
                </p>
              </div>
            )}
          </div>
        )}
        
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.sender === 'user'
                  ? 'bg-blue-600 text-white'
                  : message.isEnhanced
                  ? 'bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 text-gray-800'
                  : 'bg-gray-100 text-gray-800'
              }`}
              data-testid={message.isEnhanced ? 'enhanced-message' : undefined}
            >
              {message.sender === 'user' ? (
                <div className="whitespace-pre-wrap">{message.text}</div>
              ) : (
                <MarkdownRenderer content={message.text} />
              )}
              
              {/* Enhancement indicators */}
              {message.sender === 'ai' && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {message.confidence !== undefined && (
                    <span className={`px-2 py-1 rounded ${
                      message.confidence >= 80 
                        ? 'bg-green-100 text-green-700'
                        : message.confidence >= 50
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-red-100 text-red-700'
                    }`}>
                      {message.confidence}% confidence
                    </span>
                  )}
                  
                  {message.isEnhanced && (
                    <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded">
                      ✨ Enhanced
                    </span>
                  )}
                  
                  {message.sources && message.sources.length > 0 && (
                    <span className="text-gray-500">
                      📄 Sources: {message.sources.join(', ')}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-800 p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <span>Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {showUploadPrompt && (
          <div className="flex justify-center">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 max-w-md text-center">
              <div className="text-2xl mb-2">💡</div>
              <p className="text-yellow-800 text-sm mb-3">
                I notice my responses are quite generic. Upload your documents to get more specific, accurate answers!
              </p>
              <FileUpload 
                onUpload={handleFileUpload}
                isProcessing={isUploading}
                progress={uploadProgress}
              />
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-4 flex-shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            className="flex-1 p-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isTyping}
          />
          <button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isTyping}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isTyping ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
})

ChatInterface.displayName = 'ChatInterface'

export default ChatInterface 