import { describe, expect, it } from 'vitest'

import { reviewDimensions } from '../use-draft-actions'

const text = (zh: string, en: string) => {
  void en
  return zh
}

describe('章节审稿维度', () => {
  it('为中文作品提供中文校对，并保留其他审稿维度', () => {
    const dimensions = reviewDimensions(text, 'zh-CN')
    expect(dimensions.map(dimension => dimension.key)).toEqual([
      'continuity',
      'logic',
      'character',
      'foreshadow',
      'chinese-proofreading',
    ])
    expect(dimensions.at(-1)).toMatchObject({
      label: '中文校对',
      desc: '错别字、标点、语病和明显搭配错误',
      promptLabel: '中文校对',
    })
  })

  it('不为英文作品显示中文校对', () => {
    expect(reviewDimensions(text, 'en-US').some(dimension => dimension.key === 'chinese-proofreading')).toBe(false)
  })
})
