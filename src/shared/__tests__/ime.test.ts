import { describe, expect, it } from 'vitest'

import { isImeComposing, submitsOnEnter } from '../ime'

describe('输入法组字判定', () => {
  it('把普通键盘事件当作非组字', () => {
    expect(isImeComposing({ key: 'Enter', keyCode: 13 })).toBe(false)
    expect(isImeComposing({ keyCode: 13 })).toBe(false)
  })

  it('识别 isComposing 与历史 keyCode 229 两条组字路径', () => {
    expect(isImeComposing({ isComposing: true, keyCode: 13 })).toBe(true)
    expect(isImeComposing({ isComposing: false, keyCode: 229 })).toBe(true)
    // Safari/部分输入法只给 229，isComposing 仍是 false。
    expect(isImeComposing({ keyCode: 229 })).toBe(true)
  })
})

describe('回车提交判定', () => {
  it('裸回车提交', () => {
    expect(submitsOnEnter({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 })).toBe(true)
  })

  it('Shift+Enter 只换行', () => {
    expect(submitsOnEnter({ key: 'Enter', shiftKey: true, keyCode: 13 })).toBe(false)
  })

  it('组字中的回车属于输入法，不提交', () => {
    expect(submitsOnEnter({ key: 'Enter', shiftKey: false, isComposing: true, keyCode: 13 })).toBe(false)
    expect(submitsOnEnter({ key: 'Enter', shiftKey: false, keyCode: 229 })).toBe(false)
  })

  it('其它按键不提交', () => {
    expect(submitsOnEnter({ key: 'a', keyCode: 65 })).toBe(false)
    expect(submitsOnEnter({ key: 'Escape', keyCode: 27 })).toBe(false)
  })
})
