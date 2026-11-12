// Server-only: projects, one per site, in the owner's database.
//
// A project is a workspace (support_bot.workspaces): its documents, assistants,
// automation keys, conversation log and daily stats are already kept apart by
// workspace_id everywhere. This module only lists them, names them, creates
// new ones and checks that one exists before the builder switches to it.
// Names live in the optional support_bot.projects table; without it projects
// still work and are shown unnamed.
import { randomUUID } from 'node:crypto'
import type { ParsedConnection } from './connection'
import { mapDriverError } from './errors'
import { getPool } from './pg-pool'

export const MAX_PROJECT_NAME = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ProjectSummary {
  id: string
  name: string | null
  documents: number
  assistants: number
  createdAt: string
  lastUsedAt: string
  current: boolean
}

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

export function normalizeProjectName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_PROJECT_NAME)
  return name || null
}

const code = (e: unknown) => (e as { code?: unknown })?.code

type Row = { id: string; name: string | null; documents: number; assistants: number; created_at: Date; last_accessed: Date }

const COUNTS = `(SELECT count(*) FROM support_bot.documents d WHERE d.workspace_id = w.id)::int AS documents,
  (SELECT count(*) FROM support_bot.widgets g WHERE g.workspace_id = w.id AND g.is_active)::int AS assistants`

export async function listProjects(connection: ParsedConnection, currentId: string): Promise<{ projects: ProjectSummary[]; namesAvailable: boolean }> {
  const pool = await getPool(connection)
  const map = (rows: Row[]) => rows.map((r) => ({
    id: r.id, name: r.name, documents: r.documents, assistants: r.assistants,
    createdAt: r.created_at.toISOString(), lastUsedAt: r.last_accessed.toISOString(), current: r.id === currentId,
  }))
  try {
    const r = await pool.query<Row>(
      `SELECT w.id, p.name, ${COUNTS}, w.created_at, w.last_accessed FROM support_bot.workspaces w
       LEFT JOIN support_bot.projects p ON p.workspace_id = w.id ORDER BY w.created_at, w.id LIMIT 100`,
    )
    return { projects: map(r.rows), namesAvailable: true }
  } catch (e) {
    if (code(e) !== '42P01') throw mapDriverError(e)
    // No names table yet (a limited login after an upgrade): list without names.
    try {
      const r = await pool.query<Row>(`SELECT w.id, NULL::text AS name, ${COUNTS}, w.created_at, w.last_accessed FROM support_bot.workspaces w ORDER BY w.created_at, w.id LIMIT 100`)
      return { projects: map(r.rows), namesAvailable: false }
    } catch (e2) {
      throw mapDriverError(e2)
    }
  }
}

async function saveName(connection: ParsedConnection, workspaceId: string, name: string): Promise<boolean> {
  try {
    const pool = await getPool(connection)
    await pool.query(
      `INSERT INTO support_bot.projects (workspace_id, name) VALUES ($1, $2)
       ON CONFLICT (workspace_id) DO UPDATE SET name = EXCLUDED.name`,
      [workspaceId, name],
    )
    return true
  } catch (e) {
    if (code(e) === '42P01') return false
    throw mapDriverError(e)
  }
}

/** Creates an empty project and names it. Returns its id and whether the name could be saved. */
export async function createProject(connection: ParsedConnection, name: string | null): Promise<{ id: string; named: boolean }> {
  let id: string
  try {
    const pool = await getPool(connection)
    const r = await pool.query<{ id: string }>('INSERT INTO support_bot.workspaces (id) VALUES ($1) RETURNING id', [randomUUID()])
    id = r.rows[0].id
  } catch (e) {
    throw mapDriverError(e)
  }
  const named = name ? await saveName(connection, id, name) : true
  return { id, named }
}

export async function renameProject(connection: ParsedConnection, workspaceId: string, name: string): Promise<boolean> {
  return saveName(connection, workspaceId, name)
}

/** True when the workspace exists; marks it as the most recently used, so a later connect reopens it. */
export async function openProject(connection: ParsedConnection, workspaceId: string): Promise<boolean> {
  try {
    const pool = await getPool(connection)
    const r = await pool.query('UPDATE support_bot.workspaces SET last_accessed = now() WHERE id = $1 RETURNING id', [workspaceId])
    return (r.rowCount ?? 0) > 0
  } catch (e) {
    throw mapDriverError(e)
  }
}
