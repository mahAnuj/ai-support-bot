'use client'

import React, { useState, useEffect, useRef } from 'react'
import ChatInterface from '@/components/ui/ChatInterface'
import FileUpload from '@/components/ui/FileUpload'
import WidgetGenerator from '@/components/ui/WidgetGenerator'

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

      // Show specific error message to user
      if (error instanceof Error) {
        if (error.message.includes('OPENAI_API_KEY')) {
          alert('⚠️ Setup Required: Please add your OpenAI API key in the Secrets tab to enable AI features.')
        } else {
          alert(`Upload failed: ${error.message}`)
        }
      } else {
        alert('Upload failed. Please check your files and try again.')
      }
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
          name: widgetConfig.name || widgetConfig.title || 'Support Widget',
          title: widgetConfig.title || widgetConfig.name || 'AI Support Assistant',
          welcome_message: widgetConfig.welcome_message || 'Hi! How can I help you today?',
          primary_color: widgetConfig.primary_color || '#3B82F6',
          position: widgetConfig.position || 'bottom-right',
          size: widgetConfig.size || 'medium'
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.details || 'Failed to generate widget')
      }

      const result = await response.json()
      setWidgetCode(result.embedCode)
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
              <svg className="w-5 h-5 text-white/90 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span className="text-white/90 text-sm font-medium">Transform Your Business Support</span>
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
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Smart Training</h3>
            <p className="text-gray-600 leading-relaxed">Upload your business documents and watch your AI assistant become an expert on your company's knowledge base.</p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div className="w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17v4a2 2 0 002 2h4M13 13h4a2 2 0 012 2v4a2 2 0 01-2 2H9a2 2 0 01-2-2v-4a2 2 0 012-2h4z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Brand Customization</h3>
            <p className="text-gray-600 leading-relaxed">Customize colors, messages, and positioning to perfectly match your brand identity and website design.</p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-xl border border-gray-100 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
            <div className="w-16 h-16 bg-gradient-to-r from-green-500 to-emerald-500 rounded-2xl flex items-center justify-center mb-6">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-4">Instant Deploy</h3>
            <p className="text-gray-600 leading-relaxed">Get embeddable code in minutes. Copy, paste, and your intelligent assistant is live on your website.</p>
          </div>
        </div>

        

        {/* Demo Section */}
        <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-gray-50 to-blue-50 px-8 py-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.0720l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-gray-900 mb-2">Try the Demo</h2>
                  <p className="text-gray-600">Upload your documents to see the AI enhancement in action</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {uploadedDocuments.length > 0 && (
                  <div className="bg-green-100 border border-green-200 rounded-lg px-4 py-2 flex items-center gap-2">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
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
                  <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                    </div>
                    <div>
                      <span className="text-indigo-600 text-sm font-medium">Step 1</span>
                      <div className="font-bold">Upload Your Knowledge Base</div>
                    </div>
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
                    <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-3">
                      <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
                        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <span>Trained Documents ({uploadedDocuments.length})</span>
                    </h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {uploadedDocuments.map((doc, index) => (
                        <div key={index} className="flex items-center justify-between bg-white rounded-lg p-3 border border-green-200">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                              <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                              </svg>
                            </div>
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
                <h3 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <div>
                    <span className="text-blue-600 text-sm font-medium">Step 2</span>
                    <div className="font-bold">Test Your AI Assistant</div>
                  </div>
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
                      onGenerateWidget={() => {}} // Empty function, we'll handle generation in step 3
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Widget Configuration Section */}
        {uploadedDocuments.length > 0 && (

<div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-3xl shadow-2xl border border-green-200 overflow-hidden">
            <div className="bg-gradient-to-r from-green-500 to-blue-600 px-8 py-6 text-white">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                  <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                </div>
                <div>
                  <h2 className="text-3xl font-bold mb-2">Step 3: Deploy Your AI Assistant</h2>
                  <p className="text-green-100">Configure and generate embeddable code for your website</p>
                </div>
              </div>
            </div>

            <div className="p-8">
              <div className="grid lg:grid-cols-2 gap-8">
                {/* Configuration Panel */}
                <div className="space-y-6">
                  <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
                    <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                      <span className="text-2xl">🎨</span>
                      Customize Your Assistant
                    </h3>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Assistant Name
                        </label>
                        <input
                          type="text"
                          value={widgetConfig.name}
                          onChange={(e) => setWidgetConfig({ ...widgetConfig, name: e.target.value })}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Business Support Assistant"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Display Title
                        </label>
                        <input
                          type="text"
                          value={widgetConfig.title}
                          onChange={(e) => setWidgetConfig({ ...widgetConfig, title: e.target.value })}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="AI Support Assistant"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Welcome Message
                        </label>
                        <textarea
                          value={widgetConfig.welcome_message}
                          onChange={(e) => setWidgetConfig({ ...widgetConfig, welcome_message: e.target.value })}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          rows={3}
                          placeholder="Hi! I'm your AI assistant. How can I help you today?"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Brand Color
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={widgetConfig.primary_color}
                            onChange={(e) => setWidgetConfig({ ...widgetConfig, primary_color: e.target.value })}
                            className="w-16 h-12 border border-gray-300 rounded-lg cursor-pointer"
                          />
                          <input
                            type="text"
                            value={widgetConfig.primary_color}
                            onChange={(e) => setWidgetConfig({ ...widgetConfig, primary_color: e.target.value })}
                            className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            placeholder="#3B82F6"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Widget Position
                        </label>
                        <select
                          value={widgetConfig.position}
                          onChange={(e) => setWidgetConfig({ ...widgetConfig, position: e.target.value as any })}
                          className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="bottom-right">Bottom Right (Recommended)</option>
                          <option value="bottom-left">Bottom Left</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Widget Size
                        </label>
                        <div className="grid grid-cols-3 gap-3">
                          {['small', 'medium', 'large'].map((size) => (
                            <button
                              key={size}
                              onClick={() => setWidgetConfig({ ...widgetConfig, size: size as any })}
                              className={`p-3 border-2 rounded-lg text-center transition-all ${
                                widgetConfig.size === size 
                                  ? 'border-blue-500 bg-blue-50 text-blue-700' 
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <div className="font-medium capitalize">{size}</div>
                              <div className="text-xs text-gray-500 mt-1">
                                {size === 'small' && 'Compact'}
                                {size === 'medium' && 'Standard'}
                                {size === 'large' && 'Prominent'}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Preview and Generate */}
                <div className="space-y-6">
                  <div className="bg-white rounded-2xl p-6 shadow-lg border border-gray-200">
                    <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                      <span className="text-2xl">👀</span>
                      Live Preview
                    </h3>                    <div className="bg-gray-100 rounded-lg p-4 mb-6 h-64 flex items-center justify-center">
                      <div className="text-center text-gray-500">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center text-white text-2xl"
                             style={{ backgroundColor: widgetConfig.primary_color }}>
                          💬
                        </div>
                        <div className="font-medium">{widgetConfig.title}</div>
                        <div className="text-sm mt-2 max-w-xs">{widgetConfig.welcome_message}</div>
                        <div className="text-xs mt-4 text-gray-400">
                          Position: {widgetConfig.position} | Size: {widgetConfig.size}
                        </div>
                      </div>
                    </div>

                    <div className="text-center">
                      <button
                        onClick={generateWidget}
                        disabled={isGeneratingWidget}
                        className="w-full bg-gradient-to-r from-green-500 to-blue-600 text-white py-4 px-8 rounded-xl font-bold text-lg hover:from-green-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 hover:shadow-lg transform hover:-translate-y-0.5 disabled:transform-none"
                      >
                        {isGeneratingWidget ? (
                          <span className="flex items-center justify-center gap-2">
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Generating Widget...
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            <span>🚀</span>
                            Generate Embeddable Code
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6 border border-blue-200">
                    <h4 className="text-lg font-bold text-blue-900 mb-4">✨ What You Get</h4>
                    <ul className="space-y-3 text-sm text-blue-800">
                      <li className="flex items-start gap-3">
                        <span className="text-blue-600">🎯</span>
                        <span><strong>Smart responses</strong> based on your uploaded documents</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-blue-600">⚡</span>
                        <span><strong>Instant deployment</strong> - just copy and paste one script</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-blue-600">📱</span>
                        <span><strong>Mobile responsive</strong> - works on all devices</span>
                      </li>
                      <li className="flex items-start gap-3">
                        <span className="text-blue-600">🔒</span>
                        <span><strong>Where your data goes</strong> - documents and questions are sent to OpenAI to answer</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
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