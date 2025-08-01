'use client'

import React, { useState, useEffect, useRef } from 'react'
import ChatInterface from '@/components/ui/ChatInterface'
import FileUpload from '@/components/ui/FileUpload'

// Assistant configurations
const UNIVERSAL_ASSISTANT = {
  systemPrompt: "You are a professional business AI assistant. Provide accurate, helpful responses based on the uploaded business documents. If you don't have specific information from the documents, provide general business guidance while noting that more specific answers could be provided with relevant documentation.",
  suggestedQuestions: [
    "What services does our company offer?",
    "What are our business hours?",
    "How can customers contact support?",
    "What is our return policy?"
  ]
}

export default function HomePage() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [uploadedDocuments, setUploadedDocuments] = useState<Array<{filename: string, chunks: number, uploadedAt: string}>>([])
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadComplete, setUploadComplete] = useState(false)
  const [widgetCode, setWidgetCode] = useState<string | null>(null)
  const [isGeneratingWidget, setIsGeneratingWidget] = useState(false)
  const [showGeneratedCodeDialog, setShowGeneratedCodeDialog] = useState(false)
  const [widgetConfig, setWidgetConfig] = useState({
    name: 'Business Support Assistant',
    title: 'AI Support Assistant', 
    welcome_message: 'Hi! I\'m your AI assistant. I can help answer questions about our business. How can I assist you today?',
    primary_color: '#3B82F6',
    position: 'bottom-right' as 'bottom-right' | 'bottom-left',
    size: 'medium' as 'small' | 'medium' | 'large'
  })
  const chatRef = useRef<any>(null)

  // Derived state - hasUploadedFiles is true when there are documents in the current session
  const hasUploadedFiles = uploadedDocuments.length > 0

  const handleFileUpload = async (files: File[]) => {
    setIsUploading(true)
    setUploadProgress(0)
    setUploadComplete(false)

    const formData = new FormData()
    files.forEach(file => formData.append('files', file))

    if (sessionId) {
      formData.append('sessionId', sessionId)
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      const result = await response.json()

      if (result.sessionId && result.sessionId !== sessionId) {
        setSessionId(result.sessionId)
      }

      if (result.documents) {
        setUploadedDocuments(result.documents)
      }

      setUploadProgress(100)
      setUploadComplete(true)

    } catch (error) {
      console.error('Error uploading files:', error)
    } finally {
      setIsUploading(false)
    }
  }

  const handleSessionUpdate = (newSessionId: string | null, hasFiles: boolean) => {
    if (newSessionId && newSessionId !== sessionId) {
      setSessionId(newSessionId)
    }
  }

  const generateWidget = async () => {
    if (!sessionId) {
      alert('Please upload documents first to generate a widget.')
      return
    }

    setIsGeneratingWidget(true)
    try {
      const response = await fetch('/api/widget/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          sessionId,
          config: widgetConfig
        }),
      })

      if (!response.ok) throw new Error('Failed to generate widget')

      const result = await response.json()
      setWidgetCode(result.code)
      setShowGeneratedCodeDialog(true)
    } catch (error) {
      console.error('Error generating widget:', error)
      alert('Failed to generate widget. Please try again.')
    } finally {
      setIsGeneratingWidget(false)
    }
  }

  const copyToClipboard = async () => {
    if (!widgetCode) return
    try {
      await navigator.clipboard.writeText(widgetCode)
      alert('Script copied to clipboard!')
    } catch (error) {
      console.error('Failed to copy:', error)
      alert('Failed to copy script')
    }
  }

  const downloadScript = () => {
    if (!widgetCode) return
    const blob = new Blob([widgetCode], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-support-widget-${sessionId?.slice(0, 8)}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleQuestionClick = (question: string) => {
    if (chatRef.current) {
      chatRef.current.addMessage(question.split(': ')[1])
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      {/* Hero Section */}
      <div className="relative overflow-hidden bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
          <div className="text-center">
            <div className="inline-flex items-center px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 mb-8">
              <span className="text-white/90 text-sm font-medium">🚀 Transform Your Business Support</span>
            </div>
            <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight">
              Build Your
              <span className="bg-gradient-to-r from-yellow-400 to-orange-500 bg-clip-text text-transparent"> Smart </span> 
              AI Assistant
            </h1>
            <p className="text-xl md:text-2xl text-blue-100 max-w-4xl mx-auto leading-relaxed mb-8">
              Create intelligent chatbots trained on your business knowledge. Upload documents, customize appearance, and deploy to your website in minutes.
            </p>
            <div className="flex flex-wrap justify-center gap-4 text-sm text-blue-200">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                <span>No coding required</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                <span>Instant deployment</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full"></span>
                <span>Enterprise ready</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-8 mb-16">
          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl flex items-center justify-center mb-6">
              <span className="text-3xl">🧠</span>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Smart Training</h3>
            <p className="text-gray-600 leading-relaxed">Upload your business documents and watch your AI assistant become an expert on your company's knowledge base.</p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mb-6">
              <span className="text-3xl">🎨</span>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Brand Customization</h3>
            <p className="text-gray-600 leading-relaxed">Customize colors, messages, and positioning to perfectly match your brand identity and website design.</p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div className="w-16 h-16 bg-gradient-to-r from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center mb-6">
              <span className="text-3xl">⚡</span>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Instant Deploy</h3>
            <p className="text-gray-600 leading-relaxed">Get embeddable code in minutes. Copy, paste, and your intelligent assistant is live on your website.</p>
          </div>
        </div>

        {/* Demo Section */}
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-gray-50 to-blue-50 px-8 py-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold text-gray-900 mb-2">Try the Demo</h2>
                <p className="text-gray-600">Upload your documents to see the AI enhancement in action</p>
              </div>
              <div className="flex items-center gap-4">
                {uploadedDocuments.length > 0 && (
                  <div className="bg-green-100 border border-green-200 rounded-lg px-4 py-2">
                    <span className="text-green-700 font-medium">{uploadedDocuments.length} docs trained</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="p-8">
            <div className="grid lg:grid-cols-2 gap-8">
              {/* Left Side - File Upload */}
              <div className="space-y-6">
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-100">
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <span className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center text-white font-bold">1</span>
                    Upload Your Knowledge Base
                  </h3>
                  <FileUpload
                    onUpload={handleFileUpload}
                    onProgress={setUploadProgress}
                    isProcessing={isUploading}
                    isComplete={uploadComplete}
                    progress={uploadProgress}
                    maxFiles={5}
                    maxSize={10 * 1024 * 1024}
                  />
                </div>

                {uploadedDocuments.length > 0 && (
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-100">
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                      <span className="text-green-500">✅</span>
                      Trained Documents ({uploadedDocuments.length})
                    </h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {uploadedDocuments.map((doc, index) => (
                        <div key={index} className="flex items-center justify-between bg-white rounded-lg p-3 border border-green-200">
                          <div className="flex items-center gap-3">
                            <span className="text-blue-500">📄</span>
                            <span className="font-medium text-gray-700 truncate">{doc.filename}</span>
                          </div>
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                            {doc.chunks} chunks
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Side - Chat Interface */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-100">
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <span className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white font-bold">2</span>
                  Test Your AI Assistant
                </h3>
                <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                  <div className="h-[500px]">
                    <ChatInterface
                      ref={chatRef}
                      systemPrompt={UNIVERSAL_ASSISTANT.systemPrompt}
                      roleContext="universal"
                      suggestedQuestions={UNIVERSAL_ASSISTANT.suggestedQuestions}
                      onSessionUpdate={handleSessionUpdate}
                      hasUploadedFiles={hasUploadedFiles}
                      sessionId={sessionId}
                      title={widgetConfig.title}
                      welcomeMessage={widgetConfig.welcome_message}
                      onGenerateWidget={generateWidget}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Success Metrics */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-700 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-white mb-4">Trusted by Growing Businesses</h2>
            <p className="text-xl text-indigo-200">Join thousands of companies using AI to enhance customer support</p>
          </div>
          <div className="grid md:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-2">5min</div>
              <div className="text-indigo-200">Average Setup Time</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-2">24/7</div>
              <div className="text-indigo-200">Always Available</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-2">90%</div>
              <div className="text-indigo-200">Query Accuracy</div>
            </div>
            <div className="text-center">
              <div className="text-4xl font-bold text-white mb-2">50%</div>
              <div className="text-indigo-200">Support Cost Reduction</div>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Section */}
      <div className="bg-white py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Ready to Transform Your Customer Support?</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Get in touch with our team for enterprise solutions, custom implementations, or product demos.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-8 text-center shadow-lg border border-blue-100 hover:shadow-xl transition-all duration-300">
              <div className="bg-blue-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-bold text-gray-900 mb-3 text-xl">Email Support</h3>
              <p className="text-gray-600 mb-4">Get detailed responses to your questions</p>
              <p className="text-sm text-blue-600 font-medium">support@aiassistant.com</p>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-8 text-center shadow-lg border border-green-100 hover:shadow-xl transition-all duration-300">
              <div className="bg-green-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h2m-4 9h3l4 4v-4h2a2 2 0 002-2V8a2 2 0 00-2-2h-6a2 2 0 00-2 2v4a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-bold text-gray-900 mb-3 text-xl">Live Chat</h3>
              <p className="text-gray-600 mb-4">Instant responses from our team</p>
              <p className="text-xs text-gray-500">Mon-Fri 9AM-6PM EST</p>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-2xl p-8 text-center shadow-lg border border-purple-100 hover:shadow-xl transition-all duration-300">
              <div className="bg-purple-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2-2v2m8 0V6a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2V6" />
                </svg>
              </div>
              <h3 className="font-bold text-gray-900 mb-3 text-xl">Enterprise</h3>
              <p className="text-gray-600 mb-4">Custom solutions and dedicated support</p>
              <p className="text-xs text-gray-500">Schedule a demo call</p>
            </div>
          </div>
        </div>
      </div>

      {/* Widget Generation Dialog */}
      {showGeneratedCodeDialog && widgetCode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-emerald-500 p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold mb-2">🎉 Your AI Assistant is Ready!</h3>
                  <p className="text-green-100">Copy this code and paste it into your website</p>
                </div>
                <button
                  onClick={() => setShowGeneratedCodeDialog(false)}
                  className="text-white hover:bg-white/20 rounded-lg p-2 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-gray-900 rounded-lg p-4 mb-4">
                <pre className="text-green-400 text-sm overflow-auto max-h-60 whitespace-pre-wrap">
                  {widgetCode}
                </pre>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => navigator.clipboard.writeText(widgetCode)}
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium flex items-center gap-2"
                >
                  📋 Copy Code
                </button>
                <button
                  onClick={() => setShowGeneratedCodeDialog(false)}
                  className="bg-gray-500 text-white px-6 py-3 rounded-lg hover:bg-gray-600 font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}