import { describe, expect, it } from 'vitest'

import { parseArchitectureCharacterRoster, parseModelCharacterCards } from '../character-roster-parser'

/** 完整的两人结构化名单：作为「健康输出」的对照基准。 */
const completeRoster = JSON.stringify({
  characters: [
    { name: '林晓薇', role: 'protagonist', personality: '克制' },
    { name: 'Ethan', role: 'antagonist', personality: '强势' },
  ],
})

describe('character roster parser fails closed on damaged structured output', () => {
  it('reads a complete structured roster', () => {
    const result = parseArchitectureCharacterRoster(completeRoster)

    expect(result.cards.map(card => card.name)).toEqual(['林晓薇', 'Ethan'])
    expect(result.issues).toEqual([])
    expect(result.complete).toBe(true)
  })

  it.each([
    ['truncated array', '{"characters":[{"name":"林晓薇","role":"protagonist"},{"name":"Ethan","role":"antagonist"},'],
    ['truncated mid object', '{"characters":[{"name":"林晓薇","role":"protagonist"},{"name":"Ethan"'],
    ['trailing comma in array', '{"characters":[{"name":"林晓薇"},{"name":"Ethan"},]}'],
  ])('does not report a single surviving character as a complete roster (%s)', (_label, text) => {
    const result = parseArchitectureCharacterRoster(text)

    // 关键不变量：残缺输出绝不能被当成权威名单，否则整份配角表会被静默截断落库。
    expect(result.complete).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('accepts a complete roster wrapped in surrounding prose', () => {
    const result = parseArchitectureCharacterRoster(`好的，下面是角色名单：\n${completeRoster}\n以上。`)

    expect(result.cards).toHaveLength(2)
    expect(result.complete).toBe(true)
  })

  it('ignores an unbalanced quote in the prose preamble', () => {
    const result = parseArchitectureCharacterRoster(`他说「这是"最终版\n${completeRoster}`)

    expect(result.cards).toHaveLength(2)
    expect(result.complete).toBe(true)
  })

  it('keeps the nested fragment out of the loose model-card reader as well', () => {
    const cards = parseModelCharacterCards('{"characters":[{"name":"林晓薇"},{"name":"Ethan"},')

    expect(cards).toEqual([])
  })
})
