// Client-safe: no node imports. Imported by both API routes and browser components.

export const MODEL_TOKEN_HEADER = 'x-model-token'
export const MODEL_LOCALSTORAGE_KEY = 'ai-support-bot.model'

export const MODEL_LIMITS = { baseUrl: 500, modelId: 200, apiKey: 512 } as const

export const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/@-]{1,200}$/
export const API_KEY_PATTERN = /^[\x21-\x7E]{1,512}$/

export const PROVIDER_PRESETS = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  together: { label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  other: { label: 'Other OpenAI-compatible', baseUrl: '' },
} as const

export type ProviderPresetId = keyof typeof PROVIDER_PRESETS

export interface OwnerModelConfig {
  baseUrl: string
  model: string
  apiKey: string
}

export function isGptOssModel(id: string): boolean {
  return id.includes('gpt-oss')
}

export const MODEL_ERROR_CODES = [
  'model_unavailable', 'model_invalid_url', 'model_url_too_long', 'model_https_required', 'model_invalid_id',
  'model_invalid_key', 'model_address_blocked', 'model_auth_rejected', 'model_not_found', 'model_rate_limited',
  'model_bad_params', 'model_unreachable', 'model_bad_response', 'model_http_error', 'model_token_invalid',
  'model_token_wrong_purpose', 'model_validate_rate_limited',
] as const

export type ModelErrorCode = typeof MODEL_ERROR_CODES[number]

export const MODEL_ERROR_STATUS: Record<ModelErrorCode, number> = {
  model_unavailable: 503,
  model_invalid_url: 400,
  model_url_too_long: 400,
  model_https_required: 400,
  model_invalid_id: 400,
  model_invalid_key: 400,
  model_address_blocked: 400,
  model_auth_rejected: 422,
  model_not_found: 422,
  model_rate_limited: 422,
  model_bad_params: 422,
  model_unreachable: 502,
  model_bad_response: 502,
  model_http_error: 502,
  model_token_invalid: 401,
  model_token_wrong_purpose: 403,
  model_validate_rate_limited: 429,
}

export const MODEL_ERROR_MESSAGES: Record<ModelErrorCode, string> = {
  model_unavailable: "Using your own model isn't available on this deployment.",
  model_invalid_url: "That doesn't look like an API base URL. It should look like https://api.example.com/v1.",
  model_url_too_long: `That address is longer than ${MODEL_LIMITS.baseUrl} characters.`,
  model_https_required: 'Use an https:// address.',
  model_invalid_id: `Model IDs are up to ${MODEL_LIMITS.modelId} characters: letters, numbers and . _ : / @ -`,
  model_invalid_key: `API keys are up to ${MODEL_LIMITS.apiKey} characters with no spaces.`,
  model_address_blocked: "This address isn't allowed.",
  model_auth_rejected: 'The provider rejected this API key.',
  model_not_found: "The provider doesn't recognise this model ID.",
  model_rate_limited: 'The provider is rate-limiting this key. Try again shortly.',
  model_bad_params: 'The model rejected the request parameters.',
  model_unreachable: "Couldn't reach this address.",
  model_bad_response: "This address didn't answer like an OpenAI-compatible API.",
  model_http_error: 'The provider returned an error.',
  model_token_invalid: "This browser's saved model is no longer valid. Add your model again.",
  model_token_wrong_purpose: "This key can't be used here.",
  model_validate_rate_limited: 'Too many checks from this network. Wait a minute and try again.',
}

export function isModelErrorCode(value: unknown): value is ModelErrorCode {
  return typeof value === 'string' && (MODEL_ERROR_CODES as readonly string[]).includes(value)
}

function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
}

export function modelErrorMessage(code: unknown, httpStatus?: unknown): string {
  if (!isModelErrorCode(code)) return MODEL_ERROR_MESSAGES.model_http_error
  if (code === 'model_http_error' && isHttpStatus(httpStatus)) {
    return `The provider returned an error (HTTP ${httpStatus}).`
  }
  return MODEL_ERROR_MESSAGES[code]
}

export class ModelError extends Error {
  readonly code: ModelErrorCode
  readonly httpStatus?: number

  constructor(code: ModelErrorCode, httpStatus?: number) {
    // message is the code itself so an accidental error.message echo leaks nothing.
    super(code)
    Object.setPrototypeOf(this, new.target.prototype)
    this.name = 'ModelError'
    this.code = code
    if (isHttpStatus(httpStatus)) this.httpStatus = httpStatus
  }
}

export function isModelError(e: unknown): e is ModelError {
  return e instanceof ModelError
}
