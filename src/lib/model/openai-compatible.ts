import * as http from 'node:http'
import * as https from 'node:https'
import { fingerprint } from '../storage/log'
import { isGptOssModel, isModelError, ModelError, type ModelErrorCode, type OwnerModelConfig } from './shared'
import { checkModelBaseUrl, guardedLookup, isPrivateModelHostAllowed } from './url-guard'
import type { ChatCompletionRequest, ChatProvider, ChatProviderKind } from './provider'

// Defined here and re-exported by provider.ts so the provider -> adapter import stays one-way.
export const MAX_OUTPUT_TOKENS = 1024
export const CHAT_TIMEOUT_MS = 30_000
export const VALIDATE_TIMEOUT_MS = 10_000
export const MAX_RESPONSE_BYTES = 1_048_576

export interface OpenAICompatibleOptions {
  kind: ChatProviderKind
}

// Key order matches what the OpenAI SDK sent for Groq before, so the demo body is unchanged.
export function buildRequestBody(model: string, req: ChatCompletionRequest): Record<string, unknown> {
  const maxTokens = Math.max(1, Math.min(Math.floor(req.maxTokens), MAX_OUTPUT_TOKENS))
  if (isGptOssModel(model)) {
    return {
      model,
      messages: req.messages,
      ...(req.jsonObject ? { response_format: { type: 'json_object' } } : {}),
      max_completion_tokens: maxTokens,
      temperature: req.temperature,
      reasoning_effort: 'low',
    }
  }
  return { model, messages: req.messages, max_tokens: maxTokens, temperature: req.temperature }
}

const MODEL_NOT_FOUND_TEXT = /does ?n[o']t exist|not found|no such model|unknown model|invalid model|decommissioned/i

// Inspected in memory only; nothing from the body is kept, logged or returned.
function looksLikeModelNotFound(body: Buffer | null): boolean {
  if (!body) return false
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    const error = (parsed as { error?: unknown } | null)?.error
    if (typeof error !== 'object' || error === null) return false
    const { code, type, message } = error as Record<string, unknown>
    if (code === 'model_not_found' || type === 'model_not_found') return true
    return typeof message === 'string' && /\bmodel\b/i.test(message) && MODEL_NOT_FOUND_TEXT.test(message)
  } catch {
    return false
  }
}

function errorForStatus(status: number, body: Buffer | null): ModelError {
  if (status >= 300 && status < 400) return new ModelError('model_http_error', status)
  if (status === 401 || status === 403) return new ModelError('model_auth_rejected')
  if (status === 404) return new ModelError('model_not_found')
  if ((status === 400 || status === 422) && looksLikeModelNotFound(body)) return new ModelError('model_not_found')
  if (status === 429) return new ModelError('model_rate_limited')
  if (status >= 400 && status < 500) return new ModelError('model_bad_params')
  return new ModelError('model_http_error', status)
}

function parseCompletion(body: Buffer): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body.toString('utf8'))
  } catch {
    throw new ModelError('model_bad_response')
  }
  const choices = (parsed as { choices?: unknown } | null)?.choices
  const message = Array.isArray(choices) ? (choices[0] as { message?: unknown } | undefined)?.message : undefined
  if (typeof message !== 'object' || message === null) throw new ModelError('model_bad_response')
  const content = (message as { content?: unknown }).content
  // gpt-oss can spend a small budget on reasoning and return no content at all.
  if (content === null) return ''
  if (typeof content !== 'string') throw new ModelError('model_bad_response')
  return content
}

function postCompletion(config: OwnerModelConfig, req: ChatCompletionRequest): Promise<string> {
  const allowPrivate = isPrivateModelHostAllowed()
  // Literal-IP hosts never reach guardedLookup, so the static check runs on every call.
  const checked = checkModelBaseUrl(config.baseUrl, { allowPrivate })
  if (!checked.ok) return Promise.reject(new ModelError(checked.code))

  const url = new URL(checked.baseUrl)
  const payload = Buffer.from(JSON.stringify(buildRequestBody(config.model, req)), 'utf8')
  const timeoutMs = Math.min(Math.max(1, req.timeoutMs ?? CHAT_TIMEOUT_MS), CHAT_TIMEOUT_MS)
  const transport = checked.protocol === 'https:' ? https : http

  return new Promise<string>((resolve, reject) => {
    let settled = false
    let request: http.ClientRequest | null = null

    const finish = (error: ModelError | null, content?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        request?.destroy()
        reject(error)
      } else {
        resolve(content ?? '')
      }
    }
    // Raw socket, TLS and DNS errors carry hostnames and provider text: replace them with a code.
    const fromRaw = (e: unknown) => finish(isModelError(e) ? e : new ModelError('model_unreachable'))

    const timer = setTimeout(() => finish(new ModelError('model_unreachable')), timeoutMs)

    try {
      request = transport.request({
        protocol: checked.protocol,
        hostname: checked.host,
        port: url.port || undefined,
        path: `${url.pathname.replace(/\/+$/, '')}/chat/completions`,
        method: 'POST',
        agent: false,
        lookup: guardedLookup({ allowPrivate, protocol: checked.protocol }),
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'accept-encoding': 'identity',
          'content-length': String(payload.length),
        },
      })
    } catch {
      finish(new ModelError('model_unreachable'))
      return
    }

    request.on('error', fromRaw)
    request.on('response', (res) => {
      res.on('error', fromRaw)
      const status = res.statusCode ?? 0
      // Redirects are never followed.
      if (status >= 300 && status < 400) {
        finish(errorForStatus(status, null))
        return
      }

      const chunks: Buffer[] = []
      let size = 0
      let oversized = false
      res.on('data', (chunk: Buffer) => {
        if (settled || oversized) return
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          oversized = true
          chunks.length = 0
          finish(status >= 200 && status < 300 ? new ModelError('model_bad_response') : errorForStatus(status, null))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        if (settled) return
        const body = Buffer.concat(chunks)
        if (status >= 200 && status < 300) {
          try {
            finish(null, parseCompletion(body))
          } catch (e) {
            fromRaw(e)
          }
          return
        }
        finish(errorForStatus(status, body))
      })
    })
    request.end(payload)
  })
}

export function createOpenAICompatibleProvider(config: OwnerModelConfig, opts: OpenAICompatibleOptions): ChatProvider {
  const fp = fingerprint(`${config.baseUrl}\n${config.model}`)
  return {
    kind: opts.kind,
    model: config.model,
    cacheKey: fp,
    async complete(req) {
      const started = Date.now()
      let outcome: 'ok' | ModelErrorCode = 'ok'
      try {
        return await postCompletion(config, req)
      } catch (e) {
        const error = isModelError(e) ? e : new ModelError('model_unreachable')
        outcome = error.code
        throw error
      } finally {
        console.log(`model call provider=${opts.kind} model=#${fp} outcome=${outcome} ms=${Date.now() - started}`)
      }
    },
  }
}
