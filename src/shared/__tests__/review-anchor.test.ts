import { describe, expect, it } from 'vitest'

import { locateReviewQuote } from '../review-anchor'

describe('locateReviewQuote', () => {
  it('returns the only matching range', () => {
    expect(locateReviewQuote('雨停了。她推开门。', '她推开门。')).toEqual({ from: 4, to: 9 })
  })

  it('rejects an ambiguous quote without an occurrence', () => {
    expect(locateReviewQuote('她回头。雨停了。她回头。', '她回头。')).toBeNull()
  })

  it('uses an explicit one-based occurrence when supplied', () => {
    expect(locateReviewQuote('她回头。雨停了。她回头。', '她回头。', 2)).toEqual({ from: 8, to: 12 })
  })

  it('rejects a missing or out-of-range quote', () => {
    expect(locateReviewQuote('正文', '不存在')).toBeNull()
    expect(locateReviewQuote('她回头。', '她回头。', 2)).toBeNull()
  })
})
