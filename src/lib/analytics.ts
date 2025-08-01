
import type { 
  Widget, 
  WidgetConversation, 
  WidgetMessage, 
  Business 
} from '../types/database'

// Enhanced analytics types
export interface ConversationMetrics {
  total_conversations: number
  active_conversations: number
  avg_messages_per_conversation: number
  avg_response_time_ms: number
  satisfaction_score: number
  resolution_rate: number
}

export interface UsageMetrics {
  queries_today: number
  queries_this_week: number
  queries_this_month: number
  peak_concurrent_users: number
  bandwidth_used_mb: number
}

export interface PerformanceMetrics {
  avg_response_time: number
  uptime_percentage: number
  error_rate: number
  cache_hit_rate: number
}

export interface RealtimeStats {
  timestamp: Date
  active_widgets: number
  active_conversations: number
  messages_per_minute: number
  avg_confidence_score: number
  top_queries: string[]
  error_count: number
}

// In-memory analytics storage (extend your existing database)
interface AnalyticsDatabase {
  conversations: Map<string, WidgetConversation>
  messages: Map<string, WidgetMessage>
  realtimeStats: RealtimeStats[]
  businessMetrics: Map<string, ConversationMetrics>
  usageMetrics: Map<string, UsageMetrics>
  performanceMetrics: Map<string, PerformanceMetrics>
}

// Extend your existing database
declare global {
  var __analyticsDatabase: AnalyticsDatabase | undefined
}

const createAnalyticsDatabase = (): AnalyticsDatabase => ({
  conversations: new Map(),
  messages: new Map(),
  realtimeStats: [],
  businessMetrics: new Map(),
  usageMetrics: new Map(),
  performanceMetrics: new Map()
})

let analyticsDb: AnalyticsDatabase

if (process.env.NODE_ENV === 'development' && global.__analyticsDatabase) {
  analyticsDb = global.__analyticsDatabase
} else {
  analyticsDb = createAnalyticsDatabase()
  if (process.env.NODE_ENV === 'development') {
    global.__analyticsDatabase = analyticsDb
  }
}

// Analytics functions
export async function trackConversation(
  widgetId: string,
  sessionId: string,
  userAgent?: string,
  domain?: string
): Promise<string> {
  const conversationId = generateUUID()
  
  const conversation: WidgetConversation = {
    id: conversationId,
    widget_id: widgetId,
    session_id: sessionId,
    user_agent: userAgent,
    domain: domain,
    messages_count: 0,
    started_at: new Date(),
    last_message_at: new Date()
  }
  
  analyticsDb.conversations.set(conversationId, conversation)
  updateRealtimeStats()
  
  return conversationId
}

export async function trackMessage(
  conversationId: string,
  messageType: 'user' | 'assistant',
  content: string,
  confidenceScore?: number,
  sourcesUsed?: string[],
  responseTimeMs?: number
): Promise<void> {
  const messageId = generateUUID()
  
  const message: WidgetMessage = {
    id: messageId,
    conversation_id: conversationId,
    message_type: messageType,
    content,
    confidence_score: confidenceScore,
    sources_used: sourcesUsed,
    response_time_ms: responseTimeMs,
    created_at: new Date()
  }
  
  analyticsDb.messages.set(messageId, message)
  
  // Update conversation
  const conversation = analyticsDb.conversations.get(conversationId)
  if (conversation) {
    conversation.messages_count++
    conversation.last_message_at = new Date()
    analyticsDb.conversations.set(conversationId, conversation)
  }
  
  updateRealtimeStats()
}

export async function getRealtimeStats(): Promise<RealtimeStats> {
  const now = new Date()
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000)
  
  // Calculate real-time metrics
  const activeConversations = Array.from(analyticsDb.conversations.values())
    .filter(conv => new Date(conv.last_message_at).getTime() > oneMinuteAgo.getTime()).length
  
  const recentMessages = Array.from(analyticsDb.messages.values())
    .filter(msg => msg.created_at.getTime() > oneMinuteAgo.getTime())
  
  const messagesPerMinute = recentMessages.length
  
  const avgConfidence = recentMessages
    .filter(msg => msg.confidence_score !== undefined)
    .reduce((sum, msg) => sum + (msg.confidence_score || 0), 0) / 
    Math.max(recentMessages.filter(msg => msg.confidence_score !== undefined).length, 1)
  
  const topQueries = getTopQueries(recentMessages.filter(msg => msg.message_type === 'user'))
  
  return {
    timestamp: now,
    active_widgets: new Set(Array.from(analyticsDb.conversations.values()).map(c => c.widget_id)).size,
    active_conversations: activeConversations,
    messages_per_minute: messagesPerMinute,
    avg_confidence_score: avgConfidence,
    top_queries: topQueries,
    error_count: 0 // Track errors separately
  }
}

export async function getBusinessMetrics(businessId: string): Promise<ConversationMetrics> {
  const conversations = Array.from(analyticsDb.conversations.values())
  const messages = Array.from(analyticsDb.messages.values())
  
  const totalConversations = conversations.length
  const activeConversations = conversations.filter(
    conv => new Date(conv.last_message_at).getTime() > Date.now() - 5 * 60 * 1000
  ).length
  
  const avgMessages = conversations.reduce((sum, conv) => sum + conv.messages_count, 0) / 
    Math.max(totalConversations, 1)
  
  const assistantMessages = messages.filter(msg => msg.message_type === 'assistant')
  const avgResponseTime = assistantMessages.reduce((sum, msg) => sum + (msg.response_time_ms || 0), 0) / 
    Math.max(assistantMessages.length, 1)
  
  const avgConfidence = assistantMessages
    .filter(msg => msg.confidence_score !== undefined)
    .reduce((sum, msg) => sum + (msg.confidence_score || 0), 0) / 
    Math.max(assistantMessages.filter(msg => msg.confidence_score !== undefined).length, 1)
  
  return {
    total_conversations: totalConversations,
    active_conversations: activeConversations,
    avg_messages_per_conversation: avgMessages,
    avg_response_time_ms: avgResponseTime,
    satisfaction_score: avgConfidence,
    resolution_rate: 0.85 // Calculate based on conversation completion
  }
}

function updateRealtimeStats(): void {
  // Keep only last 24 hours of stats
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
  analyticsDb.realtimeStats = analyticsDb.realtimeStats.filter(
    stat => stat.timestamp.getTime() > cutoff.getTime()
  )
}

function getTopQueries(userMessages: WidgetMessage[]): string[] {
  const queryCount = new Map<string, number>()
  
  userMessages.forEach(msg => {
    const query = msg.content.toLowerCase().substring(0, 50)
    queryCount.set(query, (queryCount.get(query) || 0) + 1)
  })
  
  return Array.from(queryCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([query]) => query)
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}
