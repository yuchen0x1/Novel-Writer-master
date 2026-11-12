import { create } from 'zustand'
import { sameProjectPathKey } from '../shared/project-session-context'
import type { ProjectSessionContext } from '../shared/ipc-channels'

/**
 * 顶栏聚合的保存状态。保存操作以唯一 ID 配对，项目会话以租约隔离；旧会话的异步完成
 * 不能误减同路径新会话的计数。编辑时 clearFailure 让「保存失败」随新输入退场。
 */
interface SaveStatusState {
  projectPath: string | null
  projectSessionId: string | null
  savingCount: number
  savingOperationIds: string[]
  lastSavedAt: number | null
  failure: string | null
  begin: (projectPath: string, projectSessionId?: string | null) => string
  succeed: (projectPath: string, operationId: string) => void
  fail: (projectPath: string, operationId: string, message: string) => void
  release: (projectPath: string, operationId: string) => void
  clearFailure: () => void
  reset: () => void
}

const EMPTY = { projectPath: null, projectSessionId: null, savingCount: 0, savingOperationIds: [] as string[], lastSavedAt: null, failure: null }
let nextSaveOperationId = 0

function ownedBy(state: SaveStatusState, projectPath: string, projectSessionId: string | null) {
  return state.projectPath === projectPath && state.projectSessionId === projectSessionId
    ? { projectPath, projectSessionId, savingCount: state.savingCount, savingOperationIds: state.savingOperationIds, lastSavedAt: state.lastSavedAt, failure: state.failure }
    : { projectPath, projectSessionId, savingCount: 0, savingOperationIds: [], lastSavedAt: null, failure: null }
}

export const useSaveStatusStore = create<SaveStatusState>(set => ({
  ...EMPTY,
  begin: (projectPath, projectSessionId = null) => {
    const operationId = `save-${++nextSaveOperationId}`
    set(state => {
      const base = ownedBy(state, projectPath, projectSessionId)
      const savingOperationIds = [...base.savingOperationIds, operationId]
      return { ...base, savingCount: savingOperationIds.length, savingOperationIds, failure: null }
    })
    return operationId
  },
  succeed: (projectPath, operationId) => set(state => {
    if (state.projectPath !== projectPath || !state.savingOperationIds.includes(operationId)) return state
    const savingOperationIds = state.savingOperationIds.filter(id => id !== operationId)
    return { savingCount: savingOperationIds.length, savingOperationIds, lastSavedAt: Date.now(), failure: null }
  }),
  fail: (projectPath, operationId, message) => set(state => {
    if (state.projectPath !== projectPath || !state.savingOperationIds.includes(operationId)) return state
    const savingOperationIds = state.savingOperationIds.filter(id => id !== operationId)
    return { savingCount: savingOperationIds.length, savingOperationIds, failure: message }
  }),
  clearFailure: () => set(state => (state.failure === null ? state : { failure: null })),
  release: (projectPath, operationId) => set(state => {
    if (state.projectPath !== projectPath || !state.savingOperationIds.includes(operationId)) return state
    const savingOperationIds = state.savingOperationIds.filter(id => id !== operationId)
    return { savingCount: savingOperationIds.length, savingOperationIds }
  }),
  reset: () => set({ ...EMPTY }),
}))

type RetryRun = () => void
interface RetryEntry { run: RetryRun; ownerId?: string }

const retryRuns = new Map<string, RetryEntry>()
let lastFailedKey: string | null = null

function retryKey(projectPath: string, key: string): string {
  return `${projectPath}\u0000${key}`
}

function sessionIdentity(session: ProjectSessionContext): string {
  return `${session.projectId}\u0000${session.leaseId}`
}

export function isSaveStatusSessionCurrent(projectPath: string, session: ProjectSessionContext | null): boolean {
  const state = useSaveStatusStore.getState()
  return sameProjectPathKey(state.projectPath, projectPath)
    && state.projectSessionId === (session ? sessionIdentity(session) : null)
}

export function beginSaveOperation(session: ProjectSessionContext): string {
  return useSaveStatusStore.getState().begin(session.projectPath, sessionIdentity(session))
}

export function finishSaveOperation(projectPath: string, operationId: string, outcome: 'saved' | 'released' | 'failed', key?: string, message?: string): void {
  const state = useSaveStatusStore.getState()
  if (outcome === 'failed' && key !== undefined && message !== undefined) reportSaveFailure(projectPath, operationId, key, message)
  else if (outcome === 'saved') state.succeed(projectPath, operationId)
  else state.release(projectPath, operationId)
}

export function registerSaveRetry(projectPath: string, key: string, run: RetryRun, ownerId?: string): void {
  retryRuns.set(retryKey(projectPath, key), { run, ownerId })
}

/** 编辑器切到后台时保留失败重试回调；关闭标签时由稳定身份显式清除。 */
export function unregisterSaveRetry(projectPath: string, key: string, ownerId?: string): void {
  const fullKey = retryKey(projectPath, key), entry = retryRuns.get(fullKey)
  if (ownerId !== undefined && entry?.ownerId !== ownerId) return
  retryRuns.delete(fullKey)
  if (lastFailedKey === fullKey) {
    lastFailedKey = null
    useSaveStatusStore.getState().clearFailure()
  }
}

export function clearSaveRetriesForOwner(ownerId: string): void {
  for (const [key, entry] of retryRuns) {
    if (entry.ownerId !== ownerId) continue
    retryRuns.delete(key)
    if (lastFailedKey === key) {
      lastFailedKey = null
      useSaveStatusStore.getState().clearFailure()
    }
  }
}

export function clearAllSaveRetries(): void {
  retryRuns.clear()
  lastFailedKey = null
  useSaveStatusStore.getState().clearFailure()
}

export function clearSaveRetriesForProject(projectPath: string): void {
  const prefix = `${projectPath}\u0000`
  for (const key of retryRuns.keys()) if (key.startsWith(prefix)) retryRuns.delete(key)
  if (lastFailedKey?.startsWith(prefix)) {
    lastFailedKey = null
    useSaveStatusStore.getState().clearFailure()
  }
}

/** 保存失败时记下入口并写入状态；顶栏「重试」只重跑最近失败的那一个。 */
export function reportSaveFailure(projectPath: string, operationId: string, key: string, message: string): void {
  const state = useSaveStatusStore.getState()
  if (state.projectPath !== projectPath || !state.savingOperationIds.includes(operationId)) return
  lastFailedKey = retryKey(projectPath, key)
  state.fail(projectPath, operationId, message)
}

export function runSaveRetry(): boolean {
  const entry = lastFailedKey ? retryRuns.get(lastFailedKey) : undefined
  if (!entry) return false
  entry.run()
  return true
}

/** 作品关闭时丢掉全部聚合状态与重试入口，避免残留指向已关闭作品。 */
export function resetSaveStatus(): void {
  clearAllSaveRetries()
  useSaveStatusStore.getState().reset()
}
