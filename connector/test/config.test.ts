import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConfigError, parseConfig } from '../src/config.js'

const DB = 'postgres://u:supersecretpw@db.example.com/x'
const K1 = 'ck_0123456789abcdef'
const S1 = 'a'.repeat(43)
const K2 = 'ck_fedcba9876543210'
const S2 = 'SeCrEtVaLuE_-0123456789abcdefghijklmnopqrs'.padEnd(43, 'z')

function throwsConfig(fn: () => unknown, variable: string, forbidden: string[] = []) {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof ConfigError)
    assert.equal(error.variable, variable)
    assert.ok(error.message.startsWith(variable))
    for (const f of forbidden) assert.ok(!error.message.includes(f), 'the message must not hold the value')
    return true
  })
}

test('defaults with only DATABASE_URL: zero keys, port 8080, host 0.0.0.0, no answer', () => {
  const c = parseConfig({ DATABASE_URL: DB })
  assert.equal(c.databaseUrl, DB)
  assert.equal(c.keys.size, 0)
  assert.equal(c.port, 8080)
  assert.equal(c.host, '0.0.0.0')
  assert.equal(c.basePath, null)
  assert.equal(c.model, null)
  assert.equal(c.transformersCacheDir, null)
})

test('DATABASE_URL is required', () => {
  throwsConfig(() => parseConfig({}), 'DATABASE_URL')
  throwsConfig(() => parseConfig({ DATABASE_URL: '  ' }), 'DATABASE_URL')
})

test('CONNECTOR_KEYS: one or several pairs, empty allowed', () => {
  assert.equal(parseConfig({ DATABASE_URL: DB, CONNECTOR_KEYS: '' }).keys.size, 0)
  const one = parseConfig({ DATABASE_URL: DB, CONNECTOR_KEYS: `${K1}:${S1}` })
  assert.equal(one.keys.get(K1), S1)
  const two = parseConfig({ DATABASE_URL: DB, CONNECTOR_KEYS: ` ${K1}:${S1} , ${K2}:${S2},` })
  assert.equal(two.keys.size, 2)
  assert.equal(two.keys.get(K2), S2)
})

test('CONNECTOR_KEYS: bad entries and duplicate ids are errors that never echo the secret', () => {
  throwsConfig(() => parseConfig({ DATABASE_URL: DB, CONNECTOR_KEYS: `${K1}:${S2}x` }), 'CONNECTOR_KEYS', [S2])
  throwsConfig(() => parseConfig({ DATABASE_URL: DB, CONNECTOR_KEYS: `ck_123:${S2}` }), 'CONNECTOR_KEYS', [S2])
  throwsConfig(() => parseConfig({ DATABASE_URL: DB, CONNECTOR_KEYS: S2 }), 'CONNECTOR_KEYS', [S2])
  throwsConfig(() => parseConfig({ DATABASE_URL: DB, CONNECTOR_KEYS: `${K1}:${S1},${K1}:${S2}` }), 'CONNECTOR_KEYS', [S1, S2])
})

test('PORT, HOST and CONNECTOR_BASE_PATH', () => {
  assert.equal(parseConfig({ DATABASE_URL: DB, PORT: '9000' }).port, 9000)
  throwsConfig(() => parseConfig({ DATABASE_URL: DB, PORT: '0' }), 'PORT')
  throwsConfig(() => parseConfig({ DATABASE_URL: DB, PORT: '70000' }), 'PORT')
  throwsConfig(() => parseConfig({ DATABASE_URL: DB, PORT: '80a' }), 'PORT')
  assert.equal(parseConfig({ DATABASE_URL: DB, HOST: '127.0.0.1' }).host, '127.0.0.1')
  assert.equal(parseConfig({ DATABASE_URL: DB, CONNECTOR_BASE_PATH: '/kb' }).basePath, '/kb')
  assert.equal(parseConfig({ DATABASE_URL: DB, CONNECTOR_BASE_PATH: '/a/b-c.d' }).basePath, '/a/b-c.d')
  for (const bad of ['kb', '/kb/', '/', '/k b', '/kb?x', '//kb']) {
    throwsConfig(() => parseConfig({ DATABASE_URL: DB, CONNECTOR_BASE_PATH: bad }), 'CONNECTOR_BASE_PATH')
  }
})

test('the answer model is on only when all three model variables are set', () => {
  const all = {
    DATABASE_URL: DB,
    CONNECTOR_MODEL_BASE_URL: 'https://api.example.com/v1/',
    CONNECTOR_MODEL: 'some-model',
    CONNECTOR_MODEL_API_KEY: 'sk-test-model-key',
  }
  assert.deepEqual(parseConfig(all).model, { baseUrl: 'https://api.example.com/v1', model: 'some-model', apiKey: 'sk-test-model-key' })
  for (const missing of ['CONNECTOR_MODEL_BASE_URL', 'CONNECTOR_MODEL', 'CONNECTOR_MODEL_API_KEY']) {
    assert.equal(parseConfig({ ...all, [missing]: undefined }).model, null, missing)
    assert.equal(parseConfig({ ...all, [missing]: '' }).model, null, missing)
  }
})

test('an invalid model address is named without its value', () => {
  const base = { DATABASE_URL: DB, CONNECTOR_MODEL: 'm', CONNECTOR_MODEL_API_KEY: 'sk-test-key' }
  for (const url of ['not a url', 'ftp://x.example.com', 'https://user:pw@x.example.com/v1', 'https://x.example.com/v1?a=1']) {
    throwsConfig(() => parseConfig({ ...base, CONNECTOR_MODEL_BASE_URL: url }), 'CONNECTOR_MODEL_BASE_URL', ['pw@'])
  }
})

test('TRANSFORMERS_CACHE_DIR is passed through', () => {
  assert.equal(parseConfig({ DATABASE_URL: DB, TRANSFORMERS_CACHE_DIR: '/app/.cache' }).transformersCacheDir, '/app/.cache')
})
