'use client'

import React, { useState } from 'react'

interface WidgetGeneratorProps {
  sessionId: string
  hasUploadedFiles: boolean
  roleContext?: string
  systemPrompt?: string
  onGenerate?: (widgetKey: string) => void
}

const WidgetGenerator: React.FC<WidgetGeneratorProps> = ({
  sessionId,
  hasUploadedFiles,
  roleContext,
  systemPrompt,
  onGenerate
}) => {
  const [config, setConfig] = useState({
    name: 'Support Widget',
    title: 'AI Support Assistant',
    welcome_message: 'Hi! How can I help you today?',
    primary_color: '#3B82F6',
    position: 'bottom-right' as 'bottom-right' | 'bottom-left',
    size: 'medium' as 'small' | 'medium' | 'large'
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedScript, setGeneratedScript] = useState<string>('')
  const [widgetKey, setWidgetKey] = useState<string>('')
  const [showPreview, setShowPreview] = useState(false)
  const [isTestingOnSite, setIsTestingOnSite] = useState(false)

  const handleGenerate = async () => {
    if (!hasUploadedFiles) {
      alert('Please upload documents first to train your AI assistant')
      return
    }

    setIsGenerating(true)
    try {
      const response = await fetch('/api/widget/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          ...config,
          system_prompt: systemPrompt,
          role_context: roleContext
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate widget')
      }

      const data = await response.json()
      console.log('Widget generation response:', data)
      
      if (data.embedCode) {
        setGeneratedScript(data.embedCode)
        setWidgetKey(data.widgetKey)
        setShowPreview(false) // Reset preview state
        onGenerate?.(data.widgetKey)
      } else {
        console.error('No embedCode in response:', data)
        alert('Widget generated but no script received. Please try again.')
      }
      
    } catch (error) {
      console.error('Error generating widget:', error)
      alert('Failed to generate widget. Please try again.')
    } finally {
      setIsGenerating(false)
    }
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedScript)
      alert('Script copied to clipboard!')
    } catch (error) {
      console.error('Failed to copy:', error)
      alert('Failed to copy script')
    }
  }

  const downloadScript = () => {
    const blob = new Blob([generatedScript], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-support-widget-${widgetKey.slice(0, 8)}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Value Proposition Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="text-3xl">🚀</div>
          <div>
            <h3 className="text-2xl font-bold">
              Deploy Your Business AI Assistant
            </h3>
            <p className="text-blue-100">
              Transform your customer support with intelligent, document-trained AI
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
            <div className="font-semibold mb-1">⚡ Instant Setup</div>
            <div className="text-blue-100">Copy-paste one script and go live</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
            <div className="font-semibold mb-1">🧠 Business Intelligence</div>
            <div className="text-blue-100">Trained on your specific documents</div>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-lg p-3">
            <div className="font-semibold mb-1">💰 Cost Effective</div>
            <div className="text-blue-100">Reduce support workload by 60%+</div>
          </div>
        </div>
      </div>

      {!hasUploadedFiles && (
        <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <div className="text-2xl">⚠️</div>
            <div>
              <h4 className="font-semibold text-amber-800 mb-1">Upload Your Business Documents First</h4>
              <p className="text-amber-700 text-sm">
                Your AI assistant needs training data to provide accurate, business-specific responses. 
                Upload your PDFs, manuals, FAQs, or policies to create a truly intelligent assistant.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Configuration Form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h4 className="text-lg font-bold text-gray-900 mb-4">
          🎨 Customize Your AI Assistant
        </h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Business Name / Widget Title
            </label>
            <input
              type="text"
              value={config.title}
              onChange={(e) => setConfig({ ...config, title: e.target.value })}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Support Assistant"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Welcome Message
            </label>
            <input
              type="text"
              value={config.welcome_message}
              onChange={(e) => setConfig({ ...config, welcome_message: e.target.value })}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Hi! How can I help you with your questions?"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Brand Color
            </label>
            <div className="flex items-center space-x-3">
              <input
                type="color"
                value={config.primary_color}
                onChange={(e) => setConfig({ ...config, primary_color: e.target.value })}
                className="w-12 h-12 border border-gray-300 rounded-lg cursor-pointer"
              />
              <div className="text-sm text-gray-600">
                Choose your brand color to match your website
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Widget Position
            </label>
            <select
              value={config.position}
              onChange={(e) => setConfig({ ...config, position: e.target.value as any })}
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="bottom-right">Bottom Right (Recommended)</option>
              <option value="bottom-left">Bottom Left</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Widget Size
            </label>
            <div className="grid grid-cols-3 gap-3">
              {['small', 'medium', 'large'].map((size) => (
                <button
                  key={size}
                  onClick={() => setConfig({ ...config, size: size as any })}
                  className={`p-3 border-2 rounded-lg text-center transition-all ${
                    config.size === size 
                      ? 'border-blue-500 bg-blue-50 text-blue-700' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium capitalize">{size}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    {size === 'small' && 'Compact & subtle'}
                    {size === 'medium' && 'Perfect balance'}
                    {size === 'large' && 'Maximum visibility'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <div className="text-center">
        <button
          onClick={handleGenerate}
          disabled={!hasUploadedFiles || isGenerating}
          className={`px-8 py-4 rounded-xl font-bold text-lg transition-all ${
            hasUploadedFiles && !isGenerating
              ? 'bg-gradient-to-r from-green-500 to-blue-600 text-white hover:from-green-600 hover:to-blue-700 transform hover:scale-105 shadow-lg'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isGenerating ? (
            <span className="flex items-center space-x-2">
              <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
              <span>Creating Your AI Assistant...</span>
            </span>
          ) : (
            <span className="flex items-center space-x-2">
              <span>🚀</span>
              <span>Generate Embeddable AI Assistant</span>
            </span>
          )}
        </button>
        
        {!hasUploadedFiles && (
          <p className="text-sm text-gray-500 mt-2">
            Upload your business documents above to enable generation
          </p>
        )}
      </div>

      {generatedScript && (
        <div className="space-y-6">
          {/* Success Message */}
          <div className="bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl p-6">
            <div className="flex items-center space-x-3 mb-4">
              <div className="text-3xl">🎉</div>
              <div>
                <h4 className="text-2xl font-bold">
                  Your AI Assistant is Ready!
                </h4>
                <p className="text-green-100">
                  Trained on your documents and ready to help your customers 24/7
                </p>
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
          <div className="bg-white border-2 border-blue-300 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-xl font-bold text-blue-900">
                  📋 Your Embeddable Script
                </h4>
                <p className="text-blue-700 text-sm">Copy this code and paste it into your website</p>
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
            
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700">Embeddable Code</span>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  {showPreview ? 'Hide Code' : 'View Code'}
                </button>
              </div>
              
              {showPreview ? (
                <pre className="bg-gray-900 text-green-400 p-4 rounded text-xs overflow-x-auto max-h-60 font-mono">
                  {generatedScript}
                </pre>
              ) : (
                <div className="bg-blue-50 border border-blue-200 rounded p-4">
                  <p className="text-blue-800 font-medium">Ready to embed!</p>
                  <p className="text-blue-700 text-sm mt-1">
                    Click "Copy Script" to get your code, then paste it before the &lt;/body&gt; tag in your website.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Implementation Guide */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
        </div>
      )}
    </div>
  )
}

export default WidgetGenerator 