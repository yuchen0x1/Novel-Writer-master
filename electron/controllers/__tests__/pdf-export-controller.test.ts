import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const printHarness = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  BrowserWindow: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: printHarness.BrowserWindow,
  session: { fromPartition: printHarness.fromPartition },
}))

import { registerPdfExportController, renderHtmlToPdf } from '../pdf-export-controller'

afterEach(() => vi.restoreAllMocks())

function register(options: Parameters<typeof registerPdfExportController>[0] = {}) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>()
  const ipc = { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => { handlers.set(channel, handler) } }
  registerPdfExportController({ ...options, ipc: ipc as never })
  const run = handlers.get('export:pdf-render')
  if (!run) throw new Error('export:pdf-render was not registered')
  return run
}

describe('PDF 导出控制器', () => {
  it('把渲染出的 PDF 以 base64 返回', async () => {
    const render = vi.fn(async () => Buffer.from('%PDF-1.7 内容'))
    const run = register({ render })

    const result = await run({}, '<html></html>')

    expect(render).toHaveBeenCalledWith('<html></html>')
    expect(result).toMatchObject({ success: true })
    expect(Buffer.from((result as { base64: string }).base64, 'base64').toString('utf8')).toBe('%PDF-1.7 内容')
  })

  it('空内容直接拒绝，不启动渲染', async () => {
    const render = vi.fn(async () => Buffer.from('x'))
    const run = register({ render })

    await expect(run({}, '   ')).resolves.toEqual({ success: false, error: 'PDF_HTML_REQUIRED' })
    await expect(run({}, 42)).resolves.toEqual({ success: false, error: 'PDF_HTML_REQUIRED' })
    expect(render).not.toHaveBeenCalled()
  })

  it('超过上限时拒绝，避免把超大文档交给 Chromium', async () => {
    const render = vi.fn(async () => Buffer.from('x'))
    const run = register({ render, maxHtmlBytes: 16 })

    await expect(run({}, '<p>0123456789ABCDEF</p>')).resolves.toEqual({ success: false, error: 'PDF_HTML_TOO_LARGE' })
    expect(render).not.toHaveBeenCalled()
  })

  it('渲染失败返回固定错误码，不把内部细节抛给渲染层', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = register({ render: async () => { throw new Error('C:\\secret\\path.html') } })

    await expect(run({}, '<html></html>')).resolves.toEqual({ success: false, error: 'PDF_RENDER_FAILED' })
    consoleError.mockRestore()
  })

  it('uses an isolated print session that blocks every resource except the generated main document', async () => {
    let request: (details: { url: string; resourceType: string }, callback: (result: { cancel: boolean }) => void) => void
    let loadedFile = ''
    const isolatedSession = {
      webRequest: { onBeforeRequest: vi.fn(handler => { request = handler }) },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    }
    const window = {
      webContents: { printToPDF: vi.fn(async () => Buffer.from('%PDF')), setWindowOpenHandler: vi.fn() },
      loadFile: vi.fn(async (file: string) => { loadedFile = file }),
      isDestroyed: () => false,
      destroy: vi.fn(),
    }
    printHarness.fromPartition.mockReturnValue(isolatedSession)
    printHarness.BrowserWindow.mockImplementation(function () { return window })

    await expect(renderHtmlToPdf('<html><img src="https://example.com/private"></html>')).resolves.toEqual(Buffer.from('%PDF'))
    expect(printHarness.fromPartition).toHaveBeenCalledWith(expect.stringMatching(/^ai-novel-print-/), { cache: false })
    expect(printHarness.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({
      webPreferences: expect.objectContaining({ session: isolatedSession, javascript: false, sandbox: true }),
    }))
    const allowed = vi.fn()
    request!({ url: pathToFileURL(loadedFile).href, resourceType: 'mainFrame' }, allowed)
    expect(allowed).toHaveBeenCalledWith({ cancel: false })
    for (const details of [
      { url: 'https://example.com/private', resourceType: 'image' },
      { url: 'file:///C:/private/file.txt', resourceType: 'subFrame' },
      { url: 'https://example.com/redirect', resourceType: 'mainFrame' },
      { url: pathToFileURL(loadedFile).href, resourceType: 'subFrame' },
    ]) {
      const blocked = vi.fn()
      request!(details, blocked)
      expect(blocked).toHaveBeenCalledWith({ cancel: true })
    }
    expect(window.destroy).toHaveBeenCalledOnce()
    await expect(fs.access(loadedFile)).rejects.toThrow()
  })

  it('cleans the temporary directory even when constructing the print window fails', async () => {
    const root = await fs.mkdtemp((await import('node:path')).join((await import('node:os')).tmpdir(), 'pdf-window-test-'))
    const remove = vi.spyOn(fs, 'rm')
    const create = vi.spyOn(fs, 'mkdtemp').mockResolvedValueOnce(root)
    printHarness.BrowserWindow.mockImplementation(function () { throw new Error('window unavailable') })
    await expect(renderHtmlToPdf('<html></html>')).rejects.toThrow('window unavailable')
    expect(create).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith(root, { recursive: true, force: true })
    await expect(fs.access(root)).rejects.toThrow()
  })
})
