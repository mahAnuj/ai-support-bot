import type { Widget } from '../../types/database'
import { WAITING_MESSAGES, waitingMessage } from '../waiting-messages'
import { widgetScript } from '../widget-script'

describe('waitingMessage', () => {
  it('moves through the stages by seconds waited', () => {
    expect(waitingMessage(0)).toBe(WAITING_MESSAGES[0].text)
    expect(waitingMessage(2)).toBe(WAITING_MESSAGES[0].text)
    expect(waitingMessage(3)).toBe(WAITING_MESSAGES[1].text)
    expect(waitingMessage(9)).toBe(WAITING_MESSAGES[2].text)
    expect(waitingMessage(600)).toBe(WAITING_MESSAGES[WAITING_MESSAGES.length - 1].text)
  })

  it('stages are in order and start at zero', () => {
    expect(WAITING_MESSAGES[0].after).toBe(0)
    for (let i = 1; i < WAITING_MESSAGES.length; i++) expect(WAITING_MESSAGES[i].after).toBeGreaterThan(WAITING_MESSAGES[i - 1].after)
  })
})

// The real widget script, in jsdom, with a fake clock and a reply that never comes until released.
describe('widget waiting messages', () => {
  const widget = {
    id: 'w', business_id: 'b', knowledge_base_id: 'k', widget_key: 'widget-abc', name: 'n',
    title: 'Ask', welcome_message: 'Hi', primary_color: '#14425C', position: 'bottom-right',
    size: 'medium', allowed_domains: [], is_active: true, created_at: new Date(), updated_at: new Date(),
  } as Widget

  afterEach(() => { jest.useRealTimers(); document.head.innerHTML = ''; document.body.innerHTML = '' })

  it('changes the message as the wait grows, then clears it with the answer', async () => {
    jest.useFakeTimers()
    let release: (v: unknown) => void = () => {}
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(() => new Promise((resolve) => { release = resolve }))
    delete (window as unknown as Record<string, unknown>).__aiSupportWidgetLoaded
    const tag = document.createElement('script')
    tag.setAttribute('src', 'https://bot.example/api/widget/script/widget-abc')
    tag.setAttribute('data-question-1', 'What do you offer?')
    document.head.appendChild(tag)
    new Function(widgetScript(widget, 'https://bot.example'))()

    document.querySelector<HTMLButtonElement>('.ai-widget-starter')!.click()
    const label = () => document.querySelector('#typing-indicator [role="status"]')?.textContent
    expect(label()).toBe(WAITING_MESSAGES[0].text)
    jest.advanceTimersByTime(3000)
    expect(label()).toBe(WAITING_MESSAGES[1].text)
    jest.advanceTimersByTime(5000)
    expect(label()).toBe(WAITING_MESSAGES[2].text)
    jest.advanceTimersByTime(12000)
    expect(label()).toBe(WAITING_MESSAGES[3].text)

    release({ ok: true, status: 200, json: async () => ({ message: 'Answer', sessionId: 's' }) })
    await jest.runOnlyPendingTimersAsync()
    expect(document.getElementById('typing-indicator')).toBeNull()
    expect(document.body.textContent).toContain('Answer')
  })
})
