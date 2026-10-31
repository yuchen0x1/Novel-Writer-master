import { getProjectDb } from '../database'
import type { SceneCard } from '../../src/shared/scene-cards'
import { parseSceneDocument } from '../../src/shared/scene-cards'

export interface SceneCardRow {
  scene_id: string
  chapter_number: number
  scene_order: number
  title: string
  location: string
  story_time: string
  participants: string
  goal: string
  conflict: string
  transition: string
  notes: string
  created_at: string
  updated_at: string
}

function database(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('PROJECT_NOT_OPEN')
  return db
}

function participants(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function rowToScene(row: SceneCardRow): SceneCard {
  return {
    id: row.scene_id,
    chapterNumber: row.chapter_number,
    order: row.scene_order,
    title: row.title,
    location: row.location,
    storyTime: row.story_time,
    participants: participants(row.participants),
    goal: row.goal,
    conflict: row.conflict,
    transition: row.transition,
    notes: row.notes,
  }
}

export const SceneCardRepository = {
  getAll(): SceneCard[] {
    const rows = database().prepare('SELECT * FROM scene_cards ORDER BY chapter_number, scene_order, scene_id').all() as SceneCardRow[]
    return rows.map(rowToScene)
  },

  getByChapter(chapterNumber: number): SceneCard[] {
    const rows = database().prepare('SELECT * FROM scene_cards WHERE chapter_number = ? ORDER BY scene_order, scene_id').all(chapterNumber) as SceneCardRow[]
    return rows.map(rowToScene)
  },

  upsert(data: SceneCard): SceneCard {
    const normalized = parseSceneDocument({ scenes: [data] }).scenes[0]
    if (!normalized) throw new Error('SCENE_CARD_INVALID')
    const db = database()
    db.prepare(`
      INSERT INTO scene_cards (scene_id, chapter_number, scene_order, title, location, story_time, participants, goal, conflict, transition, notes)
      VALUES (@id, @chapterNumber, @order, @title, @location, @storyTime, @participants, @goal, @conflict, @transition, @notes)
      ON CONFLICT(scene_id) DO UPDATE SET
        chapter_number = excluded.chapter_number, scene_order = excluded.scene_order, title = excluded.title,
        location = excluded.location, story_time = excluded.story_time, participants = excluded.participants,
        goal = excluded.goal, conflict = excluded.conflict, transition = excluded.transition, notes = excluded.notes,
        updated_at = datetime('now')
    `).run({ ...normalized, participants: JSON.stringify(normalized.participants) })
    const row = db.prepare('SELECT * FROM scene_cards WHERE scene_id = ?').get(normalized.id) as SceneCardRow | undefined
    if (!row) throw new Error('SCENE_CARD_WRITEBACK_MISSING')
    return rowToScene(row)
  },

  delete(id: string): void {
    database().prepare('DELETE FROM scene_cards WHERE scene_id = ?').run(id)
  },

  deleteByChapter(chapterNumber: number): void {
    database().prepare('DELETE FROM scene_cards WHERE chapter_number = ?').run(chapterNumber)
  },

  clearAll(): void {
    database().prepare('DELETE FROM scene_cards').run()
  },
}
