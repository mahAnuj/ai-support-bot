'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  API_KEY_PATTERN,
  MODEL_ID_PATTERN,
  MODEL_LIMITS,
  MODEL_LOCALSTORAGE_KEY,
  isModelErrorCode,
  modelErrorMessage,
  providerStatus,
  type ModelErrorCode,
} from '@/lib/model/shared'

export interface SavedModel {
  token: string
  model: string
  host: string
}

export interface OwnModelInput {
  baseUrl: string
  model: string
  apiKey: string
}

export interface OwnModelError {
  // null when the request never got an answer from this server
  code: ModelErrorCode | null
  message: string
}

export interface OwnModel {
  model: SavedModel | null
  saving: boolean
  error: OwnModelError | null
  save(input: OwnModelInput): Promise<boolean>
  remove(): void
}

export type ModelField = 'baseUrl' | 'model' | 'apiKey'

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again."

export function trimModelInput(input: OwnModelInput): OwnModelInput {
  return { baseUrl: input.baseUrl.trim(), model: input.model.trim(), apiKey: input.apiKey.trim() }
}

// Mirrors the server's caps so most mistakes are caught before a request is sent; the server still decides.
export function checkModelInput(input: OwnModelInput): Partial<Record<ModelField, ModelErrorCode>> {
  const problems: Partial<Record<ModelField, ModelErrorCode>> = {}
  const { baseUrl, model, apiKey } = input

  if (baseUrl.length > MODEL_LIMITS.baseUrl) problems.baseUrl = 'model_url_too_long'
  else if (!looksLikeHttpUrl(baseUrl)) problems.baseUrl = 'model_invalid_url'

  if (model.length > MODEL_LIMITS.modelId || !MODEL_ID_PATTERN.test(model)) problems.model = 'model_invalid_id'
  if (apiKey.length > MODEL_LIMITS.apiKey || !API_KEY_PATTERN.test(apiKey)) problems.apiKey = 'model_invalid_key'
  return problems
}

function looksLikeHttpUrl(value: string): boolean {
  if (value === '') return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== ''
  } catch {
    return false
  }
}

function parseSaved(raw: unknown): SavedModel | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { token, model, host } = raw as Record<string, unknown>
  if (typeof token !== 'string' || token === '' || typeof model !== 'string' || typeof host !== 'string') return null
  return { token, model, host }
}

function readStoredModel(): SavedModel | null {
  try {
    const raw = window.localStorage.getItem(MODEL_LOCALSTORAGE_KEY)
    return raw ? parseSaved(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeStoredModel(saved: SavedModel | null): void {
  try {
    if (saved) window.localStorage.setItem(MODEL_LOCALSTORAGE_KEY, JSON.stringify(saved))
    else window.localStorage.removeItem(MODEL_LOCALSTORAGE_KEY)
  } catch {
    // Storage can be blocked (private mode, policy); the model then lasts for this page only.
  }
}

function errorFromResponse(status: number, body: unknown): OwnModelError {
  const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  let code: ModelErrorCode | null = isModelErrorCode(fields.code) ? fields.code : null
  if (!code && status === 429) code = 'model_validate_rate_limited'
  if (!code && status === 503) code = 'model_unavailable'
  if (!code) return { code: null, message: modelErrorMessage(null) }
  return { code, message: modelErrorMessage(code, providerStatus(fields.details)) }
}

export function useOwnModel(available: boolean): OwnModel {
  const [stored, setStored] = useState<SavedModel | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<OwnModelError | null>(null)
  // Bumped on remove so a save that started before it can't bring the model back.
  const generation = useRef(0)

  useEffect(() => {
    setStored(readStoredModel())
  }, [])

  const save = useCallback(async (input: OwnModelInput): Promise<boolean> => {
    if (!available) {
      setError({ code: 'model_unavailable', message: modelErrorMessage('model_unavailable') })
      return false
    }
    const trimmed = trimModelInput(input)
    const problems = checkModelInput(trimmed)
    const firstProblem = problems.baseUrl ?? problems.model ?? problems.apiKey
    if (firstProblem) {
      setError({ code: firstProblem, message: modelErrorMessage(firstProblem) })
      return false
    }

    setSaving(true)
    setError(null)
    const started = generation.current
    try {
      const response = await fetch('/api/model/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trimmed),
      })
      const body = await response.json().catch(() => null)
      if (started !== generation.current) return false
      const saved = response.ok
        ? parseSaved({ token: body?.modelToken, model: body?.model, host: body?.host })
        : null
      if (!saved) {
        setError(errorFromResponse(response.status, body))
        return false
      }
      writeStoredModel(saved)
      setStored(saved)
      return true
    } catch {
      if (started === generation.current) setError({ code: null, message: NETWORK_ERROR })
      return false
    } finally {
      if (started === generation.current) setSaving(false)
    }
  }, [available])

  const remove = useCallback(() => {
    generation.current += 1
    writeStoredModel(null)
    setStored(null)
    setError(null)
    setSaving(false)
  }, [])

  const model = available ? stored : null

  return useMemo(
    () => ({ model, saving, error, save, remove }),
    [model, saving, error, save, remove],
  )
}
