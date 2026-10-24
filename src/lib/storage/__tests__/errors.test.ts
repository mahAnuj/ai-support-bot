/** @jest-environment node */
import {
  StorageError,
  STORAGE_ERROR_CODES,
  STORAGE_ERROR_MESSAGES,
  STORAGE_ERROR_STATUS,
  isStorageError,
  mapDriverError,
  safeErrorSummary,
  storageErrorMessage,
} from '../errors'

describe('mapDriverError', () => {
  it.each([
    [{ code: '28P01' }, 'auth_failed'],
    [{ code: '3D000' }, 'database_not_found'],
    [{ code: '42501' }, 'insufficient_privilege'],
    [{ code: 'ECONNREFUSED' }, 'db_unreachable'],
    [{ code: 'ENOTFOUND' }, 'host_not_found'],
    [new Error('timeout exceeded when trying to connect'), 'db_timeout'],
  ])('maps %p to %s', (input, expected) => {
    expect(mapDriverError(input).code).toBe(expected)
  })

  it('passes a StorageError through unchanged', () => {
    const err = new StorageError('schema_mismatch')
    expect(mapDriverError(err)).toBe(err)
  })

  it('maps unknown input to storage_error', () => {
    expect(mapDriverError({ code: 'XX999' }).code).toBe('storage_error')
    expect(mapDriverError('boom').code).toBe('storage_error')
    expect(mapDriverError(null).code).toBe('storage_error')
  })
})

describe('StorageError', () => {
  it('uses the code as its message', () => {
    const err = new StorageError('auth_failed')
    expect(err.message).toBe('auth_failed')
    expect(err.status).toBe(422)
    expect(isStorageError(err)).toBe(true)
    expect(isStorageError(new Error('auth_failed'))).toBe(false)
  })

  it('has a status and message for every code', () => {
    for (const code of STORAGE_ERROR_CODES) {
      expect(typeof STORAGE_ERROR_STATUS[code]).toBe('number')
      expect(STORAGE_ERROR_MESSAGES[code].length).toBeGreaterThan(0)
    }
  })
})

describe('storageErrorMessage', () => {
  it('falls back to the storage_error message for unknown codes', () => {
    expect(storageErrorMessage('nope')).toBe(STORAGE_ERROR_MESSAGES.storage_error)
    expect(storageErrorMessage('auth_failed')).toBe(STORAGE_ERROR_MESSAGES.auth_failed)
  })
})

describe('safeErrorSummary', () => {
  it('never includes the driver message', () => {
    const summary = safeErrorSummary({ code: '28P01', message: 'secret-pw' })
    expect(summary).not.toContain('secret-pw')
    expect(summary).toBe('code=28P01 mapped=auth_failed')
  })
})
