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
