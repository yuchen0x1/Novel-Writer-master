import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSaveRetriesForOwner,
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
    const first = useSaveStatusStore.getState().begin(PROJECT_A)
    const second = useSaveStatusStore.getState().begin(PROJECT_A)
    expect(useSaveStatusStore.getState()).toMatchObject({ savingCount: 2, lastSavedAt: null, failure: null })

    useSaveStatusStore.getState().succeed(PROJECT_A, first)
    expect(useSaveStatusStore.getState().savingCount).toBe(1)
    expect(useSaveStatusStore.getState().lastSavedAt).not.toBeNull()
    useSaveStatusStore.getState().release(PROJECT_A, second)
  })

  it('does not carry failure or last-save time across projects', () => {
    const succeeded = useSaveStatusStore.getState().begin(PROJECT_A)
    useSaveStatusStore.getState().succeed(PROJECT_A, succeeded)
    const operation = useSaveStatusStore.getState().begin(PROJECT_A)
    reportSaveFailure(PROJECT_A, operation, 'draft:1', '磁盘已满')

    expect(useSaveStatusStore.getState()).toMatchObject({ projectPath: PROJECT_A, failure: '磁盘已满' })

    useSaveStatusStore.getState().begin(PROJECT_B)
    expect(useSaveStatusStore.getState()).toMatchObject({
      projectPath: PROJECT_B,
      savingCount: 1,
      lastSavedAt: null,
      failure: null,
    })
  })

  it('releases exactly the operation it started', () => {
    const operation = useSaveStatusStore.getState().begin(PROJECT_A)
    useSaveStatusStore.getState().release(PROJECT_A, operation)
    expect(useSaveStatusStore.getState()).toMatchObject({ savingCount: 0, projectPath: PROJECT_A })
  })

  it('does not let an old same-path lease release a newer save', () => {
    const oldOperation = useSaveStatusStore.getState().begin(PROJECT_A, 'lease-1')
    useSaveStatusStore.getState().reset()
    const newOperation = useSaveStatusStore.getState().begin(PROJECT_A, 'lease-2')

    useSaveStatusStore.getState().release(PROJECT_A, oldOperation)

    expect(useSaveStatusStore.getState()).toMatchObject({ projectPath: PROJECT_A, savingCount: 1, savingOperationIds: [newOperation] })
    useSaveStatusStore.getState().release(PROJECT_A, oldOperation)
    expect(useSaveStatusStore.getState().savingCount).toBe(1)
    useSaveStatusStore.getState().release(PROJECT_A, newOperation)
    expect(useSaveStatusStore.getState().savingCount).toBe(0)
  })

  it('retries after component cleanup while the editor tab remains open', () => {
    const run = vi.fn()
    const operation = useSaveStatusStore.getState().begin(PROJECT_A)
    registerSaveRetry(PROJECT_A, 'draft:1', run, 'tab:1')
    reportSaveFailure(PROJECT_A, operation, 'draft:1', '写入失败')

    unregisterSaveRetry(PROJECT_A, 'draft:1', 'unrelated-owner')

    expect(runSaveRetry()).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('removes a retry only when its owning editor tab closes', () => {
    const run = vi.fn()
    const operation = useSaveStatusStore.getState().begin(PROJECT_A)
    registerSaveRetry(PROJECT_A, 'draft:1', run, 'tab:1')
    reportSaveFailure(PROJECT_A, operation, 'draft:1', '写入失败')

    clearSaveRetriesForOwner('tab:1')

    expect(runSaveRetry()).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(useSaveStatusStore.getState().failure).toBeNull()
  })

  it('does not release a newer project save when an old request settles', () => {
    const oldOperation = useSaveStatusStore.getState().begin(PROJECT_A)
    useSaveStatusStore.getState().reset()
    const newOperation = useSaveStatusStore.getState().begin(PROJECT_B)

    useSaveStatusStore.getState().release(PROJECT_A, oldOperation)

    expect(useSaveStatusStore.getState()).toMatchObject({ projectPath: PROJECT_B, savingCount: 1, savingOperationIds: [newOperation] })
  })

  it('keeps retry available after a simulated effect cleanup while the tab is still open', () => {
    const run = vi.fn()
    const operation = useSaveStatusStore.getState().begin(PROJECT_A)
    registerSaveRetry(PROJECT_A, 'draft:1', run, 'tab:1')
    reportSaveFailure(PROJECT_A, operation, 'draft:1', '写入失败')

    unregisterSaveRetry(PROJECT_A, 'draft:1', 'out-of-band-cleanup')

    expect(runSaveRetry()).toBe(true)
    expect(run).toHaveBeenCalledOnce()
  })

  it('retries only the most recent failure within the same project', () => {
    const runA = vi.fn()
    const runB = vi.fn()
    const operationA = useSaveStatusStore.getState().begin(PROJECT_A)
    useSaveStatusStore.getState().release(PROJECT_A, operationA)
    useSaveStatusStore.getState().begin(PROJECT_B)
    registerSaveRetry(PROJECT_A, 'draft:1', runA)
    registerSaveRetry(PROJECT_B, 'draft:1', runB)

    const failureA = useSaveStatusStore.getState().begin(PROJECT_A)
    reportSaveFailure(PROJECT_A, failureA, 'draft:1', '写入失败')
    expect(runSaveRetry()).toBe(true)
    expect(runA).toHaveBeenCalledOnce()
    expect(runB).not.toHaveBeenCalled()

    unregisterSaveRetry(PROJECT_A, 'draft:1')
    const failureB = useSaveStatusStore.getState().begin(PROJECT_B)
    reportSaveFailure(PROJECT_B, failureB, 'draft:1', '写入失败')
    expect(runSaveRetry()).toBe(true)
    expect(runB).toHaveBeenCalledOnce()
  })

  it('drops retry entries and status when the project closes', () => {
    const run = vi.fn()
    const operation = useSaveStatusStore.getState().begin(PROJECT_A)
    registerSaveRetry(PROJECT_A, 'draft:1', run)
    reportSaveFailure(PROJECT_A, operation, 'draft:1', '写入失败')

    resetSaveStatus()

    expect(runSaveRetry()).toBe(false)
    expect(run).not.toHaveBeenCalled()
    expect(useSaveStatusStore.getState()).toMatchObject({ projectPath: null, savingCount: 0, failure: null })
  })
})
