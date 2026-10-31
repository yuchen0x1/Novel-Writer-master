import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { BrowserWindow, ipcMain } from 'electron'

/** 32 MB 的 HTML 相当于一两百万字，超过这个量级基本是调用方传错了内容。 */
const MAX_HTML_BYTES = 32 * 1024 * 1024

export interface PdfRenderSuccess { success: true; base64: string }
export interface PdfRenderFailure { success: false; error: string }
export type PdfRenderResult = PdfRenderSuccess | PdfRenderFailure

/**
 * 把静态 HTML 交给 Chromium 排版后打印成 PDF。
 *
 * 用临时文件而不是 data: URL：一本 30 万字的小说 HTML 会超过 URL 的实际上限；
 * 窗口整条链路都不需要 JS，所以直接关掉 javascript，并把 sandbox / contextIsolation 打开。
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-novel-print-'))
  const file = path.join(directory, 'manuscript.html')
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: false,
      webviewTag: false,
    },
  })
  try {
    await fs.writeFile(file, html, 'utf8')
    await win.loadFile(file)
    return await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true })
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {})
  }
}

export interface PdfExportControllerOptions {
  /** 测试接缝：替换 IPC 注册与渲染实现，避免测试里真的开窗口。 */
  ipc?: Pick<typeof ipcMain, 'handle'>
  render?: (html: string) => Promise<Buffer>
  /** 测试接缝：用小上限验证超限分支，生产用默认值。 */
  maxHtmlBytes?: number
}

export function registerPdfExportController({
  ipc = ipcMain,
  render = renderHtmlToPdf,
  maxHtmlBytes = MAX_HTML_BYTES,
}: PdfExportControllerOptions = {}): void {
  ipc.handle('export:pdf-render', async (_event, html: unknown): Promise<PdfRenderResult> => {
    if (typeof html !== 'string' || html.trim().length === 0) {
      return { success: false, error: 'PDF_HTML_REQUIRED' }
    }
    if (Buffer.byteLength(html, 'utf8') > maxHtmlBytes) {
      return { success: false, error: 'PDF_HTML_TOO_LARGE' }
    }
    try {
      const pdf = await render(html)
      return { success: true, base64: pdf.toString('base64') }
    } catch (error) {
      console.error('[PDF] 渲染失败:', error)
      return { success: false, error: 'PDF_RENDER_FAILED' }
    }
  })
}
