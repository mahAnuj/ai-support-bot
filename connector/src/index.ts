import pg from 'pg'
import { ConfigError, parseConfig } from './config.js'
import { transformersEmbedder } from './embed.js'
import { logStart } from './log.js'
import { PgNonceStore } from './nonce-store.js'
import { SchemaError, checkSchema, createPgStore, sqlState } from './pg-store.js'
import { createServer } from './server.js'

async function main(): Promise<void> {
  let config
  try {
    config = parseConfig(process.env)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`connector config error: ${error.message}`)
      process.exit(1)
    }
    throw error
  }

  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
  // An idle client error would otherwise crash the process; its message can hold the host.
  pool.on('error', (error) => console.error(`connector pool error code=${sqlState(error) ?? 'unknown'}`))

  try {
    await checkSchema(pool)
  } catch (error) {
    const code = error instanceof SchemaError ? error.code : `db_${sqlState(error) ?? 'unreachable'}`
    logStart({ port: config.port, keys: config.keys.size, answer: config.model !== null, schema: code })
    await pool.end().catch(() => {})
    process.exit(1)
  }

  const nonceStore = new PgNonceStore(pool, (error) =>
    console.error(`connector nonce purge error code=${sqlState(error) ?? 'unknown'}`),
  )
  nonceStore.start()

  const server = createServer({
    config,
    store: createPgStore(pool),
    embedder: transformersEmbedder(config.transformersCacheDir),
    nonceStore,
  })

  server.listen(config.port, config.host, () => {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : config.port
    logStart({ port, keys: config.keys.size, answer: config.model !== null, schema: 'ok' })
  })

  const shutdown = () => {
    nonceStore.stop()
    server.close(() => {
      pool.end().finally(() => process.exit(0))
    })
    server.closeIdleConnections()
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}

main().catch(() => {
  console.error('connector start failed')
  process.exit(1)
})
