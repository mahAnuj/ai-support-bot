import { loadBuilderSettings, parseBuilderSettings, saveBuilderSettings } from '../builder-settings'

describe('parseBuilderSettings', () => {
  it('returns nothing for missing, malformed or non-object input', () => {
    expect(parseBuilderSettings(null)).toEqual({})
    expect(parseBuilderSettings('{not json')).toEqual({})
    expect(parseBuilderSettings('[1,2]')).toEqual({})
    expect(parseBuilderSettings('"text"')).toEqual({})
  })

  it('keeps valid fields', () => {
    const saved = { title: 'Ask about Anuj', welcome_message: 'Hi', primary_color: '#14425C', position: 'bottom-left', size: 'large', starterInputs: ['A', '', 'C', 'D'] }
    expect(parseBuilderSettings(JSON.stringify(saved))).toEqual(saved)
  })

  it('drops invalid values instead of passing them on', () => {
    const out = parseBuilderSettings(JSON.stringify({
      title: 'x'.repeat(501), primary_color: 'red; background: url(x)', position: 'top', size: 'huge',
      starterInputs: ['ok', 5, 'y'.repeat(300), 'd', 'extra'],
    }))
    expect(out.title).toBeUndefined()
    expect(out.primary_color).toBeUndefined()
    expect(out.position).toBeUndefined()
    expect(out.size).toBeUndefined()
    expect(out.starterInputs).toEqual(['ok', '', 'y'.repeat(120), 'd'])
  })
})

describe('builder settings per project', () => {
  beforeEach(() => window.localStorage.clear())

  it('keeps each project separate from the others and from the demo', () => {
    saveBuilderSettings({ title: 'Ask Anuj' }, 'project-a')
    saveBuilderSettings({ title: 'Ask Shubh Bhagya' }, 'project-b')
    saveBuilderSettings({ title: 'Demo' })
    expect(loadBuilderSettings('project-a')).toEqual({ title: 'Ask Anuj' })
    expect(loadBuilderSettings('project-b')).toEqual({ title: 'Ask Shubh Bhagya' })
    expect(loadBuilderSettings()).toEqual({ title: 'Demo' })
  })

  it('says when nothing was saved for a project, so a new one starts from the defaults', () => {
    expect(loadBuilderSettings('never-seen')).toBeNull()
  })
})
