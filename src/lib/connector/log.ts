import { fingerprint } from '../storage/log'
import type { ConnectorErrorCode, ConnectorOp } from './shared'

export function connectorLabel(baseUrl: string): string {
  return 'backend=#' + fingerprint(baseUrl)
}

// The only per-call log line: never the address, key id, secret, signature, question, passages or any backend body.
export function connectorCallLog(op: ConnectorOp, baseUrl: string, outcome: 'ok' | ConnectorErrorCode, ms: number): void {
  console.log(`connector call op=${op} ${connectorLabel(baseUrl)} outcome=${outcome} ms=${Math.max(0, Math.round(ms))}`)
}
