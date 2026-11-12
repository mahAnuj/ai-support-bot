import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { builderErrorResponse, resolveBuilderStore, storageErrorResponse } from '../../../../lib/storage/resolve'
import { isAssistantId, listAssistants, normalizeAssistantEdit, updateAssistant, getAssistantPrefs, saveAssistantPrefs, prefsAvailable, EMPTY_PREFS, type AssistantPrefs } from '../../../../lib/storage/widget-edit'
import { normalizeStarterQuestions } from '../../../../lib/starter-questions'
import { normalizeOriginList, ORIGIN_ERROR_MESSAGES } from '../../../../lib/origins'
import { MODEL_TOKEN_HEADER } from '../../../../lib/model/shared'
import { resolveBuilderModel } from '../../../../lib/model/resolve'
import { getPool } from '../../../../lib/storage/pg-pool'
import { ensureSchema } from '../../../../lib/storage/schema'

const PREFS_UNAVAILABLE =
  "This database login can't create the table for these settings. Run scripts/support-bot-schema.sql and scripts/support-bot-role.sql as an admin, or connect once with your admin login and one-click setup."


export const dynamic = 'force-dynamic'

// "Your assistants": the widgets in the owner's database, listed and edited in
// place. Builder token only, never an automation key: a leaked key must not be
// able to rewrite what the assistant says on the owner's site.
function ownerDatabase(request: NextRequest) {
  if (request.headers.get('authorization') !== null) return { ok: false as const, res: storageErrorResponse(new StorageError('token_wrong_purpose')) }
  const resolved = resolveBuilderStore(request)
  if (!resolved.ok) return { ok: false as const, res: builderErrorResponse(resolved.error) }
  if (resolved.ctx.kind !== 'postgres') return { ok: false as const, res: storageErrorResponse(new StorageError('token_wrong_purpose')) }
  return { ok: true as const, ctx: resolved.ctx }
}

export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-widgets:${clientIp(request)}`, 30)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = ownerDatabase(request)
  if (!c.ok) return c.res
  try {
    await ensureSchema(await getPool(c.ctx.connection))
    const assistants = await listAssistants(c.ctx.connection, c.ctx.workspaceId)
    const withPrefs = await Promise.all(assistants.map(async (a) => {
      const p = (await getAssistantPrefs(c.ctx.connection, c.ctx.workspaceId, a.id)) ?? EMPTY_PREFS
      // The sealed model link never leaves the server; the builder only needs to know which model applies.
      return { ...a, starterQuestions: p.starterQuestions, allowedOrigins: p.allowedOrigins, model: p.modelMode ?? 'embed' }
    }))
    return NextResponse.json(
      { assistants: withPrefs, settingsAvailable: await prefsAvailable(c.ctx.connection) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    console.error(`assistants list failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}

export async function PATCH(request: NextRequest) {
  if (isRateLimited(`storage-widgets-edit:${clientIp(request)}`, 20)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = ownerDatabase(request)
  if (!c.ok) return c.res
  const id = request.nextUrl.searchParams.get('id')
  if (!isAssistantId(id)) return NextResponse.json({ error: 'Assistant not found' }, { status: 404 })
  let body: unknown
  try {
    const text = await request.text()
    if (text.length > 16_384) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }
  const checked = normalizeAssistantEdit(body)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const b = body as Record<string, unknown>

  // Suggested questions: an explicit list (empty means none), saved over the tag's attributes.
  const starterQuestions = Array.isArray(b.starterQuestions) ? normalizeStarterQuestions(b.starterQuestions) : null
  // Allowed sites: null keeps the sites sealed in the embed code; a list replaces them (empty: any site).
  let allowedOrigins: string[] | null = null
  if (b.allowedOrigins !== null && b.allowedOrigins !== undefined) {
    const list = normalizeOriginList(b.allowedOrigins)
    if (!list.ok) return NextResponse.json({ error: ORIGIN_ERROR_MESSAGES[list.code], code: 'invalid_origin' }, { status: 400 })
    allowedOrigins = list.origins
  }
  const modelChoice = b.model === 'demo' || b.model === 'builder' ? b.model : 'keep'

  try {
    await ensureSchema(await getPool(c.ctx.connection))
    if (!(await prefsAvailable(c.ctx.connection))) return NextResponse.json({ error: PREFS_UNAVAILABLE, code: 'insufficient_privilege' }, { status: 422 })
    const current = (await getAssistantPrefs(c.ctx.connection, c.ctx.workspaceId, id)) ?? EMPTY_PREFS
    const prefs: AssistantPrefs = { starterQuestions, allowedOrigins, modelMode: current.modelMode, modelToken: current.modelToken }
    if (modelChoice === 'demo') { prefs.modelMode = 'demo'; prefs.modelToken = null }
    if (modelChoice === 'builder') {
      // The model connected in this builder, as its sealed link (x-model-token).
      const resolvedModel = resolveBuilderModel(request)
      const header = request.headers.get(MODEL_TOKEN_HEADER)
      if (!resolvedModel.ok || !resolvedModel.model || !header) {
        return NextResponse.json({ error: 'Connect your model in the builder first, then choose it here.', code: 'model_required' }, { status: 400 })
      }
      // An assistant on your own model spends your credits, so it must name the sites allowed to use it.
      if (allowedOrigins !== null && allowedOrigins.length === 0) {
        return NextResponse.json({ error: 'An assistant that uses your own model needs at least one allowed site.', code: 'origins_required' }, { status: 400 })
      }
      prefs.modelMode = 'owner'
      prefs.modelToken = header
    }

    const saved = await updateAssistant(c.ctx.connection, c.ctx.workspaceId, id, checked.edit)
    if (!saved) return NextResponse.json({ error: 'Assistant not found' }, { status: 404 })
    await saveAssistantPrefs(c.ctx.connection, c.ctx.workspaceId, id, prefs)
    // Field names only; values are the owner's text and stay out of logs.
    console.log(`assistant edited ${c.ctx.label} instructions=${saved.instructions ? 'set' : 'none'}`)
    return NextResponse.json({ assistant: { ...saved, starterQuestions: prefs.starterQuestions, allowedOrigins: prefs.allowedOrigins, model: prefs.modelMode ?? 'embed' } })
  } catch (e) {
    console.error(`assistant edit failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
