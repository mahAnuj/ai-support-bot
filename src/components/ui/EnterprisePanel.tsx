'use client'

import React, { useState, useEffect } from 'react'
import { EnterpriseService } from '../../lib/enterprise'

interface EnterprisePanelProps {
  businessId: string
  planType: 'free' | 'pro' | 'enterprise'
}

export default function EnterprisePanel({ businessId, planType = 'free' }: EnterprisePanelProps) {
  const [activeTab, setActiveTab] = useState('overview')
  const [isLoading, setIsLoading] = useState(false)

  const tabs = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'intelligence', label: 'Business Intelligence', icon: '💼' },
    { id: 'integrations', label: 'Integrations', icon: '🔗' },
    { id: 'security', label: 'Security', icon: '🔒' },
    { id: 'analytics', label: 'Analytics', icon: '📈' },
    { id: 'customization', label: 'Branding', icon: '🎨' },
    { id: 'audit', label: 'Audit Logs', icon: '📋' }
  ]

  const [enterpriseMetrics, setEnterpriseMetrics] = useState({
    apiCalls: 0,
    webhooks: 0,
    ssoLogins: 0,
    auditEvents: 0
  })

  React.useEffect(() => {
    const fetchEnterpriseMetrics = async () => {
      try {
        const response = await fetch('/api/analytics/realtime')
        if (response.ok) {
          const data = await response.json()
          if (data.success && data.data.enterprise) {
            setEnterpriseMetrics({
              apiCalls: data.data.enterprise.api_calls_today,
              webhooks: data.data.enterprise.webhook_deliveries,
              ssoLogins: data.data.enterprise.sso_logins_today,
              auditEvents: data.data.enterprise.audit_events_today
            })
          }
        }
      } catch (error) {
        console.log('Enterprise metrics not available')
      }
    }

    fetchEnterpriseMetrics()
    const interval = setInterval(fetchEnterpriseMetrics, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleExportData = async (format: 'json' | 'csv' | 'xml') => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/enterprise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'export_data',
          businessId,
          data: { format }
        })
      })

      if (response.ok) {
        const result = await response.json()
        if (result.success && result.data) {
          const blob = new Blob([result.data], { type: `application/${format}` })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `business-data-${businessId}.${format}`
          a.click()
          URL.revokeObjectURL(url)
        }
      }
    } catch (error) {
      console.error('Export failed:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-900">Enterprise Console</h2>
          <div className="flex items-center space-x-3">
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${
              planType === 'enterprise' ? 'bg-purple-100 text-purple-800' :
              planType === 'pro' ? 'bg-blue-100 text-blue-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {planType.toUpperCase()} Plan
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8 px-6">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-4 px-2 border-b-2 font-medium text-sm flex items-center space-x-2 ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="p-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Enterprise Metrics */}
            {planType !== 'free' && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">{enterpriseMetrics.apiCalls.toLocaleString()}</div>
                  <div className="text-sm text-gray-800">API Calls Today</div>
                </div>
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">{enterpriseMetrics.webhooks.toLocaleString()}</div>
                  <div className="text-sm text-gray-800">Webhook Deliveries</div>
                </div>
                <div className="bg-purple-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-purple-600">{enterpriseMetrics.ssoLogins}</div>
                  <div className="text-sm text-gray-800">SSO Logins Today</div>
                </div>
                <div className="bg-orange-50 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-orange-600">{enterpriseMetrics.auditEvents}</div>
                  <div className="text-sm text-gray-800">Audit Events</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FeatureCard
                title="API Access"
                enabled={planType !== 'free'}
                description="Full REST API access for integrations"
              />
              <FeatureCard
                title="Custom Branding"
                enabled={planType !== 'free'}
                description="Customize colors, logos, and styling"
              />
              <FeatureCard
                title="Advanced Analytics"
                enabled={planType !== 'free'}
                description="Detailed insights and custom reports"
              />
              <FeatureCard
                title="SSO & Security"
                enabled={planType === 'enterprise'}
                description="Single sign-on and enterprise security"
              />
              <FeatureCard
                title="Webhook System"
                enabled={planType !== 'free'}
                description="Real-time data synchronization"
              />
              <FeatureCard
                title="Audit Logging"
                enabled={planType === 'enterprise'}
                description="Comprehensive compliance tracking"
              />
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold mb-3">Quick Actions</h3>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => handleExportData('json')}
                  disabled={isLoading || planType === 'free'}
                  className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {isLoading ? 'Exporting...' : 'Export Data'}
                </button>
                <button className="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700">
                  View API Docs
                </button>
                <button 
                  disabled={planType === 'free'}
                  className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Generate API Key
                </button>
                <button 
                  disabled={planType !== 'enterprise'}
                  className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700 disabled:opacity-50"
                >
                  Configure SSO
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'intelligence' && (
          <BusinessIntelligenceTab planType={planType} />
        )}

        {activeTab === 'integrations' && (
          <IntegrationsTab businessId={businessId} planType={planType} />
        )}

        {activeTab === 'security' && (
          <SecurityTab businessId={businessId} planType={planType} />
        )}

        {activeTab === 'analytics' && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Advanced Analytics</h3>
            {planType === 'free' ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">Advanced analytics available in Pro and Enterprise plans</p>
                <button className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">
                  Upgrade Plan
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">Custom Reports</h4>
                  <p className="text-sm text-gray-800">Create and schedule custom analytics reports</p>
                  <button className="mt-2 text-blue-600 hover:text-blue-800 text-sm">Configure →</button>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">Data Export</h4>
                  <p className="text-sm text-gray-800">Export conversation data and analytics</p>
                  <button className="mt-2 text-blue-600 hover:text-blue-800 text-sm">Export →</button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'customization' && (
          <div className="space-y-6">
            <h3 className="text-lg font-semibold text-gray-900">Advanced Branding & Customization</h3>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="bg-gradient-to-r from-orange-500 to-red-500 w-12 h-12 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17v4a2 2 0 002 2h4M13 13h4a2 2 0 012 2v4a2 2 0 01-2 2H9a2 2 0 01-2-2v-4a2 2 0 012-2h4z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Brand Themes</h4>
                    <p className="text-gray-600 text-sm">Complete visual customization</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="bg-gradient-to-r from-blue-400 to-blue-600 rounded-lg h-12 flex items-center justify-center text-white text-sm font-medium">
                    Brand Theme 1
                  </div>
                  <div className="bg-gradient-to-r from-purple-400 to-pink-600 rounded-lg h-12 flex items-center justify-center text-white text-sm font-medium">
                    Brand Theme 2
                  </div>
                </div>
                <button 
                  disabled={planType === 'free'}
                  className="w-full bg-orange-600 text-white py-2 rounded hover:bg-orange-700 disabled:opacity-50"
                >
                  {planType === 'free' ? 'Pro Feature' : 'Customize Themes'}
                </button>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="bg-gradient-to-r from-indigo-500 to-purple-500 w-12 h-12 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Logo & Assets</h4>
                    <p className="text-gray-600 text-sm">Upload custom logos and images</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center">
                    <svg className="mx-auto w-8 h-8 text-gray-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm text-gray-500">Upload Company Logo</p>
                  </div>
                  <button 
                    disabled={planType === 'free'}
                    className="w-full bg-indigo-600 text-white py-2 rounded hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {planType === 'free' ? 'Pro Feature' : 'Manage Assets'}
                  </button>
                </div>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="bg-gradient-to-r from-green-500 to-teal-500 w-12 h-12 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">Custom CSS</h4>
                    <p className="text-gray-600 text-sm">Advanced styling controls</p>
                  </div>
                </div>
                <div className="bg-gray-900 rounded-lg p-3 mb-3">
                  <code className="text-green-400 text-xs">
                    .chat-widget &#123;<br/>
                    &nbsp;&nbsp;border-radius: 20px;<br/>
                    &nbsp;&nbsp;box-shadow: 0 4px 20px rgba(0,0,0,0.1);<br/>
                    &#125;
                  </code>
                </div>
                <button 
                  disabled={planType !== 'enterprise'}
                  className="w-full bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:opacity-50"
                >
                  {planType !== 'enterprise' ? 'Enterprise Feature' : 'Edit Custom CSS'}
                </button>
              </div>

              <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
                <div className="flex items-center gap-4 mb-4">
                  <div className="bg-gradient-to-r from-pink-500 to-rose-500 w-12 h-12 rounded-xl flex items-center justify-center">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900">White Labeling</h4>
                    <p className="text-gray-600 text-sm">Remove all branding references</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Hide "Powered by" text</span>
                    <div className={`w-10 h-6 rounded-full ${planType === 'enterprise' ? 'bg-green-500' : 'bg-gray-300'} relative`}>
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${planType === 'enterprise' ? 'translate-x-5' : 'translate-x-1'}`}></div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Custom domain</span>
                    <div className={`w-10 h-6 rounded-full ${planType === 'enterprise' ? 'bg-green-500' : 'bg-gray-300'} relative`}>
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-transform ${planType === 'enterprise' ? 'translate-x-5' : 'translate-x-1'}`}></div>
                    </div>
                  </div>
                </div>
                <button 
                  disabled={planType !== 'enterprise'}
                  className="w-full mt-4 bg-pink-600 text-white py-2 rounded hover:bg-pink-700 disabled:opacity-50"
                >
                  {planType !== 'enterprise' ? 'Enterprise Feature' : 'Configure White Label'}
                </button>
              </div>
            </div>

            {planType === 'free' && (
              <div className="bg-gradient-to-r from-orange-50 to-red-50 rounded-xl p-6 border border-orange-200 text-center">
                <h4 className="text-lg font-bold text-orange-900 mb-2">Unlock Advanced Branding</h4>
                <p className="text-orange-700 mb-4">Customize your chat widget with advanced branding options</p>
                <button className="bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-700 font-medium">
                  Upgrade to Pro
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function FeatureCard({ title, enabled, description }: {
  title: string
  enabled: boolean
  description: string
}) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium text-gray-900">{title}</h4>
        <span className={`w-3 h-3 rounded-full ${enabled ? 'bg-green-500' : 'bg-gray-300'}`}></span>
      </div>
      <p className="text-sm text-gray-800">{description}</p>
    </div>
  )
}

function IntegrationsTab({ businessId, planType }: { businessId: string; planType: string }) {
  const [selectedIntegration, setSelectedIntegration] = useState<string | null>(null)

  const integrations = [
    { id: 'salesforce', name: 'Salesforce', icon: '☁️', enabled: planType !== 'free' },
    { id: 'hubspot', name: 'HubSpot', icon: '🟠', enabled: planType !== 'free' },
    { id: 'zendesk', name: 'Zendesk', icon: '💬', enabled: planType !== 'free' },
    { id: 'slack', name: 'Slack', icon: '💬', enabled: planType === 'enterprise' },
    { id: 'teams', name: 'Microsoft Teams', icon: '💼', enabled: planType === 'enterprise' }
  ]

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">CRM & Communication Integrations</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map(integration => (
          <div key={integration.id} className="border rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <span className="text-2xl">{integration.icon}</span>
              <div>
                <h4 className="font-medium text-gray-900">{integration.name}</h4>
                <span className={`text-xs px-2 py-1 rounded ${
                  integration.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {integration.enabled ? 'Available' : 'Upgrade Required'}
                </span>
              </div>
            </div>
            <button
              disabled={!integration.enabled}
              className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              onClick={() => setSelectedIntegration(integration.id)}
            >
              {integration.enabled ? 'Configure' : 'Upgrade to Access'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function BusinessIntelligenceTab({ planType }: { planType: string }) {
  const [analytics] = useState({
    totalChats: 12847,
    avgResponseTime: '1.2s',
    satisfactionScore: 94,
    topQuestions: ['What are your business hours?', 'How can I contact support?', 'What services do you offer?']
  })

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-green-500 to-emerald-500 rounded-2xl text-white p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-2xl font-bold mb-2">Real-time Business Intelligence</h3>
            <p className="text-green-100">Advanced analytics that drive business decisions</p>
          </div>
          <div className="bg-white/20 rounded-lg p-4 text-center">
            <div className="text-2xl font-bold">$2,847</div>
            <div className="text-sm text-green-100">Monthly Savings</div>
          </div>
        </div>
      </div>

      {/* Analytics Grid */}
      <div className="grid md:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-100 w-10 h-10 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <span className="text-green-500 text-sm font-medium">↗ +23%</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 mb-1">{analytics.totalChats.toLocaleString()}</div>
          <div className="text-gray-600 text-sm">Total Conversations</div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-green-100 w-10 h-10 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-green-500 text-sm font-medium">↗ +15%</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 mb-1">{analytics.avgResponseTime}</div>
          <div className="text-gray-600 text-sm">Avg Response Time</div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-yellow-100 w-10 h-10 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
            </div>
            <span className="text-green-500 text-sm font-medium">↗ +8%</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 mb-1">{analytics.satisfactionScore}%</div>
          <div className="text-gray-600 text-sm">Satisfaction Score</div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-purple-100 w-10 h-10 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-green-500 text-sm font-medium">↗ +45%</span>
          </div>
          <div className="text-2xl font-bold text-gray-900 mb-1">87%</div>
          <div className="text-gray-600 text-sm">Resolution Rate</div>
        </div>
      </div>

      {/* Advanced Features Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-gradient-to-r from-blue-500 to-cyan-500 w-12 h-12 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <div>
              <h4 className="font-bold text-gray-900">Smart Lead Capture</h4>
              <p className="text-gray-600 text-sm">Automatically collect visitor information</p>
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4 text-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-700">Leads Generated Today:</span>
              <span className="font-bold text-green-600">+47</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-gradient-to-r from-green-400 to-blue-500 h-2 rounded-full" style={{width: '78%'}}></div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-100">
          <div className="flex items-center gap-4 mb-4">
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 w-12 h-12 rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
              </svg>
            </div>
            <div>
              <h4 className="font-bold text-gray-900">Multi-language Support</h4>
              <p className="text-gray-600 text-sm">Serve global customers in their language</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {['🇺🇸 English', '🇪🇸 Spanish', '🇫🇷 French', '🇩🇪 German', '+12 more'].map((lang, i) => (
              <span key={i} className="bg-purple-50 text-purple-700 px-3 py-1 rounded-full text-xs font-medium">
                {lang}
              </span>
            ))}
          </div>
        </div>

        
      </div>

      {planType === 'free' && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200 text-center">
          <h4 className="text-lg font-bold text-blue-900 mb-2">Unlock Business Intelligence</h4>
          <p className="text-blue-700 mb-4">Get real-time insights and advanced features with Pro or Enterprise plans</p>
          <button className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 font-medium">
            Upgrade to Pro
          </button>
        </div>
      )}
    </div>
  )
}

function SecurityTab({ businessId, planType }: { businessId: string; planType: string }) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900">Security & Access Control</h3>

      <div className="space-y-4">
        <div className="border rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div>
              <h4 className="font-medium text-gray-900">Single Sign-On (SSO)</h4>
              <p className="text-sm text-gray-800">SAML/OAuth integration for enterprise authentication</p>
            </div>
            <button 
              disabled={planType === 'free'}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {planType === 'free' ? 'Pro Feature' : 'Configure SSO'}
            </button>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div>
              <h4 className="font-medium text-gray-900">IP Whitelisting</h4>
              <p className="text-sm text-gray-800">Restrict access to specific IP addresses</p>
            </div>
            <button 
              disabled={planType !== 'enterprise'}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {planType !== 'enterprise' ? 'Enterprise Feature' : 'Manage IPs'}
            </button>
          </div>
        </div>

        <div className="border rounded-lg p-4">
          <div className="flex justify-between items-center">
            <div>
              <h4 className="font-medium text-gray-900">Audit Logging</h4>
              <p className="text-sm text-gray-800">Comprehensive activity logs for compliance</p>
            </div>
            <button 
              disabled={planType !== 'enterprise'}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {planType !== 'enterprise' ? 'Enterprise Feature' : 'View Logs'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}