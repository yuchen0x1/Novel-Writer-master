import { create } from 'zustand'

/**
 * 顶栏聚合的保存状态。正文、设定、架构、蓝图各保存入口在开始时 begin、
 * 结束时 succeed/fail（结束统一在 finally 里判定，避免项目会话切换时计数悬空）；
 * 编辑时 clearFailure 让「保存失败」随新输入退场。
 *
 * 状态带作品归属：任何一次上报来自别的作品，都先清空上一部作品的计数、失败与
 * 上次保存时间，避免「上次保存 12:30」或失败提示跟着作者切到另一本书。
 */
interface SaveStatusState {
  /** 当前状态归属的作品路径；还没有任何保存上报时为 null。 */
  projectPath: string | null
  /** 进行中的保存数；大于 0 时顶栏显示「保存中」。 */
  savingCount: number
  /** 最近一次成功保存的时刻；从未保存过时为 null。 */
  lastSavedAt: number | null
  /** 最近一次失败的说明；新输入或新的保存开始后清除。 */
  failure: string | null
  begin: (projectPath: string) => void
  succeed: (projectPath: string) => void
  fail: (projectPath: string, message: string) => void
  /** 只收掉一次进行中的计数；作品已切换时用，不改归属也不刷新时间。 */
  release: () => void
  clearFailure: () => void
  reset: () => void
}

const EMPTY = { projectPath: null, savingCount: 0, lastSavedAt: null, failure: null } as const

/** 上报来自别的作品时，视为重新开始，不继承上一部作品的任何状态。 */
function ownedBy(state: SaveStatusState, projectPath: string): { projectPath: string; savingCount: number; lastSavedAt: number | null; failure: string | null } {
  return state.projectPath === projectPath
    ? { projectPath, savingCount: state.savingCount, lastSavedAt: state.lastSavedAt, failure: state.failure }
    : { projectPath, savingCount: 0, lastSavedAt: null, failure: null }
}

export const useSaveStatusStore = create<SaveStatusState>(set => ({
  ...EMPTY,
  begin: projectPath => set(state => {
    const base = ownedBy(state, projectPath)
    return { ...base, savingCount: base.savingCount + 1, failure: null }
  }),
  succeed: projectPath => set(state => {
    const base = ownedBy(state, projectPath)
    return { ...base, savingCount: Math.max(0, base.savingCount - 1), lastSavedAt: Date.now(), failure: null }
  }),
  fail: (projectPath, message) => set(state => {
    const base = ownedBy(state, projectPath)
    return { ...base, savingCount: Math.max(0, base.savingCount - 1), failure: message }
  }),
  clearFailure: () => set(state => (state.failure === null ? state : { failure: null })),
  release: () => set(state => ({ savingCount: Math.max(0, state.savingCount - 1) })),
  reset: () => set({ ...EMPTY }),
}))

type RetryRun = () => void

const retryRuns = new Map<string, RetryRun>()
let lastFailedKey: string | null = null

function retryKey(projectPath: string, key: string): string {
  return `${projectPath}\u0000${key}`
}

export function registerSaveRetry(projectPath: string, key: string, run: RetryRun): void {
  retryRuns.set(retryKey(projectPath, key), run)
}

export function unregisterSaveRetry(projectPath: string, key: string): void {
  const fullKey = retryKey(projectPath, key)
  retryRuns.delete(fullKey)
  if (lastFailedKey === fullKey) lastFailedKey = null
}

/** 保存失败时记下入口并写入状态；顶栏「重试」只重跑最近失败的那一个。 */
export function reportSaveFailure(projectPath: string, key: string, message: string): void {
  lastFailedKey = retryKey(projectPath, key)
  useSaveStatusStore.getState().fail(projectPath, message)
}

export function runSaveRetry(): boolean {
  const run = lastFailedKey ? retryRuns.get(lastFailedKey) : undefined
  if (!run) return false
  run()
  return true
}

/** 作品关闭时丢掉全部聚合状态与重试入口，避免残留指向已关闭作品。 */
export function resetSaveStatus(): void {
  retryRuns.clear()
  lastFailedKey = null
  useSaveStatusStore.getState().reset()
}
