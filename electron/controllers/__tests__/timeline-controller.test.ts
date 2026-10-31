import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentPath: 'C:\\novels\\A',
  leaseRoot: 'C:\\novels\\A',
  leaseValid: true,
  read: vi.fn(() => ({ version: 1, lanes: [], events: [] })),
  write: vi.fn(async (_path: string, doc: unknown) => doc),
}))

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, BrowserWindow: vi.fn() }))
vi.mock('../../database', () => ({ getCurrentProjectPath: () => mocks.currentPath }))
vi.mock('../../services/project-access', () => ({
  projectAccess: {
    assertCurrentSession: () => {
      if (!mocks.leaseValid) throw new Error('PROJECT_SESSION_STALE')
      return { kind: 'manifest', projectId: 'p', leaseId: 'l', rootPath: mocks.leaseRoot }
    },
    sameCanonicalProjectRoot: (left: string, right: string) => left.toLowerCase() === right.toLowerCase(),
  },
}))
vi.mock('../../services/timeline-store', () => ({
  readTimeline: mocks.read,
  writeTimeline: mocks.write,
}))

import { registerTimelineController } from '../timeline-controller'

type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>

function register() {
  const handlers = new Map<string, Handler>()
  registerTimelineController({
    ipc: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as never,
  })
  return {
    read: handlers.get('timeline:read')!,
    save: handlers.get('timeline:save')!,
  }
}

const session = { projectId: 'p', leaseId: 'l', projectPath: 'C:\\novels\\A' }

describe('时间线控制器', () => {
  beforeEach(() => { mocks.read.mockClear(); mocks.write.mockClear() })
  it('会话与路径一致时读取当前作品的时间线', async () => {
    const { read } = register()
    await expect(read({}, 'C:\\novels\\A', session)).resolves.toEqual({ version: 1, lanes: [], events: [] })
    expect(mocks.read).toHaveBeenCalledWith('C:\\novels\\A')
  })

  it('调用方声明的路径与当前库不一致时拒绝', async () => {
    const { read } = register()
    await expect(read({}, 'C:\\novels\\B', session)).rejects.toThrow('PROJECT_SESSION_STALE')
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('租约失效时拒绝读取', async () => {
    mocks.leaseValid = false
    const { read } = register()
    await expect(read({}, 'C:\\novels\\A', session)).rejects.toThrow('PROJECT_SESSION_STALE')
    mocks.leaseValid = true
  })

  it('保存把文档交给存储层并返回归一化结果', async () => {
    const { save } = register()
    const document = { version: 1, lanes: ['主线'], events: [] }
    await expect(save({}, document, 'C:\\novels\\A', session)).resolves.toEqual(document)
    expect(mocks.write).toHaveBeenCalledWith('C:\\novels\\A', document)
  })

  it('缺少路径时直接报上下文缺失', async () => {
    const { save } = register()
    await expect(save({}, { version: 1, lanes: [], events: [] }, '', session)).rejects.toThrow('PROJECT_CONTEXT_REQUIRED')
  })
})

