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
    <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg p-4 mt-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="text-purple-600">🚀</div>
        <h3 className="text-lg font-semibold text-purple-900">
          Generate Embeddable Widget
        </h3>
        {hasUploadedFiles && (
          <span className="text-green-600 text-sm">✅ Ready to generate</span>
        )}
      </div>

      {!hasUploadedFiles && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p className="text-yellow-800 text-sm">
            ⚠️ Upload documents first to train your AI assistant before generating the widget
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Widget Name
          </label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => setConfig({ ...config, name: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm"
            placeholder="Support Widget"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Widget Title
          </label>
          <input
            type="text"
            value={config.title}
            onChange={(e) => setConfig({ ...config, title: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm"
            placeholder="AI Support Assistant"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Welcome Message
          </label>
          <input
            type="text"
            value={config.welcome_message}
            onChange={(e) => setConfig({ ...config, welcome_message: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm"
            placeholder="Hi! How can I help you today?"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Primary Color
          </label>
          <input
            type="color"
            value={config.primary_color}
            onChange={(e) => setConfig({ ...config, primary_color: e.target.value })}
            className="w-full p-1 border border-gray-300 rounded-md h-10"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Position
          </label>
          <select
            value={config.position}
            onChange={(e) => setConfig({ ...config, position: e.target.value as any })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="bottom-right">Bottom Right</option>
            <option value="bottom-left">Bottom Left</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Size
          </label>
          <select
            value={config.size}
            onChange={(e) => setConfig({ ...config, size: e.target.value as any })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </select>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <button
          onClick={handleGenerate}
          disabled={!hasUploadedFiles || isGenerating}
          className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium text-lg"
        >
          {isGenerating ? '⏳ Generating Widget...' : '🚀 Generate Embeddable Widget'}
        </button>
      </div>

      {generatedScript && (
        <div className="space-y-4">
          <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="text-green-600 text-xl">🎉</div>
              <h4 className="font-bold text-green-900 text-lg">
                Widget Generated Successfully!
              </h4>
            </div>
            <p className="text-green-800 text-sm mb-4">
              Your embeddable AI assistant is ready! Copy the script below and paste it into your website.
              {widgetKey && (
                <span className="block mt-1 text-xs text-green-600">
                  Widget Key: {widgetKey}
                </span>
              )}
            </p>
          </div>

          <div className="bg-white border-2 border-blue-300 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-bold text-blue-900">
                📋 Your Embeddable Script
              </h4>
              <div className="flex gap-2">
                <button
                  onClick={copyToClipboard}
                  className="text-sm bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-medium"
                >
                  📋 Copy Script
                </button>
                <button
                  onClick={downloadScript}
                  className="text-sm bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 font-medium"
                >
                  💾 Download
                </button>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="text-sm bg-gray-100 text-gray-700 px-3 py-2 rounded hover:bg-gray-200"
                >
                  {showPreview ? 'Hide Code' : 'View Code'}
                </button>
              </div>
            </div>
            
            {showPreview ? (
              <div>
                <p className="text-sm text-gray-600 mb-2">Copy this entire script and paste it before the &lt;/body&gt; tag on your website:</p>
                <pre className="bg-gray-50 p-3 rounded text-xs overflow-x-auto max-h-60 font-mono border">
                  {generatedScript}
                </pre>
              </div>
            ) : (
              <div className="bg-blue-50 p-4 rounded border-l-4 border-blue-400">
                <p className="text-blue-800 font-medium mb-2">Ready to embed!</p>
                <p className="text-blue-700 text-sm">
                  Click "Copy Script" above to get your embeddable code, then paste it into your website's HTML.
                </p>
              </div>
            )}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-medium text-blue-900 mb-2">🚀 How to Use:</h4>
            <ol className="text-sm text-blue-800 space-y-1">
              <li>1. <strong>Copy</strong> the generated script above</li>
              <li>2. <strong>Paste</strong> it into your website's HTML before the closing &lt;/body&gt; tag</li>
              <li>3. <strong>Save and publish</strong> your website</li>
              <li>4. <strong>Visitors</strong> will see the AI chat widget and can ask questions</li>
              <li>5. <strong>The AI</strong> will respond using your uploaded documents for accurate answers!</li>
            </ol>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <h4 className="font-medium text-green-900 mb-2">✨ Widget Features:</h4>
            <ul className="text-sm text-green-800 space-y-1">
              <li>• <strong>Zero setup required</strong> - works immediately after pasting</li>
              <li>• <strong>Mobile responsive</strong> - automatically adapts to phone screens</li>
              <li>• <strong>Trained AI</strong> - uses your uploaded documents for smart answers</li>
              <li>• <strong>Professional design</strong> - matches your brand colors</li>
              <li>• <strong>Secure</strong> - your documents are private and isolated</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

export default WidgetGenerator 