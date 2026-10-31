import { beforeEach, describe, expect, it } from 'vitest'

import { localDayKey, WRITING_GOAL_MIN } from '../../shared/writing-goal'
import { flushWritingGoalPersistence, useWritingGoalStore } from '../writing-goal-store'

const at = (iso: string) => new Date(`${iso}T12:00:00`)

describe('写作目标 store', () => {
  beforeEach(() => {
    useWritingGoalStore.setState({ dailyGoal: 2000, ledger: {} })
  })

  it('记录增量并累计到当天', () => {
    useWritingGoalStore.getState().recordWords(300, at('2026-10-30'))
    useWritingGoalStore.getState().recordWords(200, at('2026-10-30'))
    expect(useWritingGoalStore.getState().ledger[localDayKey(at('2026-10-30'))]).toBe(500)
  })

  it('删改产生的负增量被忽略', () => {
    useWritingGoalStore.getState().recordWords(300, at('2026-10-30'))
    useWritingGoalStore.getState().recordWords(-200, at('2026-10-30'))
    expect(useWritingGoalStore.getState().ledger[localDayKey(at('2026-10-30'))]).toBe(300)
  })

  it('目标值越界时被夹回允许区间', () => {
    useWritingGoalStore.getState().setDailyGoal(1)
    expect(useWritingGoalStore.getState().dailyGoal).toBe(WRITING_GOAL_MIN)
    useWritingGoalStore.getState().setDailyGoal(Number.NaN)
    expect(useWritingGoalStore.getState().dailyGoal).toBe(2000)
  })

  it('没有 localStorage 时 flush 不抛错（Node 测试环境）', () => {
    expect(() => flushWritingGoalPersistence()).not.toThrow()
  })

  it('跨天记录互不覆盖', () => {
    useWritingGoalStore.getState().recordWords(100, at('2026-10-29'))
    useWritingGoalStore.getState().recordWords(200, at('2026-10-30'))
    expect(Object.keys(useWritingGoalStore.getState().ledger).sort()).toEqual(['2026-10-29', '2026-10-30'])
  })
})

