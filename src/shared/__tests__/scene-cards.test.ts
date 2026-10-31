import { describe, expect, it } from 'vitest'
import { nextSceneId, parseSceneDocument, scenesForChapter } from '../scene-cards'

describe('scene card contract', () => {
  it('normalizes chapter relations, order and participant names', () => {
    const document = parseSceneDocument({ scenes: [
      { id: 'scene-2', chapterNumber: 2, order: 2, title: '夜谈', participants: ['甲', '甲', '乙'] },
      { id: 'scene-1', chapterNumber: 1, order: 1, title: '开场', participants: ['甲'] },
      { id: 'duplicate', chapterNumber: 1, order: 3, title: '保留' },
      { id: 'duplicate', chapterNumber: 2, order: 1, title: '丢弃' },
    ] })
    expect(scenesForChapter(document, 1).map(scene => scene.title)).toEqual(['开场', '保留'])
    expect(document.scenes[0].participants).toEqual(['甲'])
    expect(document.scenes[2].participants).toEqual(['甲', '乙'])
    expect(document.version).toBe(1)
  })

  it('drops malformed records without making the document unusable', () => {
    const document = parseSceneDocument({ scenes: [null, { id: '', chapterNumber: 1, title: '无 id' }, { id: 'ok', chapterNumber: 0, title: '无章节' }] })
    expect(document.scenes).toEqual([])
  })

  it('creates a stable unused local id', () => {
    expect(nextSceneId([{ id: 'scene-1' } as never, { id: 'other' } as never])).toBe('scene-2')
  })
})
