import type Database from 'better-sqlite3'
import type { MigrationImplementation, SchemaReader } from './registry'

export const M08_DRAFT_SNAPSHOT_SQL = `
CREATE TABLE draft_snapshots (
  snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER NOT NULL,
  chapter_number INTEGER NOT NULL CHECK(chapter_number > 0),
  source TEXT NOT NULL DEFAULT 'save' CHECK(source IN ('create', 'save')),
  word_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);
CREATE INDEX idx_draft_snapshots_draft ON draft_snapshots(draft_id, snapshot_id DESC);
`

export function applyM08DraftSnapshots(db: Database.Database): void {
  if (!db.inTransaction) throw new Error('DRAFT_SNAPSHOT_MIGRATION_TRANSACTION_REQUIRED')
  db.exec(M08_DRAFT_SNAPSHOT_SQL)
}

export function verifyM08DraftSnapshots(db: Database.Database): boolean {
  try {
    if (db.pragma('foreign_keys', { simple: true }) !== 1 || (db.pragma('foreign_key_check') as unknown[]).length) return false
    const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='draft_snapshots'").get() as { sql?: string } | undefined
    if (!table?.sql || !table.sql.includes('snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT')
      || !table.sql.includes('ON DELETE CASCADE')) return false
    const rows = db.prepare('SELECT snapshot_id, draft_id, chapter_number, word_count, content_hash FROM draft_snapshots').all() as Array<{
      snapshot_id: number; draft_id: number; chapter_number: number; word_count: number; content_hash: string
    }>
    return rows.every(row => Number.isSafeInteger(row.snapshot_id) && row.snapshot_id > 0
      && Number.isSafeInteger(row.draft_id) && row.draft_id > 0
      && Number.isSafeInteger(row.chapter_number) && row.chapter_number > 0
      && Number.isSafeInteger(row.word_count) && row.word_count >= 0
      && /^[a-f0-9]{64}$/u.test(row.content_hash))
  } catch { return false }
}

export function createM08Migration(deps: {
  database(reader: SchemaReader): Database.Database
  verifyKnownSchema(reader: SchemaReader): boolean
}): MigrationImplementation {
  return { id: 'M08', from: 8, to: 9, owner: 'S04',
    migrate: reader => applyM08DraftSnapshots(deps.database(reader)),
    verify: reader => deps.verifyKnownSchema(reader) && verifyM08DraftSnapshots(deps.database(reader)) }
}
