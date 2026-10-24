import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { StorageError } from '../../../../lib/storage/errors'
import { storageErrorResponse } from '../../../../lib/storage/resolve'
import { isStorageEnabled } from '../../../../lib/storage/token'

// Read EMBED_TOKEN_KEY per request; a static build would bake in the build-time env.
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-status:${clientIp(request)}`, 60)) {
    return storageErrorResponse(new StorageError('rate_limited'))
  }
  return NextResponse.json({ available: isStorageEnabled() })
}
