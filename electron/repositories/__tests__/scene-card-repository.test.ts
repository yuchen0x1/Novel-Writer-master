import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import type BetterSqlite3 from 'better-sqlite3'

import { getProjectDb } from '../../database'
import { SceneCardRepository } from '../scene-card-repository'

vi.mock('../../database', () => ({ getProjectDb: vi.fn() }))
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as typeof import('better-sqlite3')
const getDb = vi.mocked(getProjectDb)

function createDb(): BetterSqlite3.Database {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE scene_cards (
    scene_id TEXT PRIMARY KEY, chapter_number INTEGER NOT NULL, scene_order INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '', story_time TEXT NOT NULL DEFAULT '',
    participants TEXT NOT NULL DEFAULT '[]', goal TEXT NOT NULL DEFAULT '', conflict TEXT NOT NULL DEFAULT '',
    transition TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT '', updated_at TEXT DEFAULT '',
    UNIQUE(chapter_number, scene_order)
  )`)
  return db
}

describe('SceneCardRepository', () => {
  let db: BetterSqlite3.Database
  beforeEach(() => { db = createDb(); getDb.mockReturnValue(db as ReturnType<typeof getProjectDb>) })
  afterEach(() => { if (db) db.close() })

  it('writes normalized scene facts and lists them by chapter order', () => {
    SceneCardRepository.upsert({ id: 'scene-2', chapterNumber: 1, order: 2, title: '夜谈', location: '', storyTime: '', participants: ['甲', '甲'], goal: '', conflict: '', transition: '', notes: '' })
    SceneCardRepository.upsert({ id: 'scene-1', chapterNumber: 1, order: 1, title: '开场', location: '', storyTime: '', participants: [], goal: '', conflict: '', transition: '', notes: '' })
    expect(SceneCardRepository.getByChapter(1).map(scene => scene.id)).toEqual(['scene-1', 'scene-2'])
    expect(SceneCardRepository.getByChapter(1)[1].participants).toEqual(['甲'])
  })

  it('updates by stable id and removes by chapter', () => {
    SceneCardRepository.upsert({ id: 'scene-1', chapterNumber: 2, order: 1, title: '旧标题', location: '', storyTime: '', participants: [], goal: '', conflict: '', transition: '', notes: '' })
    expect(SceneCardRepository.upsert({ id: 'scene-1', chapterNumber: 2, order: 1, title: '新标题', location: '', storyTime: '', participants: [], goal: '', conflict: '', transition: '', notes: '' }).title).toBe('新标题')
    SceneCardRepository.deleteByChapter(2)
    expect(SceneCardRepository.getAll()).toEqual([])
  })
})
