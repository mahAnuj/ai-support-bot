import * as http from 'node:http'
import type { AddressInfo, Socket } from 'node:net'

export interface RecordedRequest {
  path: string
  headers: http.IncomingHttpHeaders
  body: string
}

export interface MockOpenAI {
  /** Base URL for a behaviour, for example base('ok') => http://127.0.0.1:<port>/ok/v1 */
  base(behaviour: 'ok' | 'redirect' | 'slow' | 'big' | '500' | 'empty'): string
  requests: RecordedRequest[]
  close(): Promise<void>
}

export const MOCK_ANSWER = 'Mock answer from the local model.'
export const MOCK_ERROR_SENTINEL = 'MOCK-OPENAI-ERROR-BODY-SENTINEL'

/** A local OpenAI-compatible server on 127.0.0.1. Tests only; nothing leaves the machine. */
export async function startMockOpenAI(): Promise<MockOpenAI> {
  const requests: RecordedRequest[] = []
  const sockets = new Set<Socket>()
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const path = req.url ?? ''
      requests.push({ path, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') })
      const behaviour = path.split('/')[1]
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers })
        res.end(JSON.stringify(body))
      }
      switch (behaviour) {
        case 'ok':
          return json(200, { choices: [{ message: { role: 'assistant', content: MOCK_ANSWER } }] })
        case 'empty':
          return json(200, { choices: [{ message: { role: 'assistant', content: '' } }] })
        case 'redirect':
          res.writeHead(302, { location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/ok/v1/chat/completions` })
          return res.end()
        case 'slow':
          return // never answers
        case 'big':
          res.writeHead(200, { 'content-type': 'application/json' })
          return res.end(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(1_100_000) } }] }))
        case '500':
          return json(500, { error: { message: MOCK_ERROR_SENTINEL } }, { 'x-sentinel': MOCK_ERROR_SENTINEL })
        default:
          return json(404, { error: { message: 'unknown' } })
      }
    })
  })
  server.on('connection', (s: Socket) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    base: (behaviour) => `http://127.0.0.1:${port}/${behaviour}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      }),
  }
}
