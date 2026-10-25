import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as http from 'node:http'
import * as https from 'node:https'
import { parseArgs } from 'node:util'
import { HEADER_NAMES, signRequestHeaders } from '../signing.js'

// Sends one signed request to a connector and prints `status=<n>` and the
// response body. The secret is read only from CONNECTOR_SECRET so it never
// lands in shell history or a process list, and it is never printed. Request
// headers (which include the signature) are never printed either.
//
// Exit codes: 0 when any HTTP response arrived (whatever its status),
// 1 when the request failed, 2 on a usage error.

const USAGE = `Usage: CONNECTOR_SECRET=<secret> node dist/src/cli/sign.js --base <url> --key-id <id> --method <METHOD> --path </v1/...>
       [--body <json> | --body-file <file>] [--timestamp <unix seconds>] [--nonce <nonce>]
       [--tamper signature|body|path]

  --base       Connector base URL, including any mount prefix (https://support.example.com/kb).
  --path       API path that is signed, starting with /v1/. It is appended to --base.
  --timestamp  Defaults to now. Use an old value to test the 300 s window.
  --nonce      Defaults to 16 random bytes in base64url. Send the same value twice to test replay.
  --tamper     signature: change the last hex digit of the signature.
               body: sign the body, then send it with one extra trailing space (needs a body).
               path: sign --path, then send it with ?tampered=1 appended.`

const TIMEOUT_MS = 30_000
const TAMPER_MODES = ['signature', 'body', 'path'] as const
type Tamper = (typeof TAMPER_MODES)[number]

class UsageError extends Error {}

interface Args {
  base: URL
  keyId: string
  method: string
  path: string
  body: string
  timestamp: string
  nonce: string
  tamper: Tamper | null
}

function parse(argv: string[]): Args {
  let values
  try {
    ;({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        base: { type: 'string' },
        'key-id': { type: 'string' },
        method: { type: 'string' },
        path: { type: 'string' },
        body: { type: 'string' },
        'body-file': { type: 'string' },
        timestamp: { type: 'string' },
        nonce: { type: 'string' },
        tamper: { type: 'string' },
        help: { type: 'boolean' },
      },
    }))
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : 'invalid arguments')
  }
  if (values.help) throw new UsageError('')

  for (const name of ['base', 'key-id', 'method', 'path'] as const) {
    if (!values[name]) throw new UsageError(`--${name} is required`)
  }
  let base: URL
  try {
    base = new URL(values.base as string)
  } catch {
    throw new UsageError('--base is not a URL')
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new UsageError('--base must be http: or https:')
  if (base.search || base.hash) throw new UsageError('--base must not have a query or fragment')

  const path = values.path as string
  if (!path.startsWith('/v1/')) throw new UsageError('--path must start with /v1/')

  if (values.body !== undefined && values['body-file'] !== undefined) {
    throw new UsageError('use either --body or --body-file, not both')
  }
  const body = values['body-file'] !== undefined ? readFileSync(values['body-file'], 'utf8') : (values.body ?? '')

  let tamper: Tamper | null = null
  if (values.tamper !== undefined) {
    if (!(TAMPER_MODES as readonly string[]).includes(values.tamper)) {
      throw new UsageError('--tamper must be signature, body or path')
    }
    tamper = values.tamper as Tamper
    if (tamper === 'body' && body === '') throw new UsageError('--tamper body needs --body or --body-file')
  }

  return {
    base,
    keyId: values['key-id'] as string,
    method: (values.method as string).toUpperCase(),
    path,
    body,
    timestamp: values.timestamp ?? String(Math.floor(Date.now() / 1000)),
    nonce: values.nonce ?? randomBytes(16).toString('base64url'),
    tamper,
  }
}

function flipLastHex(signature: string): string {
  const last = signature.slice(-1)
  return signature.slice(0, -1) + (last === '0' ? '1' : '0')
}

interface Outgoing {
  url: URL
  method: string
  headers: Record<string, string>
  body: Buffer
}

/** Signs the request, then applies the requested tampering to what is sent. */
function buildRequest(args: Args, secret: string): Outgoing {
  const headers = signRequestHeaders({
    keyId: args.keyId,
    secret,
    method: args.method,
    path: args.path,
    body: args.body,
    timestamp: args.timestamp,
    nonce: args.nonce,
  })
  let sentPath = args.path
  let sentBody = args.body
  if (args.tamper === 'signature') headers[HEADER_NAMES.signature] = flipLastHex(headers[HEADER_NAMES.signature])
  if (args.tamper === 'body') sentBody = `${args.body} `
  if (args.tamper === 'path') sentPath = `${args.path}${args.path.includes('?') ? '&' : '?'}tampered=1`

  const body = Buffer.from(sentBody, 'utf8')
  const prefix = args.base.pathname.replace(/\/+$/, '')
  const url = new URL(args.base.origin)
  const outgoing: Record<string, string> = { ...headers, accept: 'application/json' }
  if (body.length > 0) {
    outgoing['content-type'] = 'application/json'
    outgoing['content-length'] = String(body.length)
  }
  return { url: new URL(`${prefix}${sentPath}`, url), method: args.method, headers: outgoing, body }
}

function send(request: Outgoing): Promise<{ status: number; body: string }> {
  const transport = request.url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = transport.request(
      request.url,
      { method: request.method, headers: request.headers, agent: false, timeout: TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
    req.end(request.body.length > 0 ? request.body : undefined)
  })
}

async function main(): Promise<void> {
  let args: Args
  try {
    args = parse(process.argv.slice(2))
  } catch (error) {
    if (error instanceof UsageError) {
      if (error.message) console.error(`sign: ${error.message}`)
      console.error(USAGE)
      process.exit(2)
    }
    throw error
  }
  const secret = process.env.CONNECTOR_SECRET?.trim()
  if (!secret) {
    console.error('sign: set CONNECTOR_SECRET to the key secret')
    process.exit(2)
  }

  try {
    const response = await send(buildRequest(args, secret))
    console.log(`status=${response.status}`)
    if (response.body) console.log(response.body)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.message : 'unknown')
    console.error(`sign: request failed (${code})`)
    process.exit(1)
  }
}

void main()
