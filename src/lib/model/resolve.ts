// Server-only: the owner model for builder routes comes from x-model-token and nothing else.
import { NextResponse } from 'next/server'
import {
  isBuilderTokenShape,
  isConnectorTokenShape,
  isStorageEnabled,
  isWidgetTokenShape,
  openModelToken,
} from '../storage/token'
import { MODEL_ERROR_STATUS, MODEL_TOKEN_HEADER, ModelError, modelErrorMessage, type OwnerModelConfig } from './shared'

export type BuilderModelResolution = { ok: true; model: OwnerModelConfig | null } | { ok: false; error: ModelError }

function modelError(code: ModelError['code']): BuilderModelResolution {
  return { ok: false, error: new ModelError(code) }
}

// Sync and I/O-free. With no header the demo model is used.
export function resolveBuilderModel(request: Request): BuilderModelResolution {
  const header = request.headers.get(MODEL_TOKEN_HEADER)
  if (header === null) return { ok: true, model: null }
  if (!isStorageEnabled()) return modelError('model_unavailable')
  if (isBuilderTokenShape(header) || isWidgetTokenShape(header) || isConnectorTokenShape(header)) return modelError('model_token_wrong_purpose')

  const model = openModelToken(header)
  if (!model) return modelError('model_token_invalid')
  return { ok: true, model }
}

export function modelErrorResponse(err: ModelError): NextResponse {
  const message = modelErrorMessage(err.code, err.httpStatus)
  return NextResponse.json({ error: message, code: err.code, details: message }, { status: MODEL_ERROR_STATUS[err.code] })
}
