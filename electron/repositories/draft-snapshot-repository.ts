import { createHash } from 'node:crypto'
import { getProjectDb } from '../database'
import { DRAFT_SNAPSHOT_KEEP, type DraftSnapshotMeta, type DraftSnapshotSource } from '../../src/shared/draft-snapshot'

interface SnapshotRow {
  snapshot_id: number
  draft_id: number
  chapter_number: number
  source: DraftSnapshotSource
  word_count: number
  content_hash: string
  created_at: string
}

function database(): NonNullable<ReturnType<typeof getProjectDb>> {
  const db = getProjectDb()
  if (!db) throw new Error('PROJECT_NOT_OPEN')
  return db
}

function toMeta(row: SnapshotRow): DraftSnapshotMeta {
  return {
    snapshotId: row.snapshot_id,
    draftId: row.draft_id,
    chapterNumber: row.chapter_number,
    source: row.source,
    wordCount: row.word_count,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  }
}

/**
 * 草稿自动快照。记录是保存链路里的尽力而为步骤：正文已经落盘后快照失败只告警，
 * 不把一次成功的保存翻成失败。内容与上一份相同时跳过，每稿只留最近 KEEP 份。
 */
export const DraftSnapshotRepository = {
  record(params: { draftId: number; chapterNumber: number; source: DraftSnapshotSource; content: string; wordCount: number }): void {
    if (params.content.length === 0) return
    const db = database()
    const contentHash = createHash('sha256').update(params.content, 'utf8').digest('hex')
    const latest = db.prepare('SELECT content_hash FROM draft_snapshots WHERE draft_id = ? ORDER BY snapshot_id DESC LIMIT 1')
      .get(params.draftId) as { content_hash: string } | undefined
    if (latest?.content_hash === contentHash) return
    db.prepare(`
      INSERT INTO draft_snapshots (draft_id, chapter_number, source, word_count, content_hash, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(params.draftId, params.chapterNumber, params.source, params.wordCount, contentHash, params.content)
    db.prepare(`
      DELETE FROM draft_snapshots WHERE draft_id = ? AND snapshot_id NOT IN (
        SELECT snapshot_id FROM draft_snapshots WHERE draft_id = ? ORDER BY snapshot_id DESC LIMIT ?
      )
    `).run(params.draftId, params.draftId, DRAFT_SNAPSHOT_KEEP)
  },

  listByDraft(draftId: number, limit: number): DraftSnapshotMeta[] {
    const rows = database().prepare(`
      SELECT snapshot_id, draft_id, chapter_number, source, word_count, content_hash, created_at
      FROM draft_snapshots WHERE draft_id = ? ORDER BY snapshot_id DESC LIMIT ?
    `).all(draftId, limit) as SnapshotRow[]
    return rows.map(toMeta)
  },

  get(snapshotId: number): (DraftSnapshotMeta & { content: string }) | null {
    const row = database().prepare(`
      SELECT snapshot_id, draft_id, chapter_number, source, word_count, content_hash, created_at, content
      FROM draft_snapshots WHERE snapshot_id = ?
    `).get(snapshotId) as (SnapshotRow & { content: string }) | undefined
    return row ? { ...toMeta(row), content: row.content } : null
  },
}
