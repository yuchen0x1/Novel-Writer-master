export const SCENE_DOCUMENT_VERSION = 1 as const
export const SCENE_MAX_COUNT = 2000
export const SCENE_MAX_TEXT = 2000
export const SCENE_MAX_TITLE = 120
export const SCENE_MAX_PARTICIPANTS = 30

export interface SceneCard {
  id: string
  chapterNumber: number
  order: number
  title: string
  location: string
  storyTime: string
  participants: string[]
  goal: string
  conflict: string
  transition: string
  notes: string
}

export interface SceneDocument {
  version: typeof SCENE_DOCUMENT_VERSION
  scenes: SceneCard[]
}

export const EMPTY_SCENE_DOCUMENT: SceneDocument = Object.freeze({ version: SCENE_DOCUMENT_VERSION, scenes: [] })

const text = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : ''
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

function parseParticipants(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(item => text(item, 80)).filter(Boolean))].slice(0, SCENE_MAX_PARTICIPANTS)
}

export function parseSceneDocument(raw: unknown): SceneDocument {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_SCENE_DOCUMENT, scenes: [] }
  const source = raw as { scenes?: unknown }
  if (!Array.isArray(source.scenes)) return { ...EMPTY_SCENE_DOCUMENT, scenes: [] }
  const scenes: SceneCard[] = []
  const seen = new Set<string>()
  for (const item of source.scenes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const value = item as Partial<SceneCard>
    const id = text(value.id, 80)
    const title = text(value.title, SCENE_MAX_TITLE)
    if (!id || seen.has(id) || !positiveInteger(value.chapterNumber) || !title) continue
    seen.add(id)
    scenes.push({
      id,
      chapterNumber: value.chapterNumber,
      order: positiveInteger(value.order) ? value.order : scenes.length + 1,
      title,
      location: text(value.location, SCENE_MAX_TEXT),
      storyTime: text(value.storyTime, 120),
      participants: parseParticipants(value.participants),
      goal: text(value.goal, SCENE_MAX_TEXT),
      conflict: text(value.conflict, SCENE_MAX_TEXT),
      transition: text(value.transition, SCENE_MAX_TEXT),
      notes: text(value.notes, SCENE_MAX_TEXT),
    })
    if (scenes.length >= SCENE_MAX_COUNT) break
  }
  scenes.sort((left, right) => left.chapterNumber - right.chapterNumber || left.order - right.order || left.id.localeCompare(right.id))
  return { version: SCENE_DOCUMENT_VERSION, scenes }
}

export function scenesForChapter(document: SceneDocument, chapterNumber: number): SceneCard[] {
  return document.scenes.filter(scene => scene.chapterNumber === chapterNumber).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
}

export function nextSceneId(existing: readonly SceneCard[]): string {
  const used = new Set(existing.map(scene => scene.id))
  for (let index = 1; index <= SCENE_MAX_COUNT + 1; index += 1) {
    const candidate = `scene-${index}`
    if (!used.has(candidate)) return candidate
  }
  return `scene-${Date.now()}`
}
