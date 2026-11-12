// The builder's form (title, welcome message, colour, position, size and the
// suggested questions) saved in this browser, so a reload does not lose it.
// What comes back from storage is untrusted: every field is checked and
// anything unexpected falls back to the default, so a corrupted or hand-edited
// entry can never break the page.

export const BUILDER_SETTINGS_KEY = 'ai-support-bot:builder-settings'
const MAX_TEXT = 500

export type SavedBuilderSettings = {
  name?: string
  title?: string
  welcome_message?: string
  primary_color?: string
  position?: 'bottom-right' | 'bottom-left'
  size?: 'small' | 'medium' | 'large'
  starterInputs?: string[]
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= MAX_TEXT ? value : undefined
}

export function parseBuilderSettings(raw: string | null): SavedBuilderSettings {
  if (!raw) return {}
  let data: unknown
  try { data = JSON.parse(raw) } catch { return {} }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return {}
  const d = data as Record<string, unknown>
  const out: SavedBuilderSettings = {}
  const name = text(d.name); if (name !== undefined) out.name = name
  const title = text(d.title); if (title !== undefined) out.title = title
  const welcome = text(d.welcome_message); if (welcome !== undefined) out.welcome_message = welcome
  if (typeof d.primary_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(d.primary_color)) out.primary_color = d.primary_color
  if (d.position === 'bottom-right' || d.position === 'bottom-left') out.position = d.position
  if (d.size === 'small' || d.size === 'medium' || d.size === 'large') out.size = d.size
  if (Array.isArray(d.starterInputs)) {
    out.starterInputs = d.starterInputs.slice(0, 4).map(v => (typeof v === 'string' ? v.slice(0, 120) : ''))
  }
  return out
}

// With a project, settings are kept per project, so starting a new project
// (another site) does not begin from the previous one's title and questions.
export function builderSettingsKey(projectId?: string | null): string {
  return projectId ? `${BUILDER_SETTINGS_KEY}:${projectId}` : BUILDER_SETTINGS_KEY
}

/** Saved settings, or null when nothing was saved under that key. */
export function loadBuilderSettings(projectId?: string | null): SavedBuilderSettings | null {
  try {
    const raw = window.localStorage.getItem(builderSettingsKey(projectId))
    return raw === null ? null : parseBuilderSettings(raw)
  } catch {
    return null
  }
}

export function saveBuilderSettings(settings: SavedBuilderSettings, projectId?: string | null): void {
  try { window.localStorage.setItem(builderSettingsKey(projectId), JSON.stringify(settings)) } catch { /* storage full or blocked: settings simply are not kept */ }
}
