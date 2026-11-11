/** @jest-environment node */
import { generateResponse, GROUNDING_RULE } from '../llm'
import type { ChatCompletionRequest, ChatProvider } from '../model/provider'

// A provider that records the prompt instead of calling a model.
function recordingProvider() {
  const calls: ChatCompletionRequest[] = []
  const provider: ChatProvider = {
    kind: 'demo',
    model: 'test-model',
    cacheKey: 'test',
    async complete(req) {
      calls.push(req)
      return 'ok'
    },
  }
  return { provider, calls }
}

function systemPromptOf(calls: ChatCompletionRequest[]): string {
  const msg = calls[0].messages.find(m => m.role === 'system')
  if (!msg) throw new Error('no system message')
  return msg.content
}

const CONTEXT = 'Returns are accepted within 30 days.'

describe('grounding rule', () => {
  it('is appended to the default prompt when documents are retrieved', async () => {
    const { provider, calls } = recordingProvider()
    await generateResponse({ query: 'Do you sell scooters?', context: CONTEXT, isEnhanced: true }, provider)
    expect(systemPromptOf(calls).endsWith(GROUNDING_RULE)).toBe(true)
  })

  it('is appended to the default prompt when no documents are retrieved', async () => {
    const { provider, calls } = recordingProvider()
    await generateResponse({ query: 'Do you sell scooters?' }, provider)
    expect(systemPromptOf(calls).endsWith(GROUNDING_RULE)).toBe(true)
  })

  it('comes last after a custom prompt that asks for general guidance', async () => {
    // The builder's old prompt invited exactly this; an owner can still write it.
    const custom = "If you don't have specific information, provide general business guidance."
    const { provider, calls } = recordingProvider()
    await generateResponse(
      { query: 'Do you sell scooters?', context: CONTEXT, isEnhanced: true, systemPrompt: custom },
      provider
    )
    const prompt = systemPromptOf(calls)
    expect(prompt.startsWith(custom)).toBe(true)
    expect(prompt.endsWith(GROUNDING_RULE)).toBe(true)
  })

  it('applies to a custom prompt with no retrieved documents', async () => {
    const { provider, calls } = recordingProvider()
    await generateResponse({ query: 'Where is your store?', systemPrompt: 'You are a shop assistant.' }, provider)
    expect(systemPromptOf(calls).endsWith(GROUNDING_RULE)).toBe(true)
  })

  it('tells the model not to treat silence in the documents as a no', () => {
    expect(GROUNDING_RULE).toMatch(/must come only from the documents/)
    expect(GROUNDING_RULE).toMatch(/do not answer "no" to a question the documents are silent on/)
  })
})
