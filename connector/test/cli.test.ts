import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { after, before, describe, test } from 'node:test'
import { KEY_ID, SECRET, nowSeconds, startServer, type TestServer } from './helpers/client.js'

const CLI = fileURLToPath(new URL('../src/cli/sign.js', import.meta.url))
const SEARCH_BODY = '{"query":"What file types can I upload?","topK":5}'

interface Run {
  code: number
  stdout: string
  stderr: string
}

// Async on purpose: the server under test runs in this process.
function runCli(args: string[], env: Record<string, string | undefined> = { CONNECTOR_SECRET: SECRET }): Promise<Run> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { env: { PATH: process.env.PATH, ...env }, timeout: 20_000 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, stdout: String(stdout), stderr: String(stderr) })
      },
    )
  })
}

function status(run: Run): number {
  const match = /^status=(\d+)$/m.exec(run.stdout)
  return match ? Number(match[1]) : -1
}

function assertNoSecret(run: Run): void {
  assert.ok(!run.stdout.includes(SECRET), 'secret on stdout')
  assert.ok(!run.stderr.includes(SECRET), 'secret on stderr')
  assert.ok(!/x-connector-signature|v1=[0-9a-f]{64}/i.test(run.stdout + run.stderr), 'signature or header printed')
}

describe('sign CLI', () => {
  let s: TestServer
  let base: string

  before(async () => {
    s = await startServer()
    base = `http://127.0.0.1:${s.port}`
  })
  after(async () => {
    await s.close()
  })

  const common = () => ['--base', base, '--key-id', KEY_ID]

  test('a signed request is accepted and prints status and body only', async () => {
    const run = await runCli([...common(), '--method', 'GET', '--path', '/v1/documents'])
    assert.equal(run.code, 0, run.stderr)
    assert.equal(status(run), 200)
    assert.match(run.stdout, /"documents":\[\]/)
    assertNoSecret(run)
  })

  test('a signed POST with --body is accepted', async () => {
    const run = await runCli([...common(), '--method', 'POST', '--path', '/v1/search', '--body', SEARCH_BODY])
    assert.equal(status(run), 200)
    assert.match(run.stdout, /"passages":/)
    assertNoSecret(run)
  })

  for (const mode of ['signature', 'body', 'path'] as const) {
    test(`--tamper ${mode} gets 401`, async () => {
      const run = await runCli([...common(), '--method', 'POST', '--path', '/v1/search', '--body', SEARCH_BODY, '--tamper', mode])
      assert.equal(run.code, 0, run.stderr)
      assert.equal(status(run), 401)
      assert.match(run.stdout, /"code":"unauthorized"/)
      assertNoSecret(run)
    })
  }

  test('a replayed --nonce gets 401 the second time', async () => {
    const nonce = randomBytes(16).toString('base64url')
    const args = [...common(), '--method', 'GET', '--path', '/v1/health', '--nonce', nonce]
    const first = await runCli(args)
    const second = await runCli(args)
    assert.equal(status(first), 200)
    assert.equal(status(second), 401)
    assertNoSecret(first)
    assertNoSecret(second)
  })

  test('a timestamp outside the 300 s window gets 401', async () => {
    const run = await runCli([...common(), '--method', 'GET', '--path', '/v1/health', '--timestamp', String(nowSeconds() - 400)])
    assert.equal(status(run), 401)
    assertNoSecret(run)
  })

  test('a wrong secret gets 401', async () => {
    const run = await runCli([...common(), '--method', 'GET', '--path', '/v1/health'], {
      CONNECTOR_SECRET: 'W'.repeat(43),
    })
    assert.equal(status(run), 401)
  })

  test('without CONNECTOR_SECRET it refuses with a usage error and sends nothing', async () => {
    const run = await runCli([...common(), '--method', 'GET', '--path', '/v1/health'], {})
    assert.equal(run.code, 2)
    assert.equal(status(run), -1)
    assert.match(run.stderr, /CONNECTOR_SECRET/)
  })

  test('rejects --tamper body without a body, and an unknown flag', async () => {
    const noBody = await runCli([...common(), '--method', 'GET', '--path', '/v1/health', '--tamper', 'body'])
    assert.equal(noBody.code, 2)
    const unknown = await runCli([...common(), '--method', 'GET', '--path', '/v1/health', '--secret', SECRET])
    assert.equal(unknown.code, 2)
    assertNoSecret(unknown)
  })
})

describe('sign CLI with a mount prefix', () => {
  test('the prefix in --base is sent but only the /v1/ path is signed', async () => {
    const s = await startServer({ env: { CONNECTOR_BASE_PATH: '/kb' } })
    try {
      const run = await runCli(['--base', `http://127.0.0.1:${s.port}/kb/`, '--key-id', KEY_ID, '--method', 'GET', '--path', '/v1/documents'])
      assert.equal(status(run), 200)
    } finally {
      await s.close()
    }
  })
})
