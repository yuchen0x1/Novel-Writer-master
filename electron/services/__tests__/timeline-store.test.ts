import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../project-data-locator', () => ({
  getProjectDataRoot: (projectPath: string) => path.join(projectPath, '.vela'),
}))

import { readTimeline, timelineFilePath, writeTimeline } from '../timeline-store'

const roots: string[] = []
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-store-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('时间线落盘', () => {
  it('写入后能原样读回，并把数据放在作品目录的 .vela/timeline.json', async () => {
    const root = project()
    const saved = await writeTimeline(root, {
      lanes: ['主线'],
      events: [{ id: 'e1', lane: '主线', at: '第 1 天', title: '起航', chapterNumber: 1 }],
    })

    expect(timelineFilePath(root)).toBe(path.join(root, '.vela', 'timeline.json'))
    expect(fs.existsSync(timelineFilePath(root))).toBe(true)
    expect(saved.events).toHaveLength(1)
    expect(readTimeline(root)).toEqual(saved)
  })

  it('读到损坏的 JSON 时退回空时间线', async () => {
    const root = project()
    fs.mkdirSync(path.join(root, '.vela'), { recursive: true })
    fs.writeFileSync(timelineFilePath(root), '{ not json', 'utf8')

    expect(readTimeline(root)).toEqual({ version: 1, lanes: [], events: [] })
  })

  it('写入前先归一化：非法条目被丢弃', async () => {
    const root = project()
    const saved = await writeTimeline(root, {
      lanes: ['主线'],
      events: [
        { id: 'ok', lane: '主线', title: '保留' },
        { id: 'bad', lane: '主线', title: '' },
      ],
    })

    expect(saved.events.map(item => item.id)).toEqual(['ok'])
    expect(JSON.parse(fs.readFileSync(timelineFilePath(root), 'utf8')).events).toHaveLength(1)
  })

  it('不留下临时文件', async () => {
    const root = project()
    await writeTimeline(root, { lanes: [], events: [] })
    const leftovers = fs.readdirSync(path.join(root, '.vela')).filter(name => name.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })
})
