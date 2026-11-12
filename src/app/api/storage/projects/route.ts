import { NextRequest, NextResponse } from 'next/server'
import { clientIp, isRateLimited } from '../../../../lib/guard'
import { StorageError, mapDriverError, safeErrorSummary } from '../../../../lib/storage/errors'
import { getPool } from '../../../../lib/storage/pg-pool'
import { createProject, isProjectId, listProjects, normalizeProjectName, renameProject, openProject } from '../../../../lib/storage/projects'
import { resolveOwnerDatabase, storageErrorResponse } from '../../../../lib/storage/resolve'
import { ensureSchema } from '../../../../lib/storage/schema'
import { sealBuilderToken } from '../../../../lib/storage/token'

export const dynamic = 'force-dynamic'

// Projects: one per site, each with its own documents, assistants, keys, log
// and stats. Owner only (builder token, never a key or embed code). Knowing
// the database login is what makes someone the owner, so a builder token for
// any project in a database may list, create and switch to the others in it.
//   GET                                   the projects in this database
//   POST {action: "create", name}         a new, empty project; returns its builder token
//   POST {action: "switch", id}           returns a builder token for that project
//   POST {action: "rename", id, name}     names a project
const NAMES_UNAVAILABLE =
  "Project names need one more table. Run scripts/support-bot-upgrade.sql as an admin, or connect once with your admin login and one-click setup."

export async function GET(request: NextRequest) {
  if (isRateLimited(`storage-projects:${clientIp(request)}`, 30)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = resolveOwnerDatabase(request)
  if (!c.ok) return c.res
  try {
    await ensureSchema(await getPool(c.ctx.connection))
    return NextResponse.json(await listProjects(c.ctx.connection, c.ctx.workspaceId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error(`projects list failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}

export async function POST(request: NextRequest) {
  if (isRateLimited(`storage-projects-post:${clientIp(request)}`, 10)) return storageErrorResponse(new StorageError('rate_limited'))
  const c = resolveOwnerDatabase(request)
  if (!c.ok) return c.res
  let body: { action?: unknown; id?: unknown; name?: unknown }
  try {
    const text = await request.text()
    if (text.length > 1024) return NextResponse.json({ error: 'Request too large' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }
  const conn = c.ctx.connection
  const tokenFor = (workspaceId: string) => sealBuilderToken({ conn: conn.normalized, workspaceId })
  try {
    await ensureSchema(await getPool(conn))
    if (body.action === 'create') {
      const name = normalizeProjectName(body.name)
      if (!name) return NextResponse.json({ error: 'Give the project a name, such as the site it is for.' }, { status: 400 })
      const created = await createProject(conn, name)
      console.log(`project created ${c.ctx.label} named=${created.named}`)
      return NextResponse.json({ token: tokenFor(created.id), id: created.id, ...(created.named ? {} : { warning: NAMES_UNAVAILABLE }) })
    }
    if (body.action === 'switch') {
      if (!isProjectId(body.id) || !(await openProject(conn, body.id))) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      return NextResponse.json({ token: tokenFor(body.id), id: body.id })
    }
    if (body.action === 'rename') {
      const name = normalizeProjectName(body.name)
      if (!isProjectId(body.id) || !name) return NextResponse.json({ error: 'A project and a name are needed.' }, { status: 400 })
      const { projects } = await listProjects(conn, c.ctx.workspaceId)
      if (!projects.some((p) => p.id === body.id)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
      if (!(await renameProject(conn, body.id, name))) return NextResponse.json({ error: NAMES_UNAVAILABLE, code: 'insufficient_privilege' }, { status: 422 })
      return NextResponse.json({ id: body.id, name })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e) {
    console.error(`projects ${String(body.action)} failed ${c.ctx.label} ${safeErrorSummary(e)}`)
    return storageErrorResponse(mapDriverError(e))
  }
}
