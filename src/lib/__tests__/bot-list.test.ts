import { MAX_BOTS, parseBotList, upsertBot, type SavedBot } from '../bot-list'

const bot = (key: string, name: string | null = null): SavedBot => ({ key, label: `${key} on host`, name, token: `sbb1_${key}` })

describe('bot list', () => {
  it('parses only well-formed entries and drops extra fields', () => {
    const raw = JSON.stringify([bot('a', 'one'), { key: 'b' }, 'x', { ...bot('c'), extra: 1 }])
    expect(parseBotList(raw)).toEqual([bot('a', 'one'), bot('c')])
  })

  it('treats missing or corrupt storage as an empty list', () => {
    expect(parseBotList(null)).toEqual([])
    expect(parseBotList('{not json')).toEqual([])
    expect(parseBotList('{"key":"a"}')).toEqual([])
  })

  it('caps the list', () => {
    const many = Array.from({ length: MAX_BOTS + 5 }, (_, i) => bot(`k${i}`))
    expect(parseBotList(JSON.stringify(many))).toHaveLength(MAX_BOTS)
  })

  it('adds a new database and updates an existing one in place', () => {
    const list = upsertBot([bot('a'), bot('b')], bot('c'))
    expect(list.map((b) => b.key)).toEqual(['a', 'b', 'c'])
    const renamed = upsertBot(list, { ...bot('a'), name: 'shubhagya.com', token: 'sbb1_new' })
    expect(renamed.map((b) => b.key)).toEqual(['a', 'b', 'c'])
    expect(renamed[0]).toMatchObject({ name: 'shubhagya.com', token: 'sbb1_new' })
  })
})
