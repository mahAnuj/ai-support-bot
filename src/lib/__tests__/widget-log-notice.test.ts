import type { Widget } from '../../types/database'
import { widgetScript } from '../widget-script'

// The real widget script in jsdom: the visitor notice and the flag that the
// server requires before it logs anything.
describe('widget conversation-log notice', () => {
  const widget = {
    id: 'w', business_id: 'b', knowledge_base_id: 'k', widget_key: 'widget-abc', name: 'n',
    title: 'Ask', welcome_message: 'Hi', primary_color: '#14425C', position: 'bottom-right',
    size: 'medium', allowed_domains: [], is_active: true, created_at: new Date(), updated_at: new Date(),
  } as Widget

  afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

  async function run(logging: boolean) {
    const fetchMock = jest.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).endsWith('/api/widget/status') ? { logging } : { message: 'Answer', sessionId: 's' }),
    }))
    ;(global as unknown as { fetch: unknown }).fetch = fetchMock
    delete (window as unknown as Record<string, unknown>).__aiSupportWidgetLoaded
    const tag = document.createElement('script')
    tag.setAttribute('src', 'https://bot.example/api/widget/script/widget-abc')
    tag.setAttribute('data-question-1', 'What do you offer?')
    document.head.appendChild(tag)
    new Function(widgetScript(widget, 'https://bot.example'))()
    document.querySelector<HTMLButtonElement>('#ai-widget-btn')!.click()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    document.querySelector<HTMLButtonElement>('.ai-widget-starter')!.click()
    await new Promise((r) => setTimeout(r, 0))
    const chatCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/api/widget/chat'))!
    return { notice: document.getElementById('ai-widget-log-notice')!, body: JSON.parse((chatCall as unknown as [string, { body: string }])[1].body) }
  }

  it('shows the notice and flags questions when the owner keeps a log', async () => {
    const { notice, body } = await run(true)
    expect(notice.hidden).toBe(false)
    expect(notice.textContent).toBe('Questions and answers are saved to improve this assistant.')
    expect(body.logNotice).toBe(true)
  })

  it('shows nothing and flags nothing when the log is off', async () => {
    const { notice, body } = await run(false)
    expect(notice.hidden).toBe(true)
    expect(body.logNotice).toBe(false)
  })
})
