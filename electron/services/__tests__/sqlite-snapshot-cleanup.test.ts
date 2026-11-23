import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SQLITE_SNAPSHOT_OWNER,
  cleanupStaleProjectSqliteSnapshots,
} from '../sqlite-snapshot-cleanup'

const roots: string[] = []

function fixture(): string {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sqlite-snapshots-'))
  roots.push(root)
  return root
}

function snapshot(root: string, name: string, owner = SQLITE_SNAPSHOT_OWNER, ageMs = 0): string {
  const candidate = path.join(root, name)
  fs.mkdirSync(candidate, { recursive: true })
  fs.writeFileSync(path.join(candidate, '.vibe-owner.json'), JSON.stringify({
    owner,
    createdAt: new Date(Date.now() - ageMs).toISOString(),
  }))
  fs.writeFileSync(path.join(candidate, 'snapshot.db'), 'sqlite')
  return candidate
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('cleanupStaleProjectSqliteSnapshots', () => {
  it('removes stale application snapshots and retains fresh ones', () => {
    const root = fixture()
    const stale = snapshot(root, 'sqlite-read-stale', SQLITE_SNAPSHOT_OWNER, 25 * 60 * 60 * 1000)
    const fresh = snapshot(root, 'sqlite-read-fresh', SQLITE_SNAPSHOT_OWNER)
    const unknown = snapshot(root, 'sqlite-read-other', 'Another Tool', 48 * 60 * 60 * 1000)

    expect(cleanupStaleProjectSqliteSnapshots({ root, ttlMs: 24 * 60 * 60 * 1000 })).toBe(1)
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
    expect(fs.existsSync(unknown)).toBe(true)
  })

  it('never follows symlinked or missing-marker directories', () => {
    const root = fixture()
    const target = path.join(root, 'target')
    fs.mkdirSync(target)
    fs.writeFileSync(path.join(target, 'important.txt'), 'keep')
    let symlinked: string | undefined
    try {
      symlinked = path.join(root, 'sqlite-read-link')
      fs.symlinkSync(target, symlinked, 'junction')
    } catch {
      symlinked = undefined
    }
    const noMarker = path.join(root, 'sqlite-read-no-marker')
    fs.mkdirSync(noMarker)
    fs.writeFileSync(path.join(noMarker, 'snapshot.db'), 'keep')

    expect(cleanupStaleProjectSqliteSnapshots({ root, ttlMs: 0 })).toBe(0)
    expect(fs.existsSync(target)).toBe(true)
    if (symlinked) expect(fs.existsSync(symlinked)).toBe(true)
    expect(fs.existsSync(noMarker)).toBe(true)
  })

  it('returns zero when the root is absent or invalid', () => {
    const missing = path.join(fixture(), 'missing')
    const file = path.join(fixture(), 'file')
    fs.writeFileSync(file, 'not-directory')
    expect(cleanupStaleProjectSqliteSnapshots({ root: missing })).toBe(0)
    expect(cleanupStaleProjectSqliteSnapshots({ root: file })).toBe(0)
  })
})
