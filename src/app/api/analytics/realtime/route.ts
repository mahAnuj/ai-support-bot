
import { NextRequest, NextResponse } from 'next/server'
import { getRealtimeStats, getBusinessMetrics } from '../../../../lib/analytics'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const businessId = searchParams.get('businessId')
    
    // Get real-time stats
    const realtimeStats = await getRealtimeStats()
    
    // Get business-specific metrics if businessId provided
    let businessMetrics = null
    if (businessId) {
      businessMetrics = await getBusinessMetrics(businessId)
    }
    
    return NextResponse.json({
      success: true,
      data: {
        realtime: realtimeStats,
        business: businessMetrics
      }
    })
  } catch (error) {
    console.error('Analytics API error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}
