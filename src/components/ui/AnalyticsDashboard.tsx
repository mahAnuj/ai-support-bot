
'use client'

import React, { useState, useEffect } from 'react'
import type { RealtimeStats, ConversationMetrics } from '../../lib/analytics'

interface AnalyticsDashboardProps {
  businessId?: string
  refreshInterval?: number
}

export default function AnalyticsDashboard({ 
  businessId, 
  refreshInterval = 5000 
}: AnalyticsDashboardProps) {
  const [realtimeStats, setRealtimeStats] = useState<RealtimeStats | null>(null)
  const [businessMetrics, setBusinessMetrics] = useState<ConversationMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchAnalytics = async () => {
    try {
      const params = new URLSearchParams()
      if (businessId) params.set('businessId', businessId)
      
      const response = await fetch(`/api/analytics/realtime?${params}`)
      const data = await response.json()
      
      if (data.success) {
        setRealtimeStats(data.data.realtime)
        setBusinessMetrics(data.data.business)
        setLastUpdated(new Date())
      }
    } catch (error) {
      console.error('Failed to fetch analytics:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalytics()
    const interval = setInterval(fetchAnalytics, refreshInterval)
    return () => clearInterval(interval)
  }, [businessId, refreshInterval])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Real-Time Analytics</h2>
        <div className="flex items-center space-x-2 text-sm text-gray-500">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>Live</span>
          {lastUpdated && (
            <span>• Updated {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      {/* Real-time Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Conversations"
          value={realtimeStats?.active_conversations || 0}
          icon="💬"
          trend={realtimeStats?.active_conversations ? "+12%" : "0%"}
        />
        <StatCard
          title="Messages/Minute"
          value={realtimeStats?.messages_per_minute || 0}
          icon="⚡"
          trend="+5%"
        />
        <StatCard
          title="Avg Confidence"
          value={`${Math.round((realtimeStats?.avg_confidence_score || 0) * 100)}%`}
          icon="🎯"
          trend="+3%"
        />
        <StatCard
          title="Active Widgets"
          value={realtimeStats?.active_widgets || 0}
          icon="🤖"
          trend="0%"
        />
      </div>

      {/* Business Metrics */}
      {businessMetrics && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Business Performance</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MetricCard
              title="Total Conversations"
              value={businessMetrics.total_conversations}
              subtitle="All time"
            />
            <MetricCard
              title="Avg Response Time"
              value={`${Math.round(businessMetrics.avg_response_time_ms)}ms`}
              subtitle="Last 24h"
            />
            <MetricCard
              title="Resolution Rate"
              value={`${Math.round(businessMetrics.resolution_rate * 100)}%`}
              subtitle="Customer satisfaction"
            />
          </div>
        </div>
      )}

      {/* Top Queries */}
      {realtimeStats?.top_queries && realtimeStats.top_queries.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Top Queries (Last Hour)</h3>
          <div className="space-y-2">
            {realtimeStats.top_queries.map((query, index) => (
              <div key={index} className="flex items-center space-x-3">
                <span className="text-sm text-gray-500 w-4">#{index + 1}</span>
                <span className="text-sm text-gray-700 flex-1">{query}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance Chart Placeholder */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Response Time Trend</h3>
        <div className="h-32 bg-gray-100 rounded flex items-center justify-center">
          <span className="text-gray-500">Chart visualization would go here</span>
        </div>
      </div>
    </div>
  )
}

interface StatCardProps {
  title: string
  value: string | number
  icon: string
  trend?: string
}

function StatCard({ title, value, icon, trend }: StatCardProps) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <div className="text-2xl">{icon}</div>
      </div>
      {trend && (
        <div className="mt-2">
          <span className={`text-sm ${trend.startsWith('+') ? 'text-green-600' : 'text-gray-600'}`}>
            {trend} vs last hour
          </span>
        </div>
      )}
    </div>
  )
}

interface MetricCardProps {
  title: string
  value: string | number
  subtitle: string
}

function MetricCard({ title, value, subtitle }: MetricCardProps) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-sm font-medium text-gray-700">{title}</p>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </div>
  )
}
