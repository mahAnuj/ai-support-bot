'use client'

import React, { useState, useEffect, useRef } from 'react'
import ChatInterface from '@/components/ui/ChatInterface'
import FileUpload from '@/components/ui/FileUpload'

// Assistant configurations
const UNIVERSAL_ASSISTANT = {
  title: 'Universal Business Assistant',
  systemPrompt: `You are a helpful AI assistant that can answer questions about any business or topic. When you have access to uploaded documents, use that information to provide specific, accurate answers. When you don't have specific information, provide helpful general guidance while noting that you don't have access to the specific details.

Always be professional, helpful, and concise. If someone asks about something that would be in their business documents, encourage them to upload relevant files for more specific answers.`,
  suggestedQuestions: [
    'General: What services do you offer?',
    'Support: How can I contact customer service?', 
    'Policies: What is your refund policy?',
    'Technical: How do I reset my password?',
    'Business: What are your business hours?',
    'Products: Do you have size guides available?'
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

    try {
      const formData = new FormData()
      files.forEach((file) => {
        formData.append('files', file)
      })
      
      // Only append sessionId if we have one
      if (sessionId) {
        formData.append('sessionId', sessionId)
      }

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Upload failed')
      }

      const result = await response.json()
      setUploadProgress(100)
      setUploadComplete(true)

      // Update sessionId if we got a new one from the upload
      if (result.sessionId && result.sessionId !== sessionId) {
        setSessionId(result.sessionId)
      }

      // Store document information for display
      if (result.documents && result.documents.length > 0) {
        const newDocuments = result.documents.map((doc: any) => ({
          filename: doc.filename,
          chunks: doc.chunks || doc.chunkCount || 0,
          uploadedAt: new Date().toISOString()
        }))
        setUploadedDocuments(prev => [...prev, ...newDocuments])
      } else {
        // Fallback for when API doesn't return document details
        const newDocuments = files.map(file => ({
          filename: file.name,
          chunks: 0,
          uploadedAt: new Date().toISOString()
        }))
        setUploadedDocuments(prev => [...prev, ...newDocuments])
      }

      setTimeout(() => {
        setIsUploading(false)
        setUploadProgress(0)
        setUploadComplete(false)
      }, 2000)

    } catch (error) {
      console.error('Upload error:', error)
      setIsUploading(false)
      setUploadProgress(0)
      setUploadComplete(false)
    }
  }

  const handleSessionUpdate = (newSessionId: string | null, hasFiles: boolean) => {
    // Update sessionId when ChatInterface creates or updates it
    if (newSessionId && newSessionId !== sessionId) {
      console.log('🔄 Page received session ID update from ChatInterface:', newSessionId)
      setSessionId(newSessionId)
    }
  }

  const handleGenerateWidget = async () => {
    if (!hasUploadedFiles) {
      alert('Please upload documents first to train your AI assistant')
      return
    }

    setIsGeneratingWidget(true)
    try {
      const response = await fetch('/api/widget/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          ...widgetConfig,
          system_prompt: UNIVERSAL_ASSISTANT.systemPrompt,
          role_context: 'universal'
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate widget')
      }

      const data = await response.json()
      console.log('Widget generation response:', data)
      
      if (data.embedCode) {
        setWidgetCode(data.embedCode)
        setShowGeneratedCodeDialog(true)
      } else {
        console.error('No embedCode in response:', data)
        alert('Widget generated but no script received. Please try again.')
      }
      
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Navigation Bar */}
      <nav className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 text-white border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center space-x-2">
              <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z"/>
                </svg>
              </div>
              <span className="text-xl font-bold">AI Assistant Builder</span>
            </div>
            
            <div className="hidden md:flex items-center space-x-8">
              <a href="#examples" className="hover:text-yellow-300 transition-colors">
                See Examples
              </a>
              <a href="#demo" className="bg-yellow-400 text-black px-4 py-2 rounded-lg font-medium hover:bg-yellow-300 transition-colors">
                Build Your AI Assistant
              </a>
            </div>
            
            <div className="md:hidden">
              <button className="text-white hover:text-yellow-300">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="text-center">
            <h1 className="text-5xl font-bold mb-4">
              Transform Your Business with 
              <span className="block text-yellow-300 mt-2">Smart AI Assistants</span>
            </h1>
            <p className="text-xl text-blue-100 max-w-3xl mx-auto mb-8">
              Create custom AI assistants trained on your business knowledge. 
              Test them live, then embed with just one line of code on your website.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-8">
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
                <h3 className="font-semibold mb-3 text-xl">5-Minute Setup</h3>
                <p className="text-sm text-blue-100 leading-relaxed">Upload docs, test responses, get embeddable code</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
                <h3 className="font-semibold mb-3 text-xl">Business-Specific AI</h3>
                <p className="text-sm text-blue-100 leading-relaxed">Trained on your documents, policies, and procedures</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
                <h3 className="font-semibold mb-3 text-xl">One-Click Deploy</h3>
                <p className="text-sm text-blue-100 leading-relaxed">Copy-paste JavaScript code to go live instantly</p>
              </div>
            </div>

            <div className="bg-white/5 backdrop-blur-sm rounded-xl p-8 max-w-5xl mx-auto border border-white/10">
              <h3 className="text-xl font-semibold mb-6 text-center">How It Works - 3 Simple Steps</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="text-center">
                  <div className="bg-gradient-to-r from-yellow-400 to-orange-400 text-black w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-3 shadow-lg">1</div>
                  <h4 className="font-semibold mb-1">Test AI Responses</h4>
                  <p className="text-sm text-blue-100">Try sample questions to see baseline performance</p>
                </div>
                <div className="text-center">
                  <div className="bg-gradient-to-r from-green-400 to-emerald-400 text-black w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-3 shadow-lg">2</div>
                  <h4 className="font-semibold mb-1">Upload Documents</h4>
                  <p className="text-sm text-blue-100">Add your business knowledge & watch it transform</p>
                </div>
                <div className="text-center">
                  <div className="bg-gradient-to-r from-purple-400 to-pink-400 text-black w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg mx-auto mb-3 shadow-lg">3</div>
                  <h4 className="font-semibold mb-1">Deploy Instantly</h4>
                  <p className="text-sm text-blue-100">Get embeddable code & go live in minutes</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Conversation Examples & Results */}
      <div className="bg-gradient-to-br from-blue-50 to-indigo-50 py-16" id="examples">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">See Your AI Assistant in Action</h2>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
              Real conversations, real results. Watch how businesses transform customer support with intelligent AI responses.
            </p>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* E-commerce Example */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-orange-500 to-red-500 p-4">
                <div className="flex items-center space-x-3">
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2">
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M7 4V2C7 1.45 7.45 1 8 1H16C16.55 1 17 1.45 17 2V4H20C20.55 4 21 4.45 21 5S20.55 6 20 6H19V19C19 20.1 18.1 21 17 21H7C5.9 21 5 20.1 5 19V6H4C3.45 6 3 5.55 3 5S3.45 4 4 4H7ZM9 3V4H15V3H9ZM7 6V19H17V6H7Z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg">E-commerce Support</h3>
                    <p className="text-orange-100 text-sm">Fashion Retailer</p>
                  </div>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <div className="bg-blue-500 text-white rounded-lg px-4 py-2 max-w-xs">
                      <p className="text-sm">What's your return policy for shoes?</p>
                    </div>
                  </div>
                  
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-800 rounded-lg px-4 py-3 max-w-xs">
                      <p className="text-sm">You can return shoes within <strong>30 days</strong> of purchase in original condition. Free return shipping included! Items must have original tags and packaging.</p>
                      <div className="text-xs text-gray-500 mt-2 italic">📄 From: Return Policy Guide</div>
                    </div>
                  </div>
                </div>
                
                <div className="border-t pt-4 mt-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-600">65%</div>
                      <div className="text-xs text-gray-600">Less support tickets</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-orange-600">2.3x</div>
                      <div className="text-xs text-gray-600">Faster responses</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* SaaS Example */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-4">
                <div className="flex items-center space-x-3">
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2">
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2L2 7L12 12L22 7L12 2ZM2 17L12 22L22 17L12 12L2 17Z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg">SaaS Onboarding</h3>
                    <p className="text-blue-100 text-sm">Project Management Tool</p>
                  </div>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <div className="bg-blue-500 text-white rounded-lg px-4 py-2 max-w-xs">
                      <p className="text-sm">How do I invite team members?</p>
                    </div>
                  </div>
                  
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-800 rounded-lg px-4 py-3 max-w-xs">
                      <p className="text-sm">Go to <strong>Settings → Team → Invite Members</strong>. Enter their email addresses and select their role (Admin, Editor, or Viewer). They'll receive an invitation email instantly!</p>
                      <div className="text-xs text-gray-500 mt-2 italic">📄 From: Team Management Guide</div>
                    </div>
                  </div>
                </div>
                
                <div className="border-t pt-4 mt-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">40%</div>
                      <div className="text-xs text-gray-600">Faster onboarding</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">85%</div>
                      <div className="text-xs text-gray-600">User satisfaction</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Healthcare Example */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-4">
                <div className="flex items-center space-x-3">
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2">
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M19 8H17V6C17 3.24 14.76 1 12 1S7 3.24 7 6V8H5C3.9 8 3 8.9 3 10V20C3 21.1 3.9 22 5 22H19C20.1 22 21 21.1 21 20V10C21 8.9 20.1 8 19 8ZM12 17C10.9 17 10 16.1 10 15S10.9 13 12 13S14 13.9 14 15S13.1 17 12 17ZM15.1 8H8.9V6C8.9 4.29 10.29 2.9 12 2.9S15.1 4.29 15.1 6V8Z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg">Healthcare Support</h3>
                    <p className="text-emerald-100 text-sm">Family Medicine Clinic</p>
                  </div>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <div className="bg-blue-500 text-white rounded-lg px-4 py-2 max-w-xs">
                      <p className="text-sm">Do you accept my insurance?</p>
                    </div>
                  </div>
                  
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-800 rounded-lg px-4 py-3 max-w-xs">
                      <p className="text-sm">We accept <strong>most major insurance plans</strong> including Blue Cross, Aetna, United Healthcare, and Medicare. Please bring your insurance card to verify coverage and copay amounts.</p>
                      <div className="text-xs text-gray-500 mt-2 italic">📄 From: Insurance Information</div>
                    </div>
                  </div>
                </div>
                
                <div className="border-t pt-4 mt-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-emerald-600">75%</div>
                      <div className="text-xs text-gray-600">Fewer phone calls</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-emerald-600">24/7</div>
                      <div className="text-xs text-gray-600">Patient support</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Real Estate Example */}
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
              <div className="bg-gradient-to-r from-purple-500 to-pink-600 p-4">
                <div className="flex items-center space-x-3">
                  <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2">
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M10 20V14H14V20H19V12H22L12 3L2 12H5V20H10Z"/>
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-white font-bold text-lg">Real Estate Assistant</h3>
                    <p className="text-purple-100 text-sm">Luxury Properties Agency</p>
                  </div>
                </div>
              </div>
              
              <div className="p-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <div className="bg-blue-500 text-white rounded-lg px-4 py-2 max-w-xs">
                      <p className="text-sm">What's the process for making an offer?</p>
                    </div>
                  </div>
                  
                  <div className="flex justify-start">
                    <div className="bg-gray-100 text-gray-800 rounded-lg px-4 py-3 max-w-xs">
                      <p className="text-sm">Our process: <strong>1)</strong> Property viewing <strong>2)</strong> Market analysis <strong>3)</strong> Offer preparation <strong>4)</strong> Negotiation <strong>5)</strong> Contract signing. We handle everything and keep you informed at each step!</p>
                      <div className="text-xs text-gray-500 mt-2 italic">📄 From: Buyer Guide</div>
                    </div>
                  </div>
                </div>
                
                <div className="border-t pt-4 mt-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-600">3x</div>
                      <div className="text-xs text-gray-600">More qualified leads</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-purple-600">90%</div>
                      <div className="text-xs text-gray-600">Client satisfaction</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-8 mt-12">
            <div className="text-center mb-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Transform Your Customer Support Today</h3>
              <p className="text-gray-600">Join hundreds of businesses already using AI to deliver exceptional customer experiences</p>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              <div className="text-center">
                <div className="text-4xl font-bold text-blue-600 mb-2">60%</div>
                <div className="text-sm text-gray-600">Reduction in support tickets</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-green-600 mb-2">24/7</div>
                <div className="text-sm text-gray-600">Instant customer support</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-purple-600 mb-2">85%</div>
                <div className="text-sm text-gray-600">Customer satisfaction rate</div>
              </div>
              <div className="text-center">
                <div className="text-4xl font-bold text-orange-600 mb-2">3x</div>
                <div className="text-sm text-gray-600">Faster response times</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Demo Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" id="demo">
        <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 border border-blue-200 rounded-xl p-6 mb-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-start space-x-4">
              <div className="bg-gradient-to-r from-blue-500 to-indigo-600 w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0">
                <svg className="w-7 h-7 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2L2 7L12 12L22 7L12 2ZM2 17L12 22L22 17L12 12L2 17Z"/>
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold text-blue-900 mb-2">
                  Build Your Own AI Assistant
                </h3>
                <p className="text-blue-700 text-sm leading-relaxed mb-4">
                  Test the AI assistant, upload your business documents to enhance it, then get embeddable code to deploy on your website
                </p>
                <div className="flex flex-wrap gap-2 text-xs text-blue-600">
                  <div className="flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                    <span>Instant Processing</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                    <span>Secure Upload</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                    <span>AI Enhancement</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Demo Interface with Sidebar */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="flex">
            {/* Left Sidebar - Configuration & Documents */}
            <div className="w-96 bg-gray-50 border-r border-gray-200 p-6">
              <div className="h-[600px] overflow-y-auto pr-4 space-y-6" style={{ scrollbarWidth: 'thin' }}>
                {/* Build Assistant Section */}
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center">
                    <svg className="w-5 h-5 mr-2 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2L2 7L12 12L22 7L12 2ZM2 17L12 22L22 17L12 12L2 17Z"/>
                    </svg>
                    Configure Your AI Assistant
                  </h3>
                  
                  {!hasUploadedFiles && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                      <div className="flex items-center space-x-2">
                        <svg className="w-4 h-4 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/>
                        </svg>
                        <p className="text-xs text-amber-700">Upload documents above to enable AI assistant generation</p>
                      </div>
                    </div>
                  )}
                  
                  {/* Assistant Configuration */}
                  <div className="space-y-4">
                    {/* Upload Section - moved here for session consistency */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Knowledge Base Documents
                      </label>
                      <FileUpload
                        onUpload={handleFileUpload}
                        isProcessing={isUploading}
                        progress={uploadProgress}
                        isComplete={uploadComplete}
                        compact={true}
                      />
                      <p className="text-xs text-gray-500 mt-2">
                        Upload PDFs, TXT, MD, DOCX files to train your AI assistant
                      </p>
                    </div>

                    {/* Uploaded Documents - right after upload */}
                    {uploadedDocuments.length > 0 && (
                      <div className="space-y-2">
                        <h5 className="text-sm font-medium text-gray-700">Uploaded Documents</h5>
                        {uploadedDocuments.map((doc, index) => (
                          <div key={index} className="bg-white border border-gray-200 rounded-lg p-3">
                            <div className="flex items-center space-x-3">
                              <div className="bg-green-100 w-8 h-8 rounded-lg flex items-center justify-center">
                                <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
                                </svg>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate">
                                  {doc.filename}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {doc.chunks > 0 ? `${doc.chunks} chunks processed` : 'Processed successfully'}
                                </p>
                              </div>
                              <div className="bg-green-100 w-6 h-6 rounded-full flex items-center justify-center">
                                <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                                </svg>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Display Name
                        <span className="text-xs text-gray-500 ml-1">(What users see in chat)</span>
                      </label>
                      <input
                        type="text"
                        value={widgetConfig.title}
                        onChange={(e) => setWidgetConfig({ ...widgetConfig, title: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., Support Assistant"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Internal Name
                        <span className="text-xs text-gray-500 ml-1">(For your reference)</span>
                      </label>
                      <input
                        type="text"
                        value={widgetConfig.name}
                        onChange={(e) => setWidgetConfig({ ...widgetConfig, name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., Business Support Widget"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Assistant Icon
                      </label>
                      <div className="flex items-center space-x-3">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                          <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12,4A4,4 0 0,1 16,8A4,4 0 0,1 12,12A4,4 0 0,1 8,8A4,4 0 0,1 12,4M12,14C16.42,14 20,15.79 20,18V20H4V18C4,15.79 7.58,14 12,14Z"/>
                          </svg>
                        </div>
                        <div className="flex-1">
                          <input
                            type="file"
                            accept="image/*"
                            className="w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                          />
                          <p className="text-xs text-gray-500 mt-1">Upload PNG, JPG (32x32px recommended)</p>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Welcome Message
                      </label>
                      <textarea
                        rows={3}
                        value={widgetConfig.welcome_message}
                        onChange={(e) => setWidgetConfig({ ...widgetConfig, welcome_message: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="e.g., Hi! How can I help you today?"
                      />
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Widget Position
                      </label>
                      <select 
                        value={widgetConfig.position}
                        onChange={(e) => setWidgetConfig({ ...widgetConfig, position: e.target.value as 'bottom-right' | 'bottom-left' })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        <option value="bottom-right">Bottom Right</option>
                        <option value="bottom-left">Bottom Left</option>
                      </select>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Primary Color
                      </label>
                      <div className="flex space-x-2">
                        <input
                          type="color"
                          value={widgetConfig.primary_color}
                          onChange={(e) => setWidgetConfig({ ...widgetConfig, primary_color: e.target.value })}
                          className="w-12 h-8 border border-gray-300 rounded cursor-pointer"
                        />
                        <input
                          type="text"
                          value={widgetConfig.primary_color}
                          onChange={(e) => setWidgetConfig({ ...widgetConfig, primary_color: e.target.value })}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                    </div>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Widget Size
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {(['small', 'medium', 'large'] as const).map((size) => (
                          <button
                            key={size}
                            onClick={() => setWidgetConfig({ ...widgetConfig, size })}
                            className={`p-2 border rounded-lg text-xs text-center transition-all ${
                              widgetConfig.size === size 
                                ? 'border-blue-500 bg-blue-50 text-blue-700' 
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <div className="font-medium capitalize">{size}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Generate Code Section */}
                <div className="pt-4 border-t border-gray-200">
                  <button
                    onClick={handleGenerateWidget}
                    disabled={!hasUploadedFiles || isGeneratingWidget}
                    className={`w-full px-4 py-3 rounded-lg font-medium transition-all text-sm ${
                      hasUploadedFiles && !isGeneratingWidget
                        ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 transform hover:scale-105'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {isGeneratingWidget ? (
                      <span className="flex items-center justify-center space-x-2">
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full"></div>
                        <span>Generating...</span>
                      </span>
                    ) : (
                      '🚀 Generate Widget Code'
                    )}
                  </button>
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    Get embeddable code for your website
                  </p>
                </div>
              </div>
            </div>

            {/* Right Side - Chat Interface */}
            <div className="flex-1">
              <div className="h-[600px]">
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
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Contact Us Section */}
      <div className="bg-gradient-to-br from-gray-50 to-blue-50 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-4xl font-bold text-gray-900 mb-4">Have Questions About Our AI Assistant?</h2>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
              Get in touch with our team for custom implementations, enterprise solutions, or any product-related queries.
            </p>
          </div>

          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
            <div className="p-8">
              <form className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                      placeholder="Your full name"
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                      placeholder="your.email@company.com"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="company" className="block text-sm font-medium text-gray-700 mb-2">
                      Company Name
                    </label>
                    <input
                      type="text"
                      id="company"
                      name="company"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                      placeholder="Your company (optional)"
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-2">
                      Inquiry Type *
                    </label>
                    <select
                      id="subject"
                      name="subject"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    >
                      <option value="">Select inquiry type</option>
                      <option value="general">General Information</option>
                      <option value="enterprise">Enterprise Solutions</option>
                      <option value="integration">Custom Integration</option>
                      <option value="pricing">Pricing & Plans</option>
                      <option value="technical">Technical Support</option>
                      <option value="partnership">Partnership Opportunities</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-2">
                    Message *
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={6}
                    required
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors resize-none"
                    placeholder="Tell us about your specific needs, use case, or any questions you have about our AI Assistant platform..."
                  ></textarea>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-sm text-gray-600">
                    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                    </svg>
                    <span>We typically respond within 24 hours</span>
                  </div>

                  <button
                    type="submit"
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-8 py-3 rounded-lg font-medium hover:from-blue-700 hover:to-indigo-700 transition-all transform hover:scale-105 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    Send Message
                  </button>
                </div>
              </form>
            </div>
          </div>
          
          {/* Contact Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
            <div className="bg-white rounded-xl p-6 text-center shadow-lg">
              <div className="bg-blue-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Email Support</h3>
              <p className="text-sm text-gray-600">support@aiassistant.com</p>
              <p className="text-xs text-gray-500 mt-1">24/7 Technical Support</p>
            </div>

            <div className="bg-white rounded-xl p-6 text-center shadow-lg">
              <div className="bg-green-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h2m-4 9h3l4 4v-4h2a2 2 0 002-2V8a2 2 0 00-2-2h-6a2 2 0 00-2 2v4a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Live Chat</h3>
              <p className="text-sm text-gray-600">Instant responses</p>
              <p className="text-xs text-gray-500 mt-1">Mon-Fri 9AM-6PM EST</p>
            </div>

            <div className="bg-white rounded-xl p-6 text-center shadow-lg">
              <div className="bg-purple-100 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">Enterprise Sales</h3>
              <p className="text-sm text-gray-600">Custom solutions</p>
              <p className="text-xs text-gray-500 mt-1">Dedicated account manager</p>
            </div>
          </div>
        </div>
      </div>

      {/* Generated Code Dialog */}
      {showGeneratedCodeDialog && widgetCode && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center p-4 z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div className="bg-white rounded-xl max-w-4xl w-full max-h-[90vh] overflow-auto shadow-2xl">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">🎉 Your AI Assistant Widget is Ready!</h2>
                  <p className="text-gray-600 mt-1">Copy the code below and paste it into your website</p>
                </div>
                <button
                  onClick={() => setShowGeneratedCodeDialog(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl font-bold w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
                >
                  ✕
                </button>
              </div>
              
              {/* Success Banner */}
              <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl p-6 mb-6">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="text-3xl">🚀</div>
                  <div>
                    <h3 className="text-xl font-bold">Widget Generated Successfully!</h3>
                    <p className="text-green-100">Your AI assistant is trained and ready to help customers 24/7</p>
                  </div>
                </div>
                
                <div className="bg-white/10 backdrop-blur-sm rounded-lg p-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="font-semibold mb-1">✅ AI Trained</div>
                      <div className="text-green-100">Uses your uploaded documents</div>
                    </div>
                    <div>
                      <div className="font-semibold mb-1">🌐 Ready to Deploy</div>
                      <div className="text-green-100">One script, instant activation</div>
                    </div>
                    <div>
                      <div className="font-semibold mb-1">📱 Mobile Optimized</div>
                      <div className="text-green-100">Works on all devices</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Embeddable Script */}
              <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 mb-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-blue-900">📋 Your Embeddable Script</h3>
                    <p className="text-blue-700 text-sm">Copy this code and paste it before the &lt;/body&gt; tag in your website</p>
                  </div>
                  <div className="flex space-x-3">
                    <button
                      onClick={copyToClipboard}
                      className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium transition-colors"
                    >
                      📋 Copy Script
                    </button>
                    <button
                      onClick={downloadScript}
                      className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 font-medium transition-colors"
                    >
                      💾 Download
                    </button>
                  </div>
                </div>
                
                <div className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto max-h-60 font-mono text-sm">
                  <pre>{widgetCode}</pre>
                </div>
              </div>

              {/* Implementation Guide */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                  <h4 className="text-lg font-bold text-blue-900 mb-4">🚀 Implementation Steps</h4>
                  <ol className="space-y-3 text-sm text-blue-800">
                    <li className="flex items-start space-x-3">
                      <span className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                      <span><strong>Copy</strong> the generated script above</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                      <span><strong>Open</strong> your website's HTML editor</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                      <span><strong>Paste</strong> before the closing &lt;/body&gt; tag</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">4</span>
                      <span><strong>Save & publish</strong> your website</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="bg-green-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">✓</span>
                      <span><strong>Done!</strong> Your AI assistant is now live</span>
                    </li>
                  </ol>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-xl p-6">
                  <h4 className="text-lg font-bold text-green-900 mb-4">✨ Business Benefits</h4>
                  <ul className="space-y-3 text-sm text-green-800">
                    <li className="flex items-start space-x-3">
                      <span className="text-green-600">📈</span>
                      <span><strong>Reduce support tickets</strong> by 60%+ with instant answers</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="text-green-600">⏰</span>
                      <span><strong>24/7 availability</strong> - customers get help anytime</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="text-green-600">🎯</span>
                      <span><strong>Accurate responses</strong> based on your documents</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="text-green-600">📱</span>
                      <span><strong>Mobile responsive</strong> - works on all devices</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="text-green-600">🔒</span>
                      <span><strong>Secure & private</strong> - your data stays isolated</span>
                    </li>
                    <li className="flex items-start space-x-3">
                      <span className="text-green-600">⚡</span>
                      <span><strong>Zero maintenance</strong> - works immediately after setup</span>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex justify-center space-x-4">
                <button
                  onClick={copyToClipboard}
                  className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-8 py-3 rounded-xl font-bold hover:from-blue-700 hover:to-indigo-700 transition-all transform hover:scale-105"
                >
                  📋 Copy Code & Close
                </button>
                <button
                  onClick={() => setShowGeneratedCodeDialog(false)}
                  className="bg-gray-300 text-gray-700 px-8 py-3 rounded-xl font-bold hover:bg-gray-400 transition-all"
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
