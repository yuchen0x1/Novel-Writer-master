import { describe, expect, it } from 'vitest'

import {
  addWords,
  currentStreak,
  goalPercent,
  heatLevel,
  heatmapCells,
  localDayKey,
  normalizeGoal,
  parsePersistedGoal,
  pruneLedger,
  shiftDays,
  wordsOn,
  WRITING_GOAL_DEFAULT,
  WRITING_GOAL_MAX,
  WRITING_GOAL_MIN,
} from '../writing-goal'

const day = (iso: string) => new Date(`${iso}T12:00:00`)
const key = (iso: string) => localDayKey(day(iso))

describe('写作账本', () => {
  it('只累计正向增量并按整数取整', () => {
    const first = addWords({}, '2026-10-30', 120.4)
    expect(first).toEqual({ '2026-10-30': 120 })
    expect(addWords(first, '2026-10-30', 30)).toEqual({ '2026-10-30': 150 })
    expect(addWords(first, '2026-10-30', -50)).toBe(first)
    expect(addWords(first, '2026-10-30', 0)).toBe(first)
    expect(addWords(first, '2026-10-30', Number.NaN)).toBe(first)
  })

  it('剪枝只保留最近半年内的有效记录', () => {
    const ledger = { [key('2026-10-30')]: 100, [key('2026-10-29')]: 50, '2025-01-01': 9999, 'bad-key': 10 }
    const pruned = pruneLedger(ledger, day('2026-10-30'))
    expect(Object.keys(pruned).sort()).toEqual([key('2026-10-29'), key('2026-10-30')].sort())
  })

  it('读取当天字数时把脏值当作 0', () => {
    expect(wordsOn({ '2026-10-30': 42 }, '2026-10-30')).toBe(42)
    expect(wordsOn({ '2026-10-30': Number.NaN }, '2026-10-30')).toBe(0)
    expect(wordsOn({}, '2026-10-30')).toBe(0)
  })
})

describe('连续写作天数', () => {
  it('今天与昨天都写了算两天', () => {
    const ledger = { [key('2026-10-30')]: 800, [key('2026-10-29')]: 1200 }
    expect(currentStreak(ledger, day('2026-10-30'))).toBe(2)
  })

  it('今天还没写但昨天写了，记录仍然成立', () => {
    const ledger = { [key('2026-10-29')]: 1200, [key('2026-10-28')]: 900 }
    expect(currentStreak(ledger, day('2026-10-30'))).toBe(2)
  })

  it('中间断一天就归零', () => {
    const ledger = { [key('2026-10-30')]: 800, [key('2026-10-28')]: 1200 }
    expect(currentStreak(ledger, day('2026-10-30'))).toBe(1)
    expect(currentStreak({ [key('2026-10-28')]: 1200 }, day('2026-10-30'))).toBe(0)
  })

  it('跨月与跨年连续', () => {
    const ledger = { [key('2026-01-01')]: 500, [key('2025-12-31')]: 500, [key('2025-12-30')]: 500 }
    expect(currentStreak(ledger, day('2026-01-01'))).toBe(3)
    expect(localDayKey(shiftDays(day('2026-01-01'), -1))).toBe('2025-12-31')
  })
})

describe('目标进度与热力图等级', () => {
  it('进度按百分比取整并夹在 0–100', () => {
    expect(goalPercent(0, 2000)).toBe(0)
    expect(goalPercent(1000, 2000)).toBe(50)
    expect(goalPercent(4000, 2000)).toBe(100)
    expect(goalPercent(100, 0)).toBe(0)
  })

  it('等级按目标的一半、达标与 150% 分档', () => {
    expect(heatLevel(0, 2000)).toBe(0)
    expect(heatLevel(400, 2000)).toBe(1)
    expect(heatLevel(1000, 2000)).toBe(2)
    expect(heatLevel(2000, 2000)).toBe(3)
    expect(heatLevel(3000, 2000)).toBe(4)
  })

  it('热力图返回固定长度的升序格子，最后一格是今天', () => {
    const cells = heatmapCells({ [key('2026-10-30')]: 3500 }, day('2026-10-30'), 2000)
    expect(cells).toHaveLength(84)
    expect(cells[cells.length - 1]).toMatchObject({ date: '2026-10-30', words: 3500, level: 4 })
    expect(cells[0].date < cells[1].date).toBe(true)
  })
})

describe('目标与本地存储的容错', () => {
  it('目标值夹在允许区间内', () => {
    expect(normalizeGoal(undefined)).toBe(WRITING_GOAL_DEFAULT)
    expect(normalizeGoal('abc')).toBe(WRITING_GOAL_DEFAULT)
    expect(normalizeGoal(10)).toBe(WRITING_GOAL_MIN)
    expect(normalizeGoal(999999)).toBe(WRITING_GOAL_MAX)
    expect(normalizeGoal(2500.6)).toBe(2501)
  })

  it('坏数据不会把统计页打崩', () => {
    expect(parsePersistedGoal(null)).toEqual({ dailyGoal: WRITING_GOAL_DEFAULT, ledger: {} })
    expect(parsePersistedGoal('nope')).toEqual({ dailyGoal: WRITING_GOAL_DEFAULT, ledger: {} })
    expect(parsePersistedGoal({
      dailyGoal: 3000,
      ledger: { '2026-10-30': 500, '2026-10-31': -1, 'x': 10, '2026-11-01': '100' },
    })).toEqual({ dailyGoal: 3000, ledger: { '2026-10-30': 500 } })
  })
})

