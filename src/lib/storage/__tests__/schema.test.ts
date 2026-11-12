/** @jest-environment node */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMBEDDING_DIM, SCHEMA_NAME, SCHEMA_STATEMENTS, SCHEMA_VERSION } from '../schema'

const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim()

describe('support_bot schema', () => {
  const sqlFile = collapse(readFileSync(join(process.cwd(), 'scripts', 'support-bot-schema.sql'), 'utf8'))

  it('has statements', () => {
    expect(SCHEMA_STATEMENTS.length).toBeGreaterThan(0)
  })

  it.each(SCHEMA_STATEMENTS.map((sql) => [sql]))('appears in scripts/support-bot-schema.sql: %s', (sql) => {
    expect(sqlFile).toContain(`${collapse(sql)};`)
  })

  it('never creates extensions, drops or truncates', () => {
    for (const sql of SCHEMA_STATEMENTS) {
      expect(sql).not.toMatch(/CREATE\s+EXTENSION|DROP|TRUNCATE/i)
    }
  })

  it('only touches the support_bot schema', () => {
    for (const sql of SCHEMA_STATEMENTS) {
      expect(sql).toContain(SCHEMA_NAME)
    }
  })

  it('uses 384-dimension embeddings and schema version 1', () => {
    expect(EMBEDDING_DIM).toBe(384)
    expect(SCHEMA_VERSION).toBe('1')
    expect(SCHEMA_STATEMENTS.some((sql) => sql.includes(`vector(${EMBEDDING_DIM})`))).toBe(true)
  })
})

// scripts/support-bot-upgrade.sql brings an older database up to date, so every
// table added after v1 must be in it, or that database silently lacks a feature.
describe('upgrade script', () => {
  it('creates every optional table the app knows about', () => {
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const upgrade = fs.readFileSync(path.join(process.cwd(), 'scripts', 'support-bot-upgrade.sql'), 'utf8')
    const tables = SCHEMA_STATEMENTS.filter((sql) => /^CREATE TABLE IF NOT EXISTS support_bot\.(api_keys|key_events|widget_prefs|conversations|log_settings|daily_stats|projects|shared_model_usage) /.test(sql))
    expect(tables).toHaveLength(8)
    for (const sql of tables) {
      const name = sql.match(/support_bot\.(\w+)/)![1]
      expect(upgrade).toContain(`CREATE TABLE IF NOT EXISTS support_bot.${name} `)
    }
  })
})
