// Server-only: list and edit the assistants (widgets) stored in an owner's database.
//
// Embed code for a database-backed widget points at a row in
// support_bot.widgets, and the widget script and every answer read that row on
// each request (the script is served no-store). So editing the row changes the
// live assistant on the owner's site from the next page load, with no new embed
// code. Allowed sites and an owner model are sealed into the embed token on
// purpose and cannot be edited here: that needs new embed code.
import { LIMITS } from '../guard'
import type { ParsedConnection } from './connection'
import { mapDriverError } from './errors'
import { getPool } from './pg-pool'

export const MAX_TITLE = 80
export const MAX_WELCOME = 500
export const MAX_INSTRUCTIONS = LIMITS.systemPrompt
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HEX = /^#[0-9a-f]{6}$/i
const POSITIONS = ['bottom-right', 'bottom-left'] as const
const SIZES = ['small', 'medium', 'large'] as const

export interface AssistantSummary {
  id: string
  title: string
  welcomeMessage: string
  primaryColor: string
  position: (typeof POSITIONS)[number]
  size: (typeof SIZES)[number]
  instructions: string
  createdAt: string
  updatedAt: string
}

export interface AssistantEdit {
  title: string
  welcomeMessage: string
  primaryColor: string
  position: (typeof POSITIONS)[number]
  size: (typeof SIZES)[number]
  instructions: string
}

export function isAssistantId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/** Checks an edit from the builder. Every field is required, so a save is never partial. */
export function normalizeAssistantEdit(body: unknown): { ok: true; edit: AssistantEdit } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Malformed request' }
  const b = body as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : null)
  const title = text(b.title)
  const welcomeMessage = text(b.welcomeMessage)
  const instructions = text(b.instructions) ?? ''
  if (!title) return { ok: false, error: 'The title cannot be empty.' }
  if (title.length > MAX_TITLE) return { ok: false, error: `The title can be at most ${MAX_TITLE} characters.` }
  if (!welcomeMessage) return { ok: false, error: 'The welcome message cannot be empty.' }
  if (welcomeMessage.length > MAX_WELCOME) return { ok: false, error: `The welcome message can be at most ${MAX_WELCOME} characters.` }
  if (instructions.length > MAX_INSTRUCTIONS) return { ok: false, error: `Instructions can be at most ${MAX_INSTRUCTIONS} characters.` }
  if (typeof b.primaryColor !== 'string' || !HEX.test(b.primaryColor)) return { ok: false, error: 'The colour must look like #14425c.' }
  if (!POSITIONS.includes(b.position as never)) return { ok: false, error: 'Unknown position.' }
  if (!SIZES.includes(b.size as never)) return { ok: false, error: 'Unknown size.' }
  return {
    ok: true,
    edit: {
      title,
      welcomeMessage,
      primaryColor: b.primaryColor.toLowerCase(),
      position: b.position as AssistantEdit['position'],
      size: b.size as AssistantEdit['size'],
      instructions,
    },
  }
}

type Row = {
  id: string; title: string; welcome_message: string; primary_color: string; position: string; size: string
  system_prompt: string | null; created_at: Date; updated_at: Date
}

function toSummary(r: Row): AssistantSummary {
  return {
    id: r.id,
    title: r.title,
    welcomeMessage: r.welcome_message,
    primaryColor: r.primary_color,
    position: (POSITIONS as readonly string[]).includes(r.position) ? (r.position as AssistantSummary['position']) : 'bottom-right',
    size: (SIZES as readonly string[]).includes(r.size) ? (r.size as AssistantSummary['size']) : 'medium',
    instructions: r.system_prompt ?? '',
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  }
}

const COLUMNS = 'id, title, welcome_message, primary_color, position, size, system_prompt, created_at, updated_at'

export async function listAssistants(connection: ParsedConnection, workspaceId: string): Promise<AssistantSummary[]> {
  try {
    const pool = await getPool(connection)
    const r = await pool.query<Row>(
      `SELECT ${COLUMNS} FROM support_bot.widgets WHERE workspace_id = $1 AND is_active ORDER BY created_at DESC, id LIMIT 100`,
      [workspaceId],
    )
    return r.rows.map(toSummary)
  } catch (e) {
    throw mapDriverError(e)
  }
}

/** Returns the saved assistant, or null when no active one with that id is in this workspace. */
export async function updateAssistant(connection: ParsedConnection, workspaceId: string, id: string, edit: AssistantEdit): Promise<AssistantSummary | null> {
  try {
    const pool = await getPool(connection)
    const r = await pool.query<Row>(
      `UPDATE support_bot.widgets SET title = $3, welcome_message = $4, primary_color = $5, position = $6, size = $7,
         system_prompt = NULLIF($8, ''), updated_at = now()
       WHERE id = $1 AND workspace_id = $2 AND is_active RETURNING ${COLUMNS}`,
      [id, workspaceId, edit.title, edit.welcomeMessage, edit.primaryColor, edit.position, edit.size, edit.instructions],
    )
    return r.rows[0] ? toSummary(r.rows[0]) : null
  } catch (e) {
    throw mapDriverError(e)
  }
}

// ---- Settings the embed code used to carry (support_bot.widget_prefs) ----

export interface AssistantPrefs {
  // null: not set here, so the script tag's data-question attributes apply.
  starterQuestions: string[] | null
  // null: not set here, so the sites sealed in the embed code apply.
  allowedOrigins: string[] | null
  // null: the model sealed in the embed code. 'demo': the shared model.
  // 'owner': modelToken, the builder's sealed sbm1_ model link.
  modelMode: 'demo' | 'owner' | null
  modelToken: string | null
}

export const EMPTY_PREFS: AssistantPrefs = { starterQuestions: null, allowedOrigins: null, modelMode: null, modelToken: null }

const missingTable = (e: unknown) => (e as { code?: unknown })?.code === '42P01'

/** The widget's saved settings, or null when none are saved or the table does not exist yet. */
export async function getAssistantPrefs(connection: ParsedConnection, workspaceId: string, widgetId: string): Promise<AssistantPrefs | null> {
  try {
    const pool = await getPool(connection)
    const r = await pool.query<{ starter_questions: string[] | null; allowed_origins: string[] | null; model_mode: 'demo' | 'owner' | null; model_token: string | null }>(
      'SELECT starter_questions, allowed_origins, model_mode, model_token FROM support_bot.widget_prefs WHERE widget_id = $1 AND workspace_id = $2',
      [widgetId, workspaceId],
    )
    const row = r.rows[0]
    if (!row) return null
    return { starterQuestions: row.starter_questions, allowedOrigins: row.allowed_origins, modelMode: row.model_mode, modelToken: row.model_token }
  } catch (e) {
    if (missingTable(e)) return null
    throw mapDriverError(e)
  }
}

/** Saves the settings; returns false when the table does not exist (a limited login after an upgrade). */
export async function saveAssistantPrefs(connection: ParsedConnection, workspaceId: string, widgetId: string, prefs: AssistantPrefs): Promise<boolean> {
  try {
    const pool = await getPool(connection)
    await pool.query(
      `INSERT INTO support_bot.widget_prefs (widget_id, workspace_id, starter_questions, allowed_origins, model_mode, model_token, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (widget_id) DO UPDATE SET starter_questions = EXCLUDED.starter_questions, allowed_origins = EXCLUDED.allowed_origins,
         model_mode = EXCLUDED.model_mode, model_token = EXCLUDED.model_token, updated_at = now()
       WHERE support_bot.widget_prefs.workspace_id = EXCLUDED.workspace_id`,
      [widgetId, workspaceId, prefs.starterQuestions, prefs.allowedOrigins, prefs.modelMode, prefs.modelToken],
    )
    return true
  } catch (e) {
    if (missingTable(e)) return false
    throw mapDriverError(e)
  }
}

export async function prefsAvailable(connection: ParsedConnection): Promise<boolean> {
  try {
    const pool = await getPool(connection)
    const r = await pool.query<{ ok: boolean }>("SELECT to_regclass('support_bot.widget_prefs') IS NOT NULL AS ok")
    return r.rows[0]?.ok === true
  } catch (e) {
    throw mapDriverError(e)
  }
}
