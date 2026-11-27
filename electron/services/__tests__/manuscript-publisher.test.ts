import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { publishManuscript, resolveManuscriptTarget, serializeManuscript } from '../manuscript-publisher'

const roots: string[] = []

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-manuscript-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('manuscript publisher target seam', () => {
  it('turns dangerous Windows titles into a non-empty direct-child target inside the trusted manuscript boundary', () => {
    const projectRoot = makeRoot()
    const target = resolveManuscriptTarget({
      projectRoot,
      chapterNumber: 1,
      chapterTitle: ' CON<>:"/\\|?* . ',
      finalizationId: 'finalization-1',
    })

    expect(path.dirname(target.absolutePath)).toBe(projectRoot)
    expect(target.fileName).toMatch(/^第1章 /)
    expect(target.fileName).not.toMatch(/[<>:"/\\|?*]/)
    expect(target.fileName).not.toMatch(/[. ]\.txt$/)
    expect(target.fileName).not.toContain(' CON.')
  })

  it('uses a stable fallback for an empty title and never overwrites a collision', () => {
    const projectRoot = makeRoot()
    const first = resolveManuscriptTarget({
      projectRoot,
      chapterNumber: 2,
      chapterTitle: '   ',
      finalizationId: 'finalization-1',
    })
    fs.writeFileSync(first.absolutePath, 'pre-existing user manuscript', 'utf8')

    const second = resolveManuscriptTarget({
      projectRoot,
      chapterNumber: 2,
      chapterTitle: '   ',
      finalizationId: 'finalization-2',
    })

    expect(first.fileName).toBe('第2章.txt')
    expect(second.absolutePath).not.toBe(first.absolutePath)
    expect(fs.readFileSync(first.absolutePath, 'utf8')).toBe('pre-existing user manuscript')
  })

  it('refuses to overwrite a frozen target edited outside the app and reports a stable code (#474)', async () => {
    const projectRoot = makeRoot()
    fs.writeFileSync(path.join(projectRoot, '第3章 雨夜.txt'), '作者在应用外改过的正文', 'utf8')
    await expect(publishManuscript({ projectRoot, targetFileName: '第3章 雨夜.txt', chapterNumber: 3, chapterTitle: '雨夜', content: '定稿正文' }))
      .rejects.toThrow(/^MANUSCRIPT_TARGET_CONFLICT$/u)
    await expect(publishManuscript({ projectRoot, targetFileName: '../escape.txt', chapterNumber: 3, chapterTitle: '雨夜', content: '定稿正文' }))
      .rejects.toThrow(/^MANUSCRIPT_STORED_TARGET_INVALID$/u)
    expect(fs.readFileSync(path.join(projectRoot, '第3章 雨夜.txt'), 'utf8')).toBe('作者在应用外改过的正文')
  })

  it('preserves a manuscript created after the initial target check', async () => {
    const projectRoot = makeRoot()
    const targetFileName = '第4章 夜航.txt'
    const target = path.join(projectRoot, targetFileName)
    const originalLink = fs.linkSync.bind(fs)
    const link = vi.spyOn(fs, 'linkSync').mockImplementation((source, destination) => {
      fs.writeFileSync(target, 'external edit won the race', { flag: 'wx' })
      originalLink(source, destination)
    })
    try {
      await expect(publishManuscript({ projectRoot, targetFileName, chapterNumber: 4,
        chapterTitle: '夜航', content: 'finalized draft' })).rejects.toThrow('MANUSCRIPT_TARGET_CONFLICT')
      expect(fs.readFileSync(target, 'utf8')).toBe('external edit won the race')
      expect(fs.readdirSync(projectRoot)).toEqual([targetFileName])
    } finally { link.mockRestore() }
  })

  it('keeps publication idempotent when another publisher installs identical content first', async () => {
    const projectRoot = makeRoot()
    const input = { projectRoot, targetFileName: '第5章 晨光.txt', chapterNumber: 5,
      chapterTitle: '晨光', content: 'finalized draft' }
    const originalLink = fs.linkSync.bind(fs)
    const link = vi.spyOn(fs, 'linkSync').mockImplementation((source, destination) => {
      fs.writeFileSync(destination, serializeManuscript(input), { flag: 'wx' })
      originalLink(source, destination)
    })
    try {
      await expect(publishManuscript(input)).resolves.toBeUndefined()
      expect(fs.readFileSync(path.join(projectRoot, input.targetFileName), 'utf8')).toBe(serializeManuscript(input))
      expect(fs.readdirSync(projectRoot)).toEqual([input.targetFileName])
    } finally { link.mockRestore() }
  })
})
