'use client'

import { useEffect, useId, useRef, useState, type FormEvent, type JSX } from 'react'
import { MODEL_LIMITS, PROVIDER_PRESETS, modelErrorMessage, type ModelErrorCode, type ProviderPresetId } from '@/lib/model/shared'
import { checkModelInput, trimModelInput, type ModelField, type OwnModel } from './useOwnModel'

export interface OwnModelStepProps {
  available: boolean
  ready: boolean
  ownModel: OwnModel
  // When set, the form is shown disabled with this one-line reason; a saved model can still be removed.
  disabledReason?: string | null
}

const WRAPPER = 'mt-6 rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6'
const HEADING = 'text-base font-semibold text-ink'
const BODY = 'mt-1 max-w-[60ch] text-sm text-ink-muted'
const LABEL = 'text-sm font-medium text-ink'
const INPUT =
  'h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 font-mono text-sm text-ink placeholder:text-ink-subtle focus:border-accent disabled:cursor-not-allowed disabled:bg-sunken'
const SELECT =
  'h-11 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus:border-accent disabled:cursor-not-allowed disabled:bg-sunken'
const HINT = 'mt-1.5 text-xs text-ink-subtle'
const FIELD_ERROR = 'mt-1.5 text-sm text-danger [overflow-wrap:anywhere]'
const PRIMARY_BUTTON =
  'inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-white hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60'
const SECONDARY_BUTTON =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-line-strong bg-surface px-5 text-sm font-semibold text-ink hover:bg-sunken'
const CODE = 'rounded bg-sunken px-1 py-0.5 font-mono text-xs text-ink'
const VALUE = 'font-mono text-sm text-ink [overflow-wrap:anywhere]'
const REASON = 'mt-3 max-w-[60ch] rounded-md border border-line bg-sunken px-3 py-2 text-sm text-ink'

const PRESET_IDS = Object.keys(PROVIDER_PRESETS) as ProviderPresetId[]
const DEFAULT_PRESET: ProviderPresetId = 'groq'

// Server codes that are about one field are shown under that field; the rest go in the general alert.
const FIELD_FOR_CODE: Partial<Record<ModelErrorCode, ModelField>> = {
  model_invalid_url: 'baseUrl',
  model_url_too_long: 'baseUrl',
  model_https_required: 'baseUrl',
  model_address_blocked: 'baseUrl',
  model_unreachable: 'baseUrl',
  model_bad_response: 'baseUrl',
  model_invalid_id: 'model',
  model_not_found: 'model',
  model_invalid_key: 'apiKey',
  model_auth_rejected: 'apiKey',
}

const FIELD_ORDER: ModelField[] = ['baseUrl', 'model', 'apiKey']

function Spinner() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" className="motion-safe:animate-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0 text-danger">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5M12 16h.01" />
    </svg>
  )
}

function ChipIcon() {
  return (
    <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className="mt-[3px] shrink-0 text-accent">
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5" />
    </svg>
  )
}

export default function OwnModelStep({ available, ready, ownModel, disabledReason = null }: OwnModelStepProps): JSX.Element | null {
  const [preset, setPreset] = useState<ProviderPresetId>(DEFAULT_PRESET)
  const [baseUrl, setBaseUrl] = useState<string>(PROVIDER_PRESETS[DEFAULT_PRESET].baseUrl)
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clientErrors, setClientErrors] = useState<Partial<Record<ModelField, ModelErrorCode>>>({})
  // Hides the last server error once the user edits a field, without needing a reset on the hook.
  const [showServerError, setShowServerError] = useState(false)

  const presetRef = useRef<HTMLSelectElement>(null)
  const savedHeadingRef = useRef<HTMLHeadingElement>(null)
  const fieldRefs = useRef<Record<ModelField, HTMLInputElement | null>>({ baseUrl: null, model: null, apiKey: null })
  const pendingFocus = useRef<'result' | 'form' | null>(null)

  const baseId = useId()
  const headingId = `${baseId}-heading`
  const introId = `${baseId}-intro`
  const presetId = `${baseId}-preset`
  const ids: Record<ModelField, { input: string; hint: string; error: string }> = {
    baseUrl: { input: `${baseId}-url`, hint: `${baseId}-url-hint`, error: `${baseId}-url-error` },
    model: { input: `${baseId}-model`, hint: `${baseId}-model-hint`, error: `${baseId}-model-error` },
    apiKey: { input: `${baseId}-key`, hint: `${baseId}-key-hint`, error: `${baseId}-key-error` },
  }
  const generalErrorId = `${baseId}-error`
  const costId = `${baseId}-cost`
  const reasonId = `${baseId}-reason`

  const saved = ownModel.model

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    if (target === 'result') {
      if (saved) {
        savedHeadingRef.current?.focus()
      } else if (ownModel.error && !ownModel.saving) {
        // The key field is empty after a failed save, so it is the default place to continue from.
        const code = ownModel.error.code
        fieldRefs.current[(code && FIELD_FOR_CODE[code]) || 'apiKey']?.focus()
      } else {
        return
      }
    } else if (!saved) {
      presetRef.current?.focus()
    } else {
      return
    }
    pendingFocus.current = null
  }, [saved, ownModel.error, ownModel.saving])

  if (!ready) return null

  const serverError = showServerError && !ownModel.saving ? ownModel.error : null
  const serverField = serverError?.code ? FIELD_FOR_CODE[serverError.code] : undefined
  const fieldError = (field: ModelField): string | null => {
    const code = clientErrors[field]
    if (code) return modelErrorMessage(code)
    if (serverError && serverField === field) return serverError.message
    return null
  }
  const generalError = serverError && !serverField ? serverError.message : null

  if (available && saved) {
    const remove = () => {
      pendingFocus.current = 'form'
      setShowServerError(false)
      ownModel.remove()
    }
    return (
      <section aria-labelledby={headingId} className={WRAPPER}>
        <h3 id={headingId} ref={savedHeadingRef} tabIndex={-1} className={`${HEADING} flex items-start gap-2`}>
          <ChipIcon />
          Using your own model
        </h3>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-sm text-ink-muted">Model</dt>
          <dd className={VALUE}>{saved.model}</dd>
          <dt className="mt-1 text-sm text-ink-muted sm:mt-0">Address</dt>
          <dd className={VALUE}>{saved.host}</dd>
        </dl>
        {disabledReason && <p id={reasonId} className={REASON}>{disabledReason}</p>}
        <p className={BODY}>
          {!disabledReason && 'The preview answers with this model. '}This browser keeps only an encrypted copy of your
          API key; the key itself is not stored here.
        </p>
        <div className="mt-4 flex flex-col items-start gap-2">
          <button type="button" onClick={remove} className={SECONDARY_BUTTON}>
            Remove model
          </button>
          <p className="max-w-[60ch] text-xs text-ink-muted">
            This removes the model from this browser{disabledReason ? '' : ' and the preview goes back to the demo model'}. Embeds you already
            generated keep using your key until you revoke it at your provider, or generate a new tag and remove the old
            one from your site.
          </p>
        </div>
      </section>
    )
  }

  const choosePreset = (next: ProviderPresetId) => {
    setPreset(next)
    setBaseUrl(PROVIDER_PRESETS[next].baseUrl)
    setClientErrors(errors => ({ ...errors, baseUrl: undefined }))
    setShowServerError(false)
  }

  const edit = (field: ModelField, value: string) => {
    if (field === 'baseUrl') setBaseUrl(value)
    else if (field === 'model') setModelId(value)
    else setApiKey(value)
    if (clientErrors[field]) setClientErrors(errors => ({ ...errors, [field]: undefined }))
    setShowServerError(false)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!available || disabledReason || ownModel.saving) return
    const input = trimModelInput({ baseUrl, model: modelId, apiKey })
    const problems = checkModelInput(input)
    const firstInvalid = FIELD_ORDER.find(field => problems[field])
    setClientErrors(problems)
    setShowServerError(false)
    if (firstInvalid) {
      fieldRefs.current[firstInvalid]?.focus()
      return
    }

    // The key leaves React state before the request starts, whatever the outcome.
    setApiKey('')
    setShowServerError(true)
    pendingFocus.current = 'result'
    await ownModel.save(input)
  }

  const describedBy = (field: ModelField, extra?: string): string =>
    [ids[field].hint, fieldError(field) ? ids[field].error : null, extra ?? null].filter(Boolean).join(' ')

  const fieldInput = (field: ModelField) => ({
    id: ids[field].input,
    ref: (el: HTMLInputElement | null) => {
      fieldRefs.current[field] = el
    },
    autoComplete: 'off',
    spellCheck: false,
    autoCapitalize: 'off',
    autoCorrect: 'off',
    'aria-invalid': fieldError(field) ? true : undefined,
  })

  const fieldErrorText = (field: ModelField) => {
    const message = fieldError(field)
    return (
      <p id={ids[field].error} aria-live="polite" className={message ? FIELD_ERROR : 'sr-only'}>
        {message ?? ''}
      </p>
    )
  }

  const canSubmit = available && !disabledReason && !ownModel.saving && baseUrl.trim() !== '' && modelId.trim() !== '' && apiKey.trim() !== ''

  return (
    <section aria-labelledby={headingId} className={WRAPPER}>
      <h3 id={headingId} className={HEADING}>Use your own model (optional)</h3>
      <p id={introId} className={BODY}>
        {available ? (
          <>
            {!disabledReason && 'The preview and the embed code answer with the demo model unless you add your own. '}Any
            API that speaks the OpenAI chat completions format works. Your provider&apos;s rate limits, pricing and data
            retention then apply.
          </>
        ) : (
          <>
            Using your own model isn&apos;t available on this deployment. It needs <code className={CODE}>EMBED_TOKEN_KEY</code>{' '}
            set on the server, because the API key is only ever kept encrypted. The demo model works as usual.
          </>
        )}
      </p>
      {available && disabledReason && <p id={reasonId} className={REASON}>{disabledReason}</p>}

      <form onSubmit={submit} noValidate className="mt-4">
        <fieldset
          disabled={!available || !!disabledReason}
          aria-describedby={!available ? introId : disabledReason ? reasonId : undefined}
          className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
        >
          <legend className="sr-only">Your model</legend>

          <div>
            <label htmlFor={presetId} className={LABEL}>Provider</label>
            <select
              id={presetId}
              ref={presetRef}
              value={preset}
              onChange={e => choosePreset(e.target.value as ProviderPresetId)}
              aria-describedby={`${presetId}-hint`}
              className={`mt-1.5 ${SELECT}`}
            >
              {PRESET_IDS.map(id => (
                <option key={id} value={id}>{PROVIDER_PRESETS[id].label}</option>
              ))}
            </select>
            <p id={`${presetId}-hint`} className={HINT}>Choosing a provider fills in its base URL. You can still edit it.</p>
          </div>

          <div>
            <label htmlFor={ids.baseUrl.input} className={LABEL}>API base URL</label>
            <input
              {...fieldInput('baseUrl')}
              name="model-base-url"
              type="url"
              inputMode="url"
              value={baseUrl}
              onChange={e => edit('baseUrl', e.target.value)}
              placeholder="https://api.example.com/v1"
              aria-describedby={describedBy('baseUrl')}
              className={`mt-1.5 ${INPUT}`}
            />
            <p id={ids.baseUrl.hint} className={HINT}>
              The address before <span className="font-mono">/chat/completions</span>, up to {MODEL_LIMITS.baseUrl} characters.
            </p>
            {fieldErrorText('baseUrl')}
          </div>

          <div>
            <label htmlFor={ids.model.input} className={LABEL}>Model ID</label>
            <input
              {...fieldInput('model')}
              name="model-id"
              type="text"
              value={modelId}
              onChange={e => edit('model', e.target.value)}
              aria-describedby={describedBy('model')}
              className={`mt-1.5 ${INPUT}`}
            />
            <p id={ids.model.hint} className={HINT}>Exactly as your provider lists it.</p>
            {fieldErrorText('model')}
          </div>

          <div>
            <label htmlFor={ids.apiKey.input} className={LABEL}>API key</label>
            <input
              {...fieldInput('apiKey')}
              name="model-api-key"
              type="password"
              value={apiKey}
              onChange={e => edit('apiKey', e.target.value)}
              aria-describedby={describedBy('apiKey')}
              className={`mt-1.5 ${INPUT}`}
            />
            <p id={ids.apiKey.hint} className={HINT}>
              Sent to this server once to check it. This browser keeps only an encrypted copy, and the field is cleared
              after each save.
            </p>
            {fieldErrorText('apiKey')}
          </div>

          <div className="flex flex-col items-start gap-2">
            <p id={costId} className="max-w-[60ch] text-sm text-ink-muted">
              Saving sends one short test request to this address. Your provider may bill for it.
            </p>
            <button
              type="submit"
              disabled={!canSubmit}
              aria-busy={ownModel.saving}
              aria-describedby={[costId, generalError ? generalErrorId : null].filter(Boolean).join(' ')}
              className={PRIMARY_BUTTON}
            >
              {ownModel.saving ? (
                <>
                  <Spinner />
                  Checking
                </>
              ) : (
                'Save model'
              )}
            </button>
          </div>
        </fieldset>
      </form>

      <div id={generalErrorId} aria-live="assertive">
        {generalError && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-danger/40 bg-danger-tint px-3 py-2.5 text-sm text-ink">
            <AlertIcon />
            <p className="min-w-0 [overflow-wrap:anywhere]">{generalError}</p>
          </div>
        )}
      </div>
    </section>
  )
}
