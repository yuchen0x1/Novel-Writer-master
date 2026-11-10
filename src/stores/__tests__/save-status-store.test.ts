import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  registerSaveRetry,
  reportSaveFailure,
  resetSaveStatus,
  runSaveRetry,
  unregisterSaveRetry,
  useSaveStatusStore,
} from '../save-status-store'

const PROJECT_A = 'C:\\novels\\A'
const PROJECT_B = 'C:\\novels\\B'

beforeEach(() => {
  resetSaveStatus()
})

describe('save status store', () => {
  it('tracks in-flight saves and the last success time', () => {
    useSaveStatusStore.getState().begin(PROJECT_A)
    useSaveStatusStore.getState().begin(PROJECT_A)
    expect(useSaveStatusStore.getState()).toMatchObject({ savingCount: 2, lastSavedAt: null, failure: null })

    useSaveStatusStore.getState().succeed(PROJECT_A)
    expect(useSaveStatusStore.getState().savingCount).toBe(1)
    expect(useSaveStatusStore.getState().lastSavedAt).not.toBeNull()
  })

  it('does not carry failure or last-save time across projects', () => {
    useSaveStatusStore.getState().begin(PROJECT_A)
    useSaveStatusStore.getState().succeed(PROJECT_A)
    useSaveStatusStore.getState().begin(PROJECT_A)
    reportSaveFailure(PROJECT_A, 'draft:1', '磁盘已满')

    expect(useSaveStatusStore.getState()).toMatchObject({ projectPath: PROJECT_A, failure: '磁盘已满' })

    useSaveStatusStore.getState().begin(PROJECT_B)
    expect(useSaveStatusStore.getState()).toMatchObject({
      projectPath: PROJECT_B,
      savingCount: 1,
      lastSavedAt: null,
      failure: null,
    })
  })

  it('releases a count without adopting the stale project', () => {
    useSaveStatusStore.getState().begin(PROJECT_A)
    useSaveStatusStore.getState().release()
    expect(useSaveStatusStore.getState()).toMatchObject({ savingCount: 0, projectPath: PROJECT_A })
  })

  it('retries only the most recent failure within the same project', () => {
    const runA = vi.fn()
    const runB = vi.fn()
    registerSaveRetry(PROJECT_A, 'draft:1', runA)
    registerSaveRetry(PROJECT_B, 'draft:1', runB)

    reportSaveFailure(PROJECT_A, 'draft:1', '写入失败')
    expect(runSaveRetry()).toBe(true)
    expect(runA).toHaveBeenCalledOnce()
    expect(runB).not.toHaveBeenCalled()

    unregisterSaveRetry(PROJECT_A, 'draft:1')
    reportSaveFailure(PROJECT_B, 'draft:1', '写入失败')
    expect(runSaveRetry()).toBe(true)
    expect(runB).toHaveBeenCalledOnce()
  })

  it('drops retry entries and status when the project closes', () => {
    const run = vi.fn()
    registerSaveRetry(PROJECT_A, 'draft:1', run)
    useSaveStatusStore.getState().begin(PROJECT_A)
    reportSaveFailure(PROJECT_A, 'draft:1', '写入失败')

    resetSaveStatus()

    expect(runSaveRetry()).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(useSaveStatusStore.getState()).toMatchObject({ projectPath: null, savingCount: 0, failure: null })
  })
})