/**
 * 打印用 HTML 构建器 — 纯函数，把定稿章节排成一份可直接 printToPDF 的文档。
 *
 * 页面完全静态：没有脚本、没有外链资源，CSP 也锁死到 none；字体只用系统里已有的
 * 思源/宋体/黑体，缺字体时回落到 serif，不影响分页。
 */
import { chapterHeadingText, proseParagraphs } from './prose-text'

export interface PdfChapterInput {
  chapterNumber: number
  title: string
  content: string
}

export interface PdfBuildInput {
  title: string
  author?: string
  /** BCP 47 语言标签，如 zh-CN / en-US。 */
  language: string
  chapters: readonly PdfChapterInput[]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;')
}

const STYLES = `
@page { size: A4; margin: 22mm 20mm 20mm; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; color: #17171a; font-size: 11.5pt; line-height: 1.9; }
h1.book-title { margin: 42mm 0 6mm; text-align: center; font-size: 24pt; line-height: 1.4; }
p.book-author { margin: 0 0 12mm; text-align: center; color: #52525c; font-size: 11pt; }
h2.chapter { margin: 0 0 6mm; font-size: 15pt; line-height: 1.5; page-break-before: always; page-break-after: avoid; }
h2.chapter.first { page-break-before: avoid; margin-top: 14mm; }
p.body { margin: 0 0 3.2mm; text-indent: 2em; text-align: justify; }
`

export function buildPrintHtml(input: PdfBuildInput): string {
  const isChinese = input.language.toLowerCase().startsWith('zh')
  const bodyClass = isChinese ? 'zh' : 'en'
  const parts: string[] = []
  parts.push(`<h1 class="book-title">${escapeHtml(input.title)}</h1>`)
  if (input.author) parts.push(`<p class="book-author">${escapeHtml(input.author)}</p>`)
  input.chapters.forEach((chapter, index) => {
    const first = index === 0 ? ' first' : ''
    parts.push(`<h2 class="chapter${first}">${escapeHtml(chapterHeadingText(chapter, input.language))}</h2>`)
    for (const paragraph of proseParagraphs(chapter.content)) {
      parts.push(`<p class="body">${escapeHtml(paragraph)}</p>`)
    }
  })
  return `<!doctype html><html lang="${escapeHtml(input.language)}"><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    + `<title>${escapeHtml(input.title)}</title><style>${STYLES}</style></head>`
    + `<body class="${bodyClass}">${parts.join('')}</body></html>`
}
