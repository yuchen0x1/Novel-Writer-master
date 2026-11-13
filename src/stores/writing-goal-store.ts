import { create } from 'zustand'

import {
  addWords,
  localDayKey,
  normalizeGoal,
  parsePersistedGoal,
  pruneLedger,
  WRITING_GOAL_DEFAULT,
  type WritingLedger,
} from '../shared/writing-goal'

const STORAGE_KEY = 'ai-novel-writing-goal-v1'
const PERSIST_DELAY_MS = 600

interface WritingGoalState {
  /** 每日目标字数（中文按字、英文按词），与编辑器同一口径。 */
  dailyGoal: number
  /** 本机日期 → 当天累计新增字数。 */
  ledger: WritingLedger
  setDailyGoal: (goal: number) => void
  /** 只传增量；负值（删改）被忽略，避免"今天写了多少"往回跳。 */
  recordWords: (delta: number, now?: Date) => void
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function readPersisted(): { dailyGoal: number; ledger: WritingLedger } {
  const store = storage()
  if (!store) return { dailyGoal: WRITING_GOAL_DEFAULT, ledger: {} }
  try {
    const raw = store.getItem(STORAGE_KEY)
    return raw ? parsePersistedGoal(JSON.parse(raw)) : { dailyGoal: WRITING_GOAL_DEFAULT, ledger: {} }
  } catch {
    return { dailyGoal: WRITING_GOAL_DEFAULT, ledger: {} }
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

/** 打字时每次按键都会记一笔，落盘合并成延迟写，避免 localStorage 成为输入瓶颈。 */
function schedulePersist(read: () => { dailyGoal: number; ledger: WritingLedger }): void {
  const store = storage()
  if (!store) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(read()))
    } catch {
      /* 存储满或被禁用时只是少一次持久化，不影响本次会话的统计 */
    }
  }, PERSIST_DELAY_MS)
}

const initial = readPersisted()

export const useWritingGoalStore = create<WritingGoalState>((set, get) => ({
  dailyGoal: initial.dailyGoal,
  ledger: initial.ledger,

  setDailyGoal: (goal) => {
    set({ dailyGoal: normalizeGoal(goal) })
    schedulePersist(() => ({ dailyGoal: get().dailyGoal, ledger: get().ledger }))
  },

  recordWords: (delta, now = new Date()) => {
    if (!Number.isFinite(delta) || delta <= 0 || !Number.isFinite(now.getTime())) return
    set(state => ({
      ledger: pruneLedger(addWords(state.ledger, localDayKey(now), delta), now),
    }))
    schedulePersist(() => ({ dailyGoal: get().dailyGoal, ledger: get().ledger }))
  },
}))

/** 测试与"立即落盘"场景（例如退出前）用：跳过延迟写。 */
export function flushWritingGoalPersistence(): void {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const store = storage()
  if (!store) return
  try {
    const { dailyGoal, ledger } = useWritingGoalStore.getState()
    store.setItem(STORAGE_KEY, JSON.stringify({ dailyGoal, ledger }))
  } catch {
    /* same as schedulePersist */
  }
}

/** Flush when backgrounded or unloaded; callers own the listener lifetime. */
export function bindWritingGoalPersistence(): () => void {
  const onHidden = () => { if (document.visibilityState === 'hidden') flushWritingGoalPersistence() }
  window.addEventListener('pagehide', flushWritingGoalPersistence)
  document.addEventListener('visibilitychange', onHidden)
  return () => {
    window.removeEventListener('pagehide', flushWritingGoalPersistence)
    document.removeEventListener('visibilitychange', onHidden)
    flushWritingGoalPersistence()
  }
}
