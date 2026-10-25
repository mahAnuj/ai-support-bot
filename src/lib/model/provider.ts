import type { OwnerModelConfig } from './shared'
import { createOpenAICompatibleProvider } from './openai-compatible'

export {
  MAX_OUTPUT_TOKENS,
  CHAT_TIMEOUT_MS,
  VALIDATE_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  buildRequestBody,
} from './openai-compatible'

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionRequest {
  messages: ChatMessage[]
  maxTokens: number
  temperature: number
  jsonObject?: boolean
  timeoutMs?: number
}

export type ChatProviderKind = 'demo' | 'owner'

export interface ChatProvider {
  readonly kind: ChatProviderKind
  readonly model: string
  // Resolves to the message content ('' when the model returned none). Rejects only with ModelError,
  // except the demo provider's missing-key Error.
  complete(req: ChatCompletionRequest): Promise<string>
}

const ADAPTERS = {
  'openai-compatible': createOpenAICompatibleProvider,
} as const

export function ownerProvider(config: OwnerModelConfig): ChatProvider {
  return ADAPTERS['openai-compatible'](config, { kind: 'owner' })
}

function demoModel(): string {
  return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
}

// Env is read when used, never at construction or import, so the build needs no secrets.
export function demoProvider(): ChatProvider {
  return {
    kind: 'demo',
    get model() {
      return demoModel()
    },
    complete(req) {
      const apiKey = process.env.GROQ_API_KEY
      if (!apiKey) return Promise.reject(new Error('GROQ_API_KEY is not set'))
      const config = { baseUrl: GROQ_BASE_URL, model: demoModel(), apiKey }
      return ADAPTERS['openai-compatible'](config, { kind: 'demo' }).complete(req)
    },
  }
}
