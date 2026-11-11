/** @jest-environment node */
import { validateConnectionString } from '../connection'
import { limitedConnectionString, limitedUserName } from '../secure-setup'

describe('one-click setup: the limited login', () => {
  it('keeps a pooler suffix on the user name, and adds none otherwise', () => {
    expect(limitedUserName('neondb_owner', 'support_bot_app')).toBe('support_bot_app')
    expect(limitedUserName('postgres', 'support_bot_app_a1b2c3')).toBe('support_bot_app_a1b2c3')
    expect(limitedUserName('postgres.abcdefghij', 'support_bot_app')).toBe('support_bot_app.abcdefghij')
    expect(limitedUserName('.odd', 'support_bot_app')).toBe('support_bot_app')
    expect(limitedUserName('odd.', 'support_bot_app')).toBe('support_bot_app')
  })

  it('changes only the user and password of the connection string', () => {
    const owner = validateConnectionString('postgresql://neondb_owner:s3cret@ep-x-pooler.aws.neon.tech/neondb?sslmode=require', { allowPrivate: false })
    if (!owner.ok) throw new Error('fixture')
    const out = validateConnectionString(limitedConnectionString(owner.connection, 'support_bot_app', 'ab'.repeat(24)), { allowPrivate: false })
    if (!out.ok) throw new Error('rebuilt string did not validate')
    expect(out.connection.user).toBe('support_bot_app')
    expect(out.connection.password).toBe('ab'.repeat(24))
    expect(out.connection.host).toBe(owner.connection.host)
    expect(out.connection.port).toBe(owner.connection.port)
    expect(out.connection.database).toBe('neondb')
    expect(out.connection.sslmode).toBe('require')
    expect(out.connection.normalized).not.toContain('s3cret')
  })
})
