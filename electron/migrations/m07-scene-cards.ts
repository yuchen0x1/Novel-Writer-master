import type Database from 'better-sqlite3'
import type { MigrationImplementation, SchemaReader } from './registry'

export const M07_SCENE_CARD_SQL = `
CREATE TABLE scene_cards (
  scene_id TEXT PRIMARY KEY,
  chapter_number INTEGER NOT NULL CHECK(chapter_number > 0),
  scene_order INTEGER NOT NULL CHECK(scene_order > 0),
  title TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  story_time TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '[]',
  goal TEXT NOT NULL DEFAULT '',
  conflict TEXT NOT NULL DEFAULT '',
  transition TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(chapter_number, scene_order)
);
CREATE INDEX idx_scene_cards_chapter_order ON scene_cards(chapter_number, scene_order);
`

export function applyM07SceneCards(db: Database.Database): void {
  if (!db.inTransaction) throw new Error('SCENE_CARD_MIGRATION_TRANSACTION_REQUIRED')
  db.exec(M07_SCENE_CARD_SQL)
}

export function verifyM07SceneCards(db: Database.Database): boolean {
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || (db.pragma('foreign_key_check') as unknown[]).length) return false
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='scene_cards'").get() as { sql?: string } | undefined
    if (!table?.sql || !table.sql.includes('scene_id TEXT PRIMARY KEY') || !table.sql.includes('UNIQUE(chapter_number, scene_order)')) return false
    const rows = db.prepare('SELECT scene_id, chapter_number, scene_order, participants FROM scene_cards').all() as Array<{ scene_id: string; chapter_number: number; scene_order: number; participants: string }>
    return rows.every(row => row.scene_id.length > 0 && Number.isSafeInteger(row.chapter_number) && row.chapter_number > 0
      && Number.isSafeInteger(row.scene_order) && row.scene_order > 0 && Array.isArray(JSON.parse(row.participants)))
  } catch { return false }
}

export function createM07Migration(deps: {
  database(reader: SchemaReader): Database.Database
  verifyKnownSchema(reader: SchemaReader): boolean
}): MigrationImplementation {
  return { id: 'M07', from: 7, to: 8, owner: 'S04',
    migrate: reader => applyM07SceneCards(deps.database(reader)),
    verify: reader => deps.verifyKnownSchema(reader) && verifyM07SceneCards(deps.database(reader)) }
}
