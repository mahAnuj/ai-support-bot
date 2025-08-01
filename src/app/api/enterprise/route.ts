
import { NextRequest, NextResponse } from 'next/server'
import { EnterpriseService } from '../../../lib/enterprise'

export async function POST(request: NextRequest) {
  try {
    const { action, businessId, data } = await request.json()

    switch (action) {
      case 'export_data':
        const exportData = await EnterpriseService.exportBusinessData(
          businessId, 
          data.format || 'json'
        )
        return NextResponse.json({
          success: true,
          data: exportData
        })

      case 'configure_sso':
        const ssoResult = await EnterpriseService.enableSSO(businessId, data.ssoConfig)
        return NextResponse.json({
          success: ssoResult,
          message: ssoResult ? 'SSO configured successfully' : 'SSO configuration failed'
        })

      case 'setup_integration':
        const integrationId = await EnterpriseService.configureCRMIntegration(
          businessId, 
          data.integration
        )
        return NextResponse.json({
          success: !!integrationId,
          integrationId,
          message: integrationId ? 'Integration configured' : 'Integration setup failed'
        })

      case 'validate_feature':
        const hasAccess = await EnterpriseService.validateBusinessAccess(
          businessId, 
          data.feature
        )
        return NextResponse.json({
          success: true,
          hasAccess
        })

      default:
        return NextResponse.json({
          success: false,
          error: 'Unknown action'
        }, { status: 400 })
    }
  } catch (error) {
    console.error('Enterprise API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const businessId = searchParams.get('businessId')
    const action = searchParams.get('action')

    if (!businessId) {
      return NextResponse.json({
        success: false,
        error: 'Business ID required'
      }, { status: 400 })
    }

    switch (action) {
      case 'audit_logs':
        // Demo audit logs
        return NextResponse.json({
          success: true,
          data: [
            {
              id: '1',
              action: 'sso_login',
              user: 'john.doe@company.com',
              timestamp: new Date().toISOString(),
              ip: '192.168.1.100'
            },
            {
              id: '2',
              action: 'data_export',
              user: 'admin@company.com',
              timestamp: new Date(Date.now() - 3600000).toISOString(),
              details: { format: 'json', size: '2.4MB' }
            }
          ]
        })

      case 'integrations':
        return NextResponse.json({
          success: true,
          data: [
            { id: '1', type: 'salesforce', status: 'active', lastSync: new Date().toISOString() },
            { id: '2', type: 'hubspot', status: 'active', lastSync: new Date().toISOString() },
            { id: '3', type: 'slack', status: 'pending', lastSync: null }
          ]
        })

      default:
        return NextResponse.json({
          success: false,
          error: 'Unknown action'
        }, { status: 400 })
    }
  } catch (error) {
    console.error('Enterprise API error:', error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 })
  }
}
