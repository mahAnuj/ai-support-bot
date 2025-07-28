'use client'

import { useState, useRef } from 'react'
import ChatInterface from '@/components/ui/ChatInterface'
import WidgetGenerator from '@/components/ui/WidgetGenerator'

// Role-based configuration
const ASSISTANT_ROLES = {
  ecommerce: {
    title: "🛒 E-commerce Support",
    description: "Customer service for online orders, returns, and product inquiries",
    systemPrompt: "You are a helpful e-commerce customer support assistant. You help customers with orders, returns, product information, shipping, and general shopping questions. Be friendly, professional, and solution-oriented.",
    suggestedQuestions: [
      "What's the status of my order #12345?",
      "How do I return a defective item?",
      "Do you offer international shipping?",
      "What's your refund policy?"
    ],
    sampleKnowledge: "Sample knowledge: Order processing takes 1-2 business days. Returns accepted within 30 days. Free shipping on orders over $50..."
  },
  hr: {
    title: "👥 HR Assistant", 
    description: "Employee support for policies, benefits, and workplace procedures",
    systemPrompt: "You are a knowledgeable HR assistant helping employees with company policies, benefits, procedures, and workplace questions. Provide accurate, helpful information while maintaining confidentiality.",
    suggestedQuestions: [
      "What's our vacation policy?",
      "How do I enroll in health insurance?",
      "What's the remote work policy?",
      "How do I request time off?"
    ],
    sampleKnowledge: "Sample knowledge: 15 vacation days annually. Health insurance enrollment during open season. Remote work requires manager approval..."
  },
  technical: {
    title: "🔧 Technical Support",
    description: "IT help desk for troubleshooting and technical documentation",
    systemPrompt: "You are a technical support specialist helping users with software, hardware, and IT-related issues. Provide clear, step-by-step solutions and escalate complex issues when needed.",
    suggestedQuestions: [
      "How do I reset my password?",
      "My computer won't connect to WiFi",
      "How do I install the VPN software?",
      "The printer isn't working, what should I do?"
    ],
    sampleKnowledge: "Sample knowledge: Password reset via IT portal. WiFi troubleshooting steps. VPN installation guide. Printer maintenance procedures..."
  },
  sales: {
    title: "💼 Sales Assistant",
    description: "Product information, pricing, and sales support",
    systemPrompt: "You are a knowledgeable sales assistant helping customers understand products, pricing, and making informed purchase decisions. Be persuasive but honest, and focus on customer needs.",
    suggestedQuestions: [
      "What's the difference between Pro and Basic plans?",
      "Do you offer volume discounts?",
      "What's included in the enterprise package?",
      "Can I get a demo of the software?"
    ],
    sampleKnowledge: "Sample knowledge: Pro plan includes advanced features. Volume discounts start at 10+ licenses. Enterprise includes priority support..."
  },
  legal: {
    title: "⚖️ Legal Advisor",
    description: "Contract review, compliance, and legal procedure guidance",
    systemPrompt: "You are a legal assistant helping with contract reviews, compliance questions, and legal procedures. Provide accurate information but always recommend consulting with qualified legal counsel for complex matters.",
    suggestedQuestions: [
      "What are the key terms in this contract?",
      "What's our data privacy policy?",
      "How do we handle GDPR compliance?",
      "What's the process for contract amendments?"
    ],
    sampleKnowledge: "Sample knowledge: Standard contract terms. GDPR compliance procedures. Data privacy policies. Amendment processes..."
  },
  medical: {
    title: "🏥 Medical Assistant",
    description: "Healthcare information, procedures, and patient support",
    systemPrompt: "You are a medical assistant providing general health information and procedure guidance. Always emphasize that this information doesn't replace professional medical advice and recommend consulting healthcare providers for medical decisions.",
    suggestedQuestions: [
      "What are the symptoms of diabetes?",
      "How do I prepare for a blood test?",
      "What's the normal blood pressure range?",
      "When should I see a doctor for a fever?"
    ],
    sampleKnowledge: "Sample knowledge: Diabetes symptoms include thirst, fatigue. Blood test preparation guidelines. Normal BP ranges. Fever management protocols..."
  }
}

export default function Home() {
  const [selectedRole, setSelectedRole] = useState<keyof typeof ASSISTANT_ROLES>('ecommerce')
  const [showWidgetGenerator, setShowWidgetGenerator] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [hasUploadedFiles, setHasUploadedFiles] = useState(false)
  const currentRole = ASSISTANT_ROLES[selectedRole]
  const chatRef = useRef<any>(null)

  const handleQuestionClick = (question: string) => {
    // Trigger the question in the chat interface
    if (chatRef.current && chatRef.current.sendQuestion) {
      chatRef.current.sendQuestion(question)
    }
  }

  // Handle session state updates from ChatInterface
  const handleSessionUpdate = (newSessionId: string | null, hasFiles: boolean) => {
    setSessionId(newSessionId)
    setHasUploadedFiles(hasFiles)
  }

  const handleWidgetGenerated = (widgetKey: string) => {
    console.log('Widget generated with key:', widgetKey)
    // Keep modal open so user can see and copy the generated script
    // User can close manually after copying
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-100 to-indigo-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">
              AI Role-Based Assistant
            </h1>
            <p className="text-lg text-gray-700 mx-auto mb-4">
              Specialized AI assistants for different business roles. Upload documents for expert-level responses.
            </p>
            <div className="flex items-center justify-center space-x-8 text-sm text-gray-600">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-red-400 rounded-full"></div>
                <span>Generic AI (30% confidence)</span>
              </div>
              <div className="text-2xl">→</div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-green-400 rounded-full"></div>
                <span>Enhanced AI (95% confidence)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Sidebar - Role Selection & Questions */}
          <div className="lg:col-span-1">
            {/* Role Selection */}
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                🎭 Choose Assistant Role
              </h3>
              <select 
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as keyof typeof ASSISTANT_ROLES)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-4"
              >
                {Object.entries(ASSISTANT_ROLES).map(([key, role]) => (
                  <option key={key} value={key}>
                    {role.title}
                  </option>
                ))}
              </select>
              
              {/* Current Role Info */}
              <div className="p-4 bg-blue-50 rounded-lg">
                <h4 className="font-semibold text-blue-900 mb-2">{currentRole.title}</h4>
                <p className="text-blue-700 text-sm mb-3">{currentRole.description}</p>
                <div className="text-xs text-blue-600 bg-blue-100 p-2 rounded">
                  <strong>Sample Knowledge:</strong> {currentRole.sampleKnowledge}
                </div>
              </div>
            </div>

            {/* Suggested Questions */}
            <div className="bg-white rounded-xl shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                💡 Try These Questions
              </h3>
              <div className="space-y-2">
                <p className="text-sm text-gray-600 mb-3">
                  Click any question to ask it automatically in the chat:
                </p>
                {currentRole.suggestedQuestions.map((question, index) => (
                  <button
                    key={index}
                    onClick={() => handleQuestionClick(question)}
                    className="w-full text-left p-3 bg-gray-50 rounded-lg text-sm text-gray-700 hover:bg-blue-50 hover:border-blue-200 border border-transparent transition-all cursor-pointer"
                  >
                    &quot;{question}&quot;
                  </button>
                ))}
              </div>
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-yellow-800 text-sm">
                  <strong>💡 Pro Tip:</strong> Try asking these questions before and after uploading relevant documents to see the dramatic improvement!
                </p>
              </div>
            </div>
          </div>

          {/* Right Side - Chat Interface */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold text-white mb-2">
                    {currentRole.title} Demo
                  </h2>
                  <p className="text-blue-100 text-sm">
                    Currently configured as: {currentRole.description}
                  </p>
                </div>
                
                {/* Widget Generation Button */}
                {hasUploadedFiles && sessionId && (
                  <button
                    onClick={() => setShowWidgetGenerator(true)}
                    className="bg-white text-blue-600 px-4 py-2 rounded-lg font-medium hover:bg-blue-50 transition-colors flex items-center gap-2 text-sm whitespace-nowrap"
                  >
                    <span>🚀</span>
                    Generate Bot
                  </button>
                )}
              </div>
              
              <div className="h-[600px]">
                <ChatInterface 
                  ref={chatRef}
                  systemPrompt={currentRole.systemPrompt}
                  roleContext={selectedRole}
                  suggestedQuestions={currentRole.suggestedQuestions}
                  onSessionUpdate={handleSessionUpdate}
                />
              </div>
            </div>

            {/* Simple Results Showcase */}
            <div className="mt-6 bg-white rounded-xl shadow-lg p-4">
              <div className="text-center">
                <p className="text-gray-700 mb-2">
                  The AI assistant becomes significantly more confident and accurate once you upload documents related to your questions.
                </p>
                <p className="text-xs text-gray-500">
                  Powered by RAG (Retrieval-Augmented Generation) technology
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gray-900 text-white py-8 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h3 className="text-xl font-bold mb-2">Ready to Transform Your AI?</h3>
          <p className="text-gray-600 mb-8">
            Upload documents and watch AI transform from generic to expert responses across different business roles
          </p>
          <div className="flex justify-center space-x-6 text-sm text-gray-400">
            <span>🔧 Built with Next.js + TypeScript</span>
            <span>🧠 Powered by OpenAI + Vector Search</span>
            <span>🎭 Multi-Role AI Assistant</span>
          </div>
        </div>
      </div>

      {/* Widget Generator Modal */}
      {showWidgetGenerator && sessionId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">
                  🚀 Generate Embeddable AI Bot
                </h2>
                <button
                  onClick={() => setShowWidgetGenerator(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl"
                >
                  ✕
                </button>
              </div>
              
              <WidgetGenerator
                sessionId={sessionId}
                hasUploadedFiles={hasUploadedFiles}
                roleContext={selectedRole}
                systemPrompt={currentRole.systemPrompt}
                onGenerate={handleWidgetGenerated}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
