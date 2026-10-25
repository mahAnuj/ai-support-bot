import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { VALIDATE_TIMEOUT_MS, ownerProvider } from '../../../../lib/model/provider'
import { modelErrorResponse } from '../../../../lib/model/resolve'
import { ModelError, isModelError, type ModelErrorCode, type OwnerModelConfig } from '../../../../lib/model/shared'
import { isPrivateModelHostAllowed, validateModelInput } from '../../../../lib/model/url-guard'
import { fingerprint } from '../../../../lib/storage/log'
import { isStorageEnabled, sealModelToken } from '../../../../lib/storage/token'

export const dynamic = 'force-dynamic'

// The field caps (500 + 200 + 512 chars) fit well inside this even with JSON escaping.
const MAX_BODY_BYTES = 8192

// Reads at most MAX_BODY_BYTES from the stream, so an oversized body is never buffered or parsed.
async function readBody(request: NextRequest): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (!request.body) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(value)
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks))
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function trimmed(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value
}

function fail(code: ModelErrorCode, fp?: string): NextResponse {
  console.log(`model validate outcome=${code}${fp ? ` model=#${fp}` : ''}`)
  return modelErrorResponse(new ModelError(code))
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`model-validate:${clientIp(request)}`, 5)) return fail('model_validate_rate_limited')
  if (!isStorageEnabled()) return fail('model_unavailable')

  const body = await readBody(request)
  if (!body) return fail('model_invalid_url')

  const validated = validateModelInput(
    { baseUrl: trimmed(body.baseUrl), model: trimmed(body.model), apiKey: trimmed(body.apiKey) },
    { allowPrivate: isPrivateModelHostAllowed() },
  )
  if (!validated.ok) return fail(validated.code)
  const config: OwnerModelConfig = validated.config
  const fp = fingerprint(config.baseUrl + '\n' + config.model)

  try {
    await ownerProvider(config).complete({
      messages: [{ role: 'user', content: 'Reply with the word OK.' }],
      maxTokens: 16,
      temperature: 0,
      timeoutMs: VALIDATE_TIMEOUT_MS,
    })
  } catch (e) {
    // The adapter only throws ModelError; anything else is reported as unreachable, never echoed.
    const err = isModelError(e) ? e : new ModelError('model_unreachable')
    console.log(`model validate outcome=${err.code} model=#${fp}`)
    return modelErrorResponse(err)
  }

  let modelToken: string
  try {
    modelToken = sealModelToken(config)
  } catch {
    return fail('model_unavailable', fp)
  }

  console.log(`model validate outcome=ok model=#${fp}`)
  return NextResponse.json({ modelToken, model: config.model, host: new URL(config.baseUrl).host })
}
