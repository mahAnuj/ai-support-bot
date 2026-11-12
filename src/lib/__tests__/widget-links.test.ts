import type { Widget } from '../../types/database'
import { widgetScript } from '../widget-script'

// The real widget script in jsdom: web addresses in an answer become links,
// safely. Found on anujmahajan.com: the model wrote
// "<https://anujmahajan.com/products/ai-support-bot>" and the widget showed
// the angle brackets as text, with no link.
describe('widget answer links', () => {
  const widget = {
    id: 'w', business_id: 'b', knowledge_base_id: 'k', widget_key: 'widget-abc', name: 'n',
    title: 'Ask', welcome_message: 'Hi', primary_color: '#14425C', position: 'bottom-right',
    size: 'medium', allowed_domains: [], is_active: true, created_at: new Date(), updated_at: new Date(),
  } as Widget

  afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

  async function answer(text: string): Promise<HTMLElement> {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).endsWith('/api/widget/status') ? { logging: false } : { message: text, sessionId: 's' }),
    }))
    delete (window as unknown as Record<string, unknown>).__aiSupportWidgetLoaded
    const tag = document.createElement('script')
    tag.setAttribute('src', 'https://bot.example/api/widget/script/widget-abc')
    tag.setAttribute('data-question-1', 'What is it?')
    document.head.appendChild(tag)
    new Function(widgetScript(widget, 'https://bot.example'))()
    document.querySelector<HTMLButtonElement>('#ai-widget-btn')!.click()
    await new Promise((r) => setTimeout(r, 0))
    document.querySelector<HTMLButtonElement>('.ai-widget-starter')!.click()
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0))
    const bots = document.querySelectorAll<HTMLElement>('.ai-widget-message.ai')
    return bots[bots.length - 1]
  }

  const links = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('a')).map((a) => ({ href: a.getAttribute('href'), text: a.textContent, target: a.target, rel: a.rel }))

  it('turns the answer from the real log into a link, without the brackets', async () => {
    const el = await answer(
      '- More details can be found at the product page: <https://anujmahajan.com/products/ai-support-bot>.',
    )
    expect(links(el)).toEqual([
      { href: 'https://anujmahajan.com/products/ai-support-bot', text: 'anujmahajan.com/products/ai-support-bot', target: '_blank', rel: 'noopener noreferrer nofollow' },
    ])
    expect(el.textContent).not.toContain('<')
    expect(el.textContent).toContain('product page: anujmahajan.com/products/ai-support-bot.')
  })

  it('handles Markdown links and bare addresses, leaving trailing punctuation outside', async () => {
    const el = await answer('See [the setup guide](https://example.com/docs#setup), or https://example.com/contact. **Thanks**')
    expect(links(el).map((l) => [l.href, l.text])).toEqual([
      ['https://example.com/docs#setup', 'the setup guide'],
      ['https://example.com/contact', 'example.com/contact'],
    ])
    expect(el.querySelector('strong')?.textContent).toBe('Thanks')
  })

  it('never links anything but http and https, and never renders HTML', async () => {
    const el = await answer('[click](javascript:alert(1)) <img src=x onerror=alert(1)> data:text/html,hi')
    expect(el.querySelectorAll('a')).toHaveLength(0)
    expect(el.querySelector('img')).toBeNull()
    expect(el.textContent).toContain('[click](javascript:alert(1))')
  })
})
