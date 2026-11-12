import type { Widget } from '../../types/database'
import { widgetScript } from '../widget-script'

// The real widget script in jsdom: what a visitor sees when the bot has used
// up today's questions on the shared model, versus the per-network rate limit.
describe('widget daily limit message', () => {
  const widget = {
    id: 'w', business_id: 'b', knowledge_base_id: 'k', widget_key: 'widget-abc', name: 'n',
    title: 'Ask', welcome_message: 'Hi', primary_color: '#14425C', position: 'bottom-right',
    size: 'medium', allowed_domains: [], is_active: true, created_at: new Date(), updated_at: new Date(),
  } as Widget

  afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

  async function askWith(chatBody: unknown) {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => String(url).endsWith('/api/widget/status')
      ? { ok: true, status: 200, json: async () => ({ logging: false }) }
      : { ok: false, status: 429, json: async () => chatBody })
    delete (window as unknown as Record<string, unknown>).__aiSupportWidgetLoaded
    const tag = document.createElement('script')
    tag.setAttribute('src', 'https://bot.example/api/widget/script/widget-abc')
    tag.setAttribute('data-question-1', 'What do you offer?')
    document.head.appendChild(tag)
    new Function(widgetScript(widget, 'https://bot.example'))()
    document.querySelector<HTMLButtonElement>('#ai-widget-btn')!.click()
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
    document.querySelector<HTMLButtonElement>('.ai-widget-starter')!.click()
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0))
    return document.getElementById('ai-widget-messages')?.textContent ?? document.body.textContent ?? ''
  }

  it("shows the server's daily-limit message", async () => {
    const text = await askWith({ code: 'daily_limit', message: 'This assistant has answered all the questions it can for today. Please try again tomorrow.' })
    expect(text).toContain('Please try again tomorrow.')
    expect(text).not.toContain('Too many messages from this network')
  })

  it('keeps the rate-limit message for a plain 429', async () => {
    expect(await askWith({ error: 'Too many requests' })).toContain('Too many messages from this network')
  })
})
