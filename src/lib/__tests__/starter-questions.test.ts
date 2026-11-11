import { MAX_STARTER_LENGTH, normalizeStarterQuestions, withStarterQuestions } from '../starter-questions'
import { widgetScript } from '../widget-script'
import type { Widget } from '../../types/database'

const EMBED = '<script src="https://bot.example/api/widget/script/widget-abc" async></script>'

describe('normalizeStarterQuestions', () => {
  it('trims, collapses whitespace, drops empties and duplicates, keeps four', () => {
    expect(normalizeStarterQuestions(['  What   do you offer? ', '', 'What do you offer?', 'B', 'C', 'D', 'E', 7]))
      .toEqual(['What do you offer?', 'B', 'C', 'D'])
  })
  it('caps each question', () => {
    expect(normalizeStarterQuestions(['x'.repeat(500)])[0]).toHaveLength(MAX_STARTER_LENGTH)
  })
})

describe('withStarterQuestions', () => {
  it('leaves the embed code unchanged without questions', () => {
    expect(withStarterQuestions(EMBED, ['', '  '])).toBe(EMBED)
  })
  it('adds numbered data attributes and keeps the rest of the tag', () => {
    const code = withStarterQuestions(EMBED, ['What do you offer?', 'Pricing?'])
    expect(code).toBe('<script data-question-1="What do you offer?" data-question-2="Pricing?" src="https://bot.example/api/widget/script/widget-abc" async></script>')
  })
  it('escapes attribute-breaking characters', () => {
    const code = withStarterQuestions(EMBED, ['"><img src=x onerror=alert(1)> & co'])
    expect(code).toContain('data-question-1="&quot;&gt;&lt;img src=x onerror=alert(1)&gt; &amp; co"')
    expect(code).not.toContain('"><img')
  })
})

// The real widget script, run in jsdom against a script tag carrying the attributes.
describe('widget starter questions', () => {
  const widget = {
    id: 'w', business_id: 'b', knowledge_base_id: 'k', widget_key: 'widget-abc', name: 'n',
    title: 'Ask', welcome_message: 'Hi', primary_color: '#14425C', position: 'bottom-right',
    size: 'medium', allowed_domains: [], is_active: true, created_at: new Date(), updated_at: new Date(),
  } as Widget

  function run(attrs: Record<string, string>) {
    document.body.innerHTML = ''
    delete (window as unknown as Record<string, unknown>).__aiSupportWidgetLoaded
    const tag = document.createElement('script')
    tag.setAttribute('src', 'https://bot.example/api/widget/script/widget-abc')
    for (const [k, v] of Object.entries(attrs)) tag.setAttribute(k, v)
    document.head.appendChild(tag) // found through the src fallback; jsdom sets no currentScript here
    new Function(widgetScript(widget, 'https://bot.example'))()
    return document.querySelectorAll<HTMLButtonElement>('.ai-widget-starter')
  }

  afterEach(() => { document.head.innerHTML = ''; jest.restoreAllMocks() })

  it('shows no starters when the tag has none', () => {
    expect(run({})).toHaveLength(0)
  })

  it('renders the questions as plain text buttons, at most four', () => {
    const buttons = run({
      'data-question-1': 'What do you offer?',
      'data-question-2': '<img src=x onerror=alert(1)>',
      'data-question-3': 'C', 'data-question-4': 'D', 'data-question-5': 'E',
    })
    expect(Array.from(buttons).map(b => b.textContent)).toEqual(['What do you offer?', '<img src=x onerror=alert(1)>', 'C', 'D'])
    expect(document.querySelector('.ai-widget-starters img')).toBeNull()
  })

  it('collapses whitespace without touching letters (regression: the pattern once lost its backslash)', () => {
    const buttons = run({ 'data-question-1': '  What   services\tsuit startups?  ' })
    expect(buttons[0].textContent).toBe('What services suit startups?')
  })

  it('sends the clicked question and removes the starters', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ message: 'Answer', sessionId: 's' }) })
    ;(global as unknown as { fetch: unknown }).fetch = fetchMock
    const buttons = run({ 'data-question-1': 'What do you offer?' })
    buttons[0].click()
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message).toBe('What do you offer?')
    expect(document.querySelector('.ai-widget-starters')).toBeNull()
  })
})
