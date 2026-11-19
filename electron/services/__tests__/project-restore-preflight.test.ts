import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  PROJECT_STORAGE_PATH_UNSUPPORTED,
  assertNativeStoragePathsSupported,
  assertProjectStoragePathSupported,
} from '../project-storage-preflight'

/** 归档叶子中被应用自身判定为最长的相对路径（avatars 的 hash 目录 + 定长文件名）。 */
const LONGEST_PROJECT_LEAF = path.win32.join(
  '.ai-novel',
  'avatars',
  '0'.repeat(64),
  `${'0'.repeat(20)}-${'0'.repeat(64)}.jpeg`,
)

describe('project storage path preflight', () => {
  it('accepts a project root that leaves room for the longest derived leaf', () => {
    const root = path.win32.join('D:\\Novels', 'a'.repeat(20))

    expect(() => assertProjectStoragePathSupported(root, { platform: 'win32' })).not.toThrow()
  })

  it('rejects a project root whose derived leaf would exceed the Windows native limit', () => {
    const root = path.win32.join('D:\\Novels', 'a'.repeat(120))

    expect(() => assertProjectStoragePathSupported(root, { platform: 'win32' }))
      .toThrow(expect.objectContaining({ code: PROJECT_STORAGE_PATH_UNSUPPORTED }))
  })

  it('checks the paths it is actually given instead of a fixed worst-case model', () => {
    const root = path.win32.join('D:\\Novels', 'a'.repeat(120))
    const shortestLeaf = path.win32.join('.ai-novel', 'project.db-wal')

    // 同一个根目录：按定长最坏叶子会被拒，按真实短叶子则放行 —— 这正是临时目录该用的判据。
    expect(() => assertProjectStoragePathSupported(root, { platform: 'win32' })).toThrow()
    expect(() => assertNativeStoragePathsSupported(root, [shortestLeaf], { platform: 'win32' })).not.toThrow()
  })

  it('is a no-op outside Windows', () => {
    const root = path.posix.join('/', 'x'.repeat(400))

    expect(() => assertProjectStoragePathSupported(root, { platform: 'darwin' })).not.toThrow()
    expect(() => assertProjectStoragePathSupported(root, { platform: 'linux' })).not.toThrow()
  })

  it('keeps the user-visible budget consistent with the longest leaf', () => {
    // 259 上限 = 根长 + 1 + 叶子长。这里固定「85」这个用户可见数字，
    // 避免哪天叶子变长后提示文案悄悄失真。
    expect(LONGEST_PROJECT_LEAF.length).toBe(173)
    expect(259 - 1 - LONGEST_PROJECT_LEAF.length).toBe(85)
  })
})
