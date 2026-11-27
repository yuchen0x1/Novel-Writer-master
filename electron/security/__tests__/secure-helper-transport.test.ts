import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn: spawnMock }))
vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { createSecureFileCapability, createWindowsSafeFileSystem } from '../windows-safe-file-system'

let root = ''
let helperPath = ''

function helperProcess() {
  return Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { destroyed: false, end: vi.fn(), write: vi.fn() }),
    stdout: new EventEmitter(),
    stderr: { resume: vi.fn() },
    kill: vi.fn(),
  })
}

function fixture() {
  const child = helperProcess()
  spawnMock.mockReturnValue(child)
  const fileSystem = createWindowsSafeFileSystem({ platform: 'win32', helperPath, isPackaged: false })
  const target = createSecureFileCapability(root, path.join(root, 'chapter.txt'))
  return { child, fileSystem, target }
}

beforeEach(() => {
  vi.useFakeTimers()
  spawnMock.mockReset()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-helper-transport-'))
  helperPath = path.join(root, 'helper.ps1')
  fs.writeFileSync(helperPath, '', 'utf8')
})

afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(root, { recursive: true, force: true })
})

describe('secure helper transport', () => {
  it('keeps multibyte directory names intact across stdout chunks', async () => {
    const { child, fileSystem, target } = fixture()
    const result = fileSystem.listDirectory(target)
    const bytes = Buffer.from(JSON.stringify({ ok: true, entries: [{ name: '中文小说.txt', isDirectory: false }] }))
    const split = bytes.indexOf(Buffer.from('中')) + 1
    child.stdout.emit('data', bytes.subarray(0, split))
    child.stdout.emit('data', bytes.subarray(split))
    child.emit('close', 0)

    await expect(result).resolves.toEqual([{ name: '中文小说.txt', isDirectory: false }])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('handles an input pipe failure as a rejected read, not an unhandled stream error', async () => {
    const { child, fileSystem, target } = fixture()
    const result = expect(fileSystem.readText(target)).rejects.toThrow('SECURE_FS_HELPER_UNAVAILABLE')

    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow()

    await result
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports an input pipe failure before commit as not committed', async () => {
    const { child, fileSystem, target } = fixture()
    const result = expect(fileSystem.writeTextAtomically(target, 'novel')).rejects.toMatchObject({
      message: 'SECURE_FS_HELPER_UNAVAILABLE', commitState: 'not_committed',
    })

    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow()

    await result
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports an input pipe failure after sending commit as unknown', async () => {
    const { child, fileSystem, target } = fixture()
    const result = expect(fileSystem.writeTextAtomically(target, 'novel')).rejects.toMatchObject({
      message: 'SECURE_FS_HELPER_UNAVAILABLE', commitState: 'unknown',
    })
    child.stdout.emit('data', Buffer.from('{"ok":true,"phase":"ready"}\n'))
    await vi.waitFor(() => expect(child.stdin.end).toHaveBeenCalledWith('{"command":"commit"}\n', 'utf8'))

    expect(() => child.stdin.emit('error', new Error('EPIPE'))).not.toThrow()

    await result
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not send a late commit after the helper timed out while the guard was pending', async () => {
    const { child, fileSystem, target } = fixture()
    let releaseGuard!: () => void
    const guard = new Promise<void>(resolve => { releaseGuard = resolve })
    const result = expect(fileSystem.writeTextAtomically(target, 'novel', () => guard)).rejects.toMatchObject({
      message: 'SECURE_FS_HELPER_TIMEOUT', commitState: 'not_committed',
    })
    child.stdout.emit('data', Buffer.from('{"ok":true,"phase":"ready"}\n'))
    await vi.advanceTimersByTimeAsync(30_000)
    await result

    releaseGuard()
    await Promise.resolve()
    await Promise.resolve()

    expect(child.stdin.end).not.toHaveBeenCalled()
  })
})
