import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { closeProjectDatabase, getProjectDb } from '../../database'
import { openCanonicalProjectFixture } from '../../../test/helpers/canonical-project-fixture'
import { DraftRepository } from '../draft-repository'
import { DraftSnapshotRepository } from '../draft-snapshot-repository'
import { removeDirectoryWithWindowsRetry } from '../../utils/remove-directory'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-draft-snapshot-'))
  openCanonicalProjectFixture(root)
})

afterEach(async () => {
  closeProjectDatabase()
  await removeDirectoryWithWindowsRetry(root)
})

describe('DraftSnapshotRepository', () => {
  it('skips empty and consecutive duplicate content, then keeps only the newest 30 snapshots', () => {
    const draftId = DraftRepository.create({ chapterNumber: 1, source: 'write', content: 'initial', wordCount: 7 })

    DraftSnapshotRepository.record({ draftId, chapterNumber: 1, source: 'save', content: '', wordCount: 0 })
    DraftSnapshotRepository.record({ draftId, chapterNumber: 1, source: 'create', content: 'same', wordCount: 4 })
    DraftSnapshotRepository.record({ draftId, chapterNumber: 1, source: 'save', content: 'same', wordCount: 4 })
    expect(DraftSnapshotRepository.listByDraft(draftId, 100)).toHaveLength(1)

    for (let index = 0; index < 31; index += 1) {
      const content = `draft revision ${index}`
      DraftSnapshotRepository.record({ draftId, chapterNumber: 1, source: 'save', content, wordCount: content.length })
    }

    const snapshots = DraftSnapshotRepository.listByDraft(draftId, 100)
    expect(snapshots).toHaveLength(30)
    expect(DraftSnapshotRepository.get(snapshots[0].snapshotId)?.content).toBe('draft revision 30')
    expect(snapshots.some(snapshot => snapshot.contentHash === DraftSnapshotRepository.get(snapshots.at(-1)!.snapshotId)?.contentHash)).toBe(true)
    expect(DraftSnapshotRepository.get(1)).toBeNull()
  })

  it('keeps snapshot data in the project database and preserves earlier drafts when restored as a new draft', () => {
    const originalId = DraftRepository.create({ chapterNumber: 2, source: 'write', content: 'original draft', wordCount: 14 })
    DraftSnapshotRepository.record({ draftId: originalId, chapterNumber: 2, source: 'save', content: 'snapshot body', wordCount: 13 })
    const snapshot = DraftSnapshotRepository.listByDraft(originalId, 10)[0]
    const restoredId = DraftRepository.create({
      chapterNumber: 2, source: 'rewrite', content: DraftSnapshotRepository.get(snapshot.snapshotId)!.content, wordCount: 13,
    })

    expect(DraftRepository.getFull(originalId)?.content).toBe('original draft')
    expect(DraftRepository.getFull(restoredId)?.content).toBe('snapshot body')
    expect(getProjectDb()!.prepare('SELECT COUNT(*) AS count FROM drafts WHERE chapter_number = 2').get()).toMatchObject({ count: 2 })

    const otherProject = path.join(root, 'other-project')
    fs.mkdirSync(otherProject)
    openCanonicalProjectFixture(otherProject)
    expect(DraftSnapshotRepository.listByDraft(originalId, 10)).toEqual([])
    expect(DraftSnapshotRepository.get(snapshot.snapshotId)).toBeNull()
  })
})
