// Server-only: retrieval and answering for a connected backend, shared by the preview and widget chat routes.
import { MIN_SIMILARITY, matchScore } from '../embeddings'
import { generateResponse } from '../llm'
import { demoProvider, ownerProvider } from '../model/provider'
import type { OwnerModelConfig } from '../model/shared'
import { requestAnswer, searchPassages } from './client'
import { CONNECTOR_LIMITS, type AnswerPath, type ConnectorConfig, type ConnectorPassage } from './shared'

const MAX_CONTEXT_CHARS = 2000

export interface ConnectorAnswerInput {
  connector: ConnectorConfig
  // The backend's answer capability, as sealed in the token.
  answer: boolean
  // Used only when answer === false; null means the demo model.
  model: OwnerModelConfig | null
  question: string
  systemPrompt?: string
  roleContext?: string
  // Used on this server's answer paths when systemPrompt is empty (the widget's default prompt).
  defaultSystemPrompt?: string
}

export interface ConnectorAnswerResult {
  message: string
  confidence: number
  sources: string[]
  isEnhanced: boolean
  path: AnswerPath
}

// The same 2,000-character assembly as the widget chat route.
function buildContext(passages: ConnectorPassage[]): { context: string; sources: string[] } {
  let context = ''
  const used = new Set<string>()
  for (const passage of passages) {
    const addition = `${passage.text}\n\n`
    if (context.length + addition.length > MAX_CONTEXT_CHARS) {
      const remaining = MAX_CONTEXT_CHARS - context.length
      if (remaining > 100) context += passage.text.substring(0, remaining - 10) + '...\n\n'
      break
    }
    context += addition
    used.add(passage.filename)
  }
  return { context: context.trim(), sources: Array.from(used) }
}

// One search with the question as typed, then one answer call (backend) or one model call (owner or demo).
// Errors propagate unchanged: ConnectorError, ModelError, or the demo provider's missing-key Error.
// Nothing here logs; the client writes its own fixed per-call line.
export async function answerWithConnector(input: ConnectorAnswerInput): Promise<ConnectorAnswerResult> {
  const { connector, answer, model, question, systemPrompt, roleContext, defaultSystemPrompt } = input

  const passages = await searchPassages(connector, question, CONNECTOR_LIMITS.searchTopK)
  const filtered = passages.filter((p) => p.score >= MIN_SIMILARITY)
  const confidence = filtered.length > 0 ? matchScore(filtered.map((p) => p.score)) : 0

  if (answer) {
    const reply = await requestAnswer(connector, { question, passages: filtered, systemPrompt: systemPrompt || null })
    const sent = new Set(filtered.map((p) => p.filename))
    const sources = Array.from(new Set(reply.sources.filter((s) => sent.has(s))))
    return { message: reply.message, confidence, sources, isEnhanced: filtered.length > 0, path: 'backend' }
  }

  const { context, sources } = buildContext(filtered)
  const isEnhanced = context.length > 0
  const provider = model ? ownerProvider(model) : demoProvider()
  const response = await generateResponse(
    {
      query: question,
      context: isEnhanced ? context : undefined,
      isEnhanced,
      systemPrompt: systemPrompt || defaultSystemPrompt,
      roleContext,
    },
    provider,
  )
  return {
    message: response.message,
    confidence,
    sources: isEnhanced ? sources : [],
    isEnhanced,
    path: model ? 'owner' : 'demo',
  }
}
