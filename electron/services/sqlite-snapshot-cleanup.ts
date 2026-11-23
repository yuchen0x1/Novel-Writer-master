import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const SQLITE_SNAPSHOT_OWNER = 'AI-Novel-Writer SQLite snapshot'
export const SQLITE_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000

export function sqliteSnapshotRoot(): string {
  return path.join(
    fs.realpathSync(process.env.LOCALAPPDATA || os.tmpdir()),
    'VibeCodingScratch',
    'ai-novel-writer',
  )
}

function isRegularFile(file: string): boolean {
  try {
    const info = fs.lstatSync(file)
    return info.isFile() && !info.isSymbolicLink() && info.nlink === 1
  } catch {
    return false
  }
}

/** Remove only abandoned snapshots created by this application. */
export function cleanupStaleProjectSqliteSnapshots(options: {
  now?: number
  root?: string
  ttlMs?: number
} = {}): number {
  let root: string
  try { root = path.resolve(options.root ?? sqliteSnapshotRoot()) } catch { return 0 }
  const ttlMs = options.ttlMs ?? SQLITE_SNAPSHOT_TTL_MS
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 0

  let rootInfo: fs.Stats
  try { rootInfo = fs.lstatSync(root) } catch { return 0 }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return 0

  const now = options.now ?? Date.now()
  let removed = 0
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !entry.name.startsWith('sqlite-read-')) continue
    const candidate = path.join(root, entry.name)
    const relative = path.relative(root, candidate)
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue
    const marker = path.join(candidate, '.vibe-owner.json')
    if (!isRegularFile(marker)) continue

    let metadata: { owner?: unknown; createdAt?: unknown }
    try {
      metadata = JSON.parse(fs.readFileSync(marker, 'utf8')) as typeof metadata
    } catch {
      continue
    }
    if (metadata.owner !== SQLITE_SNAPSHOT_OWNER || typeof metadata.createdAt !== 'string') continue
    const createdAt = Date.parse(metadata.createdAt)
    if (!Number.isFinite(createdAt) || now - createdAt < ttlMs) continue
    try {
      fs.rmSync(candidate, { recursive: true, force: false })
      removed += 1
    } catch {
      // A concurrent reader or restrictive filesystem must not block startup.
    }
  }
  return removed
}
