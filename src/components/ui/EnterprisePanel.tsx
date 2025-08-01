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

        {activeTab === 'integrations' && (
          <IntegrationsTab businessId={businessId} planType={planType} />
        )}

        {activeTab === 'security' && (
          <SecurityTab businessId={businessId} planType={planType} />
        )}

        {activeTab === 'analytics' && (
          <div>
            <h3 className="text-lg font-semibold mb-4">Advanced Analytics</h3>
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
                  <h4 className="font-medium mb-2">Custom Reports</h4>
                  <p className="text-sm text-gray-800">Create and schedule custom analytics reports</p>
                  <button className="mt-2 text-blue-600 hover:text-blue-800 text-sm">Configure →</button>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium mb-2">Data Export</h4>
                  <p className="text-sm text-gray-800">Export conversation data and analytics</p>
                  <button className="mt-2 text-blue-600 hover:text-blue-800 text-sm">Export →</button>
                </div>
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
      <h3 className="text-lg font-semibold">CRM & Communication Integrations</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {integrations.map(integration => (
          <div key={integration.id} className="border rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-3">
              <span className="text-2xl">{integration.icon}</span>
              <div>
                <h4 className="font-medium">{integration.name}</h4>
                <span className={`text-xs px-2 py-1 rounded ${
                  integration.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
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

function SecurityTab({ businessId, planType }: { businessId: string; planType: string }) {
  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold">Security & Access Control</h3>

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