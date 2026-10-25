/** @jest-environment node */
import * as http from 'node:http'
import type { AddressInfo, LookupFunction } from 'node:net'
import * as dns from 'node:dns'
import { MODEL_ERROR_STATUS, ModelError, modelErrorMessage, isGptOssModel } from '../shared'
import { checkModelBaseUrl, guardedLookup, isPrivateModelHostAllowed, validateModelInput } from '../url-guard'

jest.mock('node:dns', () => {
  const actual = jest.requireActual<typeof import('node:dns')>('node:dns')
  return { ...actual, lookup: jest.fn() }
})

type Answer = { address: string; family: number }
const ANSWERS: Record<string, Answer[]> = {
  'private.example': [{ address: '10.0.0.5', family: 4 }],
  'public.example': [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }],
  'mixed.example': [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }],
  'mapped.example': [{ address: '::ffff:169.254.169.254', family: 6 }],
  'loop.example': [{ address: '127.0.0.1', family: 4 }],
  'empty.example': [],
}

const lookupMock = dns.lookup as unknown as jest.Mock

beforeEach(() => {
  lookupMock.mockReset()
  lookupMock.mockImplementation((host: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
    const answer = ANSWERS[host]
    if (!answer) {
      const err = Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: 'ENOTFOUND' })
      process.nextTick(() => cb(err))
      return
    }
    process.nextTick(() => cb(null, answer))
  })
})

const strict = { allowPrivate: false }
const permissive = { allowPrivate: true }

function runLookup(
  fn: LookupFunction,
  host: string,
  options: Parameters<LookupFunction>[1],
): Promise<{ err: unknown; address: unknown; family: unknown }> {
  return new Promise((resolve) => {
    fn(host, options, (err, address, family) => resolve({ err, address, family }))
  })
}

describe('shared', () => {
  it('builds the HTTP status message from an integer status only', () => {
    expect(modelErrorMessage('model_http_error', 500)).toBe('The provider returned an error (HTTP 500).')
    expect(modelErrorMessage('model_http_error', '500<script>')).toBe('The provider returned an error.')
    expect(modelErrorMessage('model_http_error', 500.5)).toBe('The provider returned an error.')
    expect(modelErrorMessage('model_auth_rejected')).toBe('The provider rejected this API key.')
    expect(modelErrorMessage('model_address_blocked')).toBe("This address isn't allowed.")
    expect(modelErrorMessage('not_a_code')).toBe('The provider returned an error.')
  })

  it('ModelError message is the code only', () => {
    const err = new ModelError('model_http_error', 503)
    expect(err.message).toBe('model_http_error')
    expect(err.httpStatus).toBe(503)
    expect(err).toBeInstanceOf(ModelError)
    expect(MODEL_ERROR_STATUS[err.code]).toBe(502)
  })

  it('detects gpt-oss models', () => {
    expect(isGptOssModel('openai/gpt-oss-20b')).toBe(true)
    expect(isGptOssModel('llama-3.1-8b-instant')).toBe(false)
  })
})

describe('isPrivateModelHostAllowed', () => {
  it('reads the flag from the env passed in', () => {
    expect(isPrivateModelHostAllowed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false)
    expect(isPrivateModelHostAllowed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isPrivateModelHostAllowed({ NODE_ENV: 'production', ALLOW_PRIVATE_MODEL_HOSTS: '1' } as NodeJS.ProcessEnv)).toBe(true)
    expect(isPrivateModelHostAllowed({ NODE_ENV: 'test', ALLOW_PRIVATE_MODEL_HOSTS: 'true' } as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe('checkModelBaseUrl with the flag off', () => {
  it.each([
    ['http://api.example.com/v1', 'model_https_required'],
    ['https://127.0.0.1', 'model_address_blocked'],
    ['https://[::1]', 'model_address_blocked'],
    ['https://[::ffff:127.0.0.1]', 'model_address_blocked'],
    ['https://169.254.169.254', 'model_address_blocked'],
    ['https://10.0.0.1', 'model_address_blocked'],
    ['https://2130706433', 'model_address_blocked'],
    ['https://0x7f.1/v1', 'model_address_blocked'],
    ['https://100.64.0.1', 'model_address_blocked'],
    ['https://[64:ff9b::a9fe:a9fe]', 'model_address_blocked'],
    ['https://[2002:a00:1::]', 'model_address_blocked'],
    ['https://[fe80::1]', 'model_address_blocked'],
    ['https://localhost/v1', 'model_address_blocked'],
    ['https://LOCALHOST./v1', 'model_address_blocked'],
    ['https://api.localhost/v1', 'model_address_blocked'],
    ['https://api.localhost../v1', 'model_address_blocked'],
    ['http://127.0.0.1:8080', 'model_address_blocked'],
    ['ftp://api.example.com/v1', 'model_https_required'],
    ['https://user:pass@api.example.com/v1', 'model_invalid_url'],
    ['https://@api.example.com/v1', 'model_invalid_url'],
    ['https://api.example.com/v1?x=1', 'model_invalid_url'],
    ['https://api.example.com/v1?', 'model_invalid_url'],
    ['https://api.example.com/v1#frag', 'model_invalid_url'],
    ['https://api.example.com/v1#', 'model_invalid_url'],
    ['https://[fe80::1%25eth0]/v1', 'model_invalid_url'],
    ['not a url', 'model_invalid_url'],
    ['', 'model_invalid_url'],
    ['https://api.example.com/' + 'a'.repeat(500), 'model_url_too_long'],
  ])('%s -> %s', (raw, code) => {
    expect(checkModelBaseUrl(raw, strict)).toEqual({ ok: false, code })
  })

  it('refuses non-strings', () => {
    expect(checkModelBaseUrl(undefined, strict)).toEqual({ ok: false, code: 'model_invalid_url' })
  })

  it.each([
    ['https://api.groq.com/openai/v1', 'https://api.groq.com/openai/v1'],
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/chat/completions/', 'https://api.openai.com/v1'],
    ['HTTPS://API.Example.COM:8443/v1', 'https://api.example.com:8443/v1'],
    ['https://api.example.com', 'https://api.example.com'],
    ['https://93.184.216.34/v1', 'https://93.184.216.34/v1'],
  ])('accepts %s as %s', (raw, baseUrl) => {
    const result = checkModelBaseUrl(raw, strict)
    expect(result).toMatchObject({ ok: true, baseUrl, protocol: 'https:' })
  })

  it('returns the bare host for IPv6 literals', () => {
    expect(checkModelBaseUrl('https://[2606:2800:220:1::1]/v1', strict)).toEqual({
      ok: true, baseUrl: 'https://[2606:2800:220:1::1]/v1', host: '2606:2800:220:1::1', protocol: 'https:',
    })
  })
})

describe('checkModelBaseUrl with the flag on', () => {
  it.each([
    'http://127.0.0.1:8080/v1',
    'http://localhost:11434/v1',
    'http://[::1]:8080',
    'http://10.0.0.1/v1',
    'http://ollama.internal/v1',
    'https://127.0.0.1:8443',
    'https://api.example.com/v1',
  ])('accepts %s', (raw) => {
    expect(checkModelBaseUrl(raw, permissive).ok).toBe(true)
  })

  it('still needs https for a public literal IP', () => {
    expect(checkModelBaseUrl('http://93.184.216.34/v1', permissive)).toEqual({ ok: false, code: 'model_https_required' })
  })

  it('still refuses userinfo, query and fragment', () => {
    expect(checkModelBaseUrl('http://u:p@127.0.0.1/v1', permissive)).toEqual({ ok: false, code: 'model_invalid_url' })
    expect(checkModelBaseUrl('http://127.0.0.1/v1?a', permissive)).toEqual({ ok: false, code: 'model_invalid_url' })
  })
})

describe('validateModelInput', () => {
  const good = { baseUrl: 'https://api.openai.com/v1/', model: 'gpt-4o-mini', apiKey: 'sk-test-123' }

  it('returns the normalised config', () => {
    expect(validateModelInput(good, strict)).toEqual({
      ok: true, config: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: 'sk-test-123' },
    })
  })

  it.each([
    ['over-cap url', { ...good, baseUrl: 'https://api.example.com/' + 'a'.repeat(480) }, 'model_url_too_long'],
    ['non-string url', { ...good, baseUrl: 42 }, 'model_invalid_url'],
    ['over-cap model', { ...good, model: 'a'.repeat(201) }, 'model_invalid_id'],
    ['model with a space', { ...good, model: 'bad model' }, 'model_invalid_id'],
    ['empty model', { ...good, model: '' }, 'model_invalid_id'],
    ['over-cap key', { ...good, apiKey: 'k'.repeat(513) }, 'model_invalid_key'],
    ['key with a space', { ...good, apiKey: 'sk test' }, 'model_invalid_key'],
    ['key with a newline', { ...good, apiKey: 'sk-test\n' }, 'model_invalid_key'],
    ['empty key', { ...good, apiKey: '' }, 'model_invalid_key'],
    ['userinfo', { ...good, baseUrl: 'https://u:p@api.example.com/v1' }, 'model_invalid_url'],
    ['query', { ...good, baseUrl: 'https://api.example.com/v1?q' }, 'model_invalid_url'],
    ['fragment', { ...good, baseUrl: 'https://api.example.com/v1#f' }, 'model_invalid_url'],
    ['bad model on a private host', { ...good, baseUrl: 'https://private.example/v1', model: 'm m' }, 'model_invalid_id'],
    ['null body', null, 'model_invalid_url'],
  ])('refuses %s before any DNS', (_label, input, code) => {
    expect(validateModelInput(input, strict)).toEqual({ ok: false, code })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('accepts the maximum lengths', () => {
    const baseUrl = 'https://api.example.com/' + 'a'.repeat(500 - 'https://api.example.com/'.length)
    const result = validateModelInput({ baseUrl, model: 'm'.repeat(200), apiKey: 'k'.repeat(512) }, strict)
    expect(result.ok).toBe(true)
    expect(lookupMock).not.toHaveBeenCalled()
  })
})

describe('guardedLookup', () => {
  const off = guardedLookup({ allowPrivate: false, protocol: 'https:' })

  it.each([
    ['all:true', { all: true }],
    ['single address', {}],
  ])('blocks a host that resolves privately (%s)', async (_label, options) => {
    const { err } = await runLookup(off, 'private.example', options)
    expect(err).toBeInstanceOf(ModelError)
    expect((err as ModelError).code).toBe('model_address_blocked')
    expect(lookupMock).toHaveBeenCalledWith('private.example', { all: true, verbatim: true }, expect.any(Function))
  })

  it.each([
    ['all:true', { all: true }],
    ['single address', {}],
  ])('blocks a mixed public and private answer (%s)', async (_label, options) => {
    const { err } = await runLookup(off, 'mixed.example', options)
    expect((err as ModelError).code).toBe('model_address_blocked')
  })

  it('blocks an IPv4-mapped link-local answer', async () => {
    const { err } = await runLookup(off, 'mapped.example', { all: true })
    expect((err as ModelError).code).toBe('model_address_blocked')
  })

  it('returns every address for all:true', async () => {
    const { err, address } = await runLookup(off, 'public.example', { all: true })
    expect(err).toBeNull()
    expect(address).toEqual(ANSWERS['public.example'])
  })

  it('returns one address for the single form, honouring family', async () => {
    expect(await runLookup(off, 'public.example', {})).toEqual({ err: null, address: '93.184.216.34', family: 4 })
    expect(await runLookup(off, 'public.example', { family: 6 })).toEqual({
      err: null, address: '2606:2800:220:1::1', family: 6,
    })
  })

  it.each([['not-there.example'], ['empty.example']])('maps a DNS failure for %s to unreachable', async (host) => {
    const { err } = await runLookup(off, host, { all: true })
    expect((err as ModelError).code).toBe('model_unreachable')
    expect((err as Error).message).toBe('model_unreachable')
  })

  it('with the flag on allows private answers over https', async () => {
    const on = guardedLookup({ allowPrivate: true, protocol: 'https:' })
    expect((await runLookup(on, 'private.example', { all: true })).err).toBeNull()
    expect((await runLookup(on, 'public.example', { all: true })).err).toBeNull()
  })

  it('with the flag on, http needs every address to be non-public', async () => {
    const on = guardedLookup({ allowPrivate: true, protocol: 'http:' })
    expect((await runLookup(on, 'loop.example', {})).err).toBeNull()
    expect(((await runLookup(on, 'public.example', {})).err as ModelError).code).toBe('model_address_blocked')
    expect(((await runLookup(on, 'mixed.example', { all: true })).err as ModelError).code).toBe('model_address_blocked')
  })
})

describe('guardedLookup as the http.request lookup option', () => {
  let server: http.Server
  let port: number
  let hits = 0

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      hits += 1
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  function get(host: string, lookup: LookupFunction, autoSelectFamily: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      // @types/node 20 lacks autoSelectFamily on RequestOptions; Node passes it through to net.connect.
      const options: http.RequestOptions & { autoSelectFamily: boolean } = {
        host, port, path: '/', agent: false, lookup, autoSelectFamily,
      }
      const req = http.request(options, (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => resolve(body))
      })
      req.on('error', reject)
      req.end()
    })
  }

  it.each([[true], [false]])('connects to the pinned loopback address with the flag on (autoSelectFamily=%s)', async (auto) => {
    const before = hits
    const inner = guardedLookup({ allowPrivate: true, protocol: 'http:' })
    const seenAll: unknown[] = []
    const spy: LookupFunction = (host, options, cb) => {
      seenAll.push(options?.all)
      inner(host, options, cb)
    }
    await expect(get('loop.example', spy, auto)).resolves.toBe('ok')
    expect(hits).toBe(before + 1)
    // Node calls lookup with all:true under autoSelectFamily and the single-address form without it.
    expect(seenAll).toEqual([auto ? true : undefined])
  })

  it.each([[true], [false]])('refuses before connecting with the flag off (autoSelectFamily=%s)', async (auto) => {
    const before = hits
    const err = await get('loop.example', guardedLookup({ allowPrivate: false, protocol: 'https:' }), auto).catch((e) => e)
    expect(err).toBeInstanceOf(ModelError)
    expect((err as ModelError).code).toBe('model_address_blocked')
    expect(hits).toBe(before)
  })

  it('accepts the loopback base URL statically with the flag on', () => {
    expect(checkModelBaseUrl(`http://127.0.0.1:${port}/v1`, permissive)).toEqual({
      ok: true, baseUrl: `http://127.0.0.1:${port}/v1`, host: '127.0.0.1', protocol: 'http:',
    })
    expect(checkModelBaseUrl(`http://127.0.0.1:${port}/v1`, strict)).toEqual({ ok: false, code: 'model_address_blocked' })
  })
})
