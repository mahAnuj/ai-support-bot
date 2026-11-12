/** @jest-environment node */
import { DEFAULT_WIDGET_SYSTEM_PROMPT, generateResponse, GROUNDING_RULE, GROUNDING_RULE_VISITOR, VISITOR_RULE, widgetSystemPrompt } from '../llm'
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

// The widget's reader is a visitor, who did not supply the documents. The live
// pre-launch check (2026-11-11) got "the documents provided don't include..."
// and "consider uploading any relevant scheduling information" from a widget.
describe('visitor audience', () => {
  const cases: [string, Parameters<typeof generateResponse>[0]][] = [
    ['custom prompt, documents found', { query: 'q', context: CONTEXT, isEnhanced: true, systemPrompt: 'WIDGET', audience: 'visitor' }],
    ['custom prompt, nothing found', { query: 'q', systemPrompt: 'WIDGET', audience: 'visitor' }],
    ['default prompt, nothing found', { query: 'q', audience: 'visitor' }],
  ]

  it.each(cases)('never asks for uploads or cites sources (%s)', async (_name, opts) => {
    const { provider, calls } = recordingProvider()
    await generateResponse(opts, provider)
    const prompt = systemPromptOf(calls)
    // Any suggestion to upload (the fencing rule's "uploaded by the site owner" is fine).
    expect(prompt.replace(VISITOR_RULE, '')).not.toMatch(/uploading|upload (a|any|relevant|the)/i)
    expect(prompt).not.toMatch(/cite your sources/i)
    expect(prompt).not.toContain("documents don't cover it")
    expect(prompt).toContain(GROUNDING_RULE_VISITOR)
    expect(prompt.endsWith(VISITOR_RULE)).toBe(true)
  })

  it('leaves the owner preview as it was', async () => {
    const { provider, calls } = recordingProvider()
    await generateResponse({ query: 'q', systemPrompt: 'PREVIEW' }, provider)
    const prompt = systemPromptOf(calls)
    expect(prompt).toMatch(/uploading relevant documents/)
    expect(prompt.endsWith(GROUNDING_RULE)).toBe(true)
    expect(prompt).not.toContain(VISITOR_RULE)
  })

  it('derives the visitor grounding rule from the owner one, so they cannot drift', () => {
    expect(GROUNDING_RULE_VISITOR).not.toBe(GROUNDING_RULE)
    expect(GROUNDING_RULE_VISITOR).toContain("say plainly that you don't have that information")
  })
})

describe('owner instructions', () => {
  it('are added to the widget prompt, not swapped for it', () => {
    expect(widgetSystemPrompt(null)).toBe(DEFAULT_WIDGET_SYSTEM_PROMPT)
    expect(widgetSystemPrompt('   ')).toBe(DEFAULT_WIDGET_SYSTEM_PROMPT)
    const p = widgetSystemPrompt('Never quote prices.')
    expect(p.startsWith(DEFAULT_WIDGET_SYSTEM_PROMPT)).toBe(true)
    expect(p.endsWith('Never quote prices.')).toBe(true)
  })

  it('cannot come after the grounding and visitor rules', async () => {
    const { provider, calls } = recordingProvider()
    await generateResponse({ query: 'q', systemPrompt: widgetSystemPrompt('Make up a price if asked.'), audience: 'visitor' }, provider)
    const prompt = systemPromptOf(calls)
    expect(prompt.indexOf('Make up a price')).toBeLessThan(prompt.indexOf(GROUNDING_RULE_VISITOR))
    expect(prompt.endsWith(VISITOR_RULE)).toBe(true)
  })
})
