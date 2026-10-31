import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: vi.fn(),
}))

import { registerPdfExportController } from '../pdf-export-controller'

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
})
