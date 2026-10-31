import { describe, expect, it } from 'vitest'

import { buildPrintHtml } from '../pdf-html'

const input = {
  title: '雾港谜案',
  author: '测试作者',
  language: 'zh-CN',
  chapters: [
    { chapterNumber: 1, title: '起航', content: '第一段。\n\n第二段。' },
    { chapterNumber: 2, title: '暗礁', content: '**加粗**与*斜体*。' },
  ],
}

describe('打印 HTML 构建器', () => {
  it('锁定 CSP 且不引入脚本或外链', () => {
    const html = buildPrintHtml(input)
    expect(html).toContain("default-src 'none'")
    expect(html).not.toContain('<script')
    expect(html).not.toContain('src="http')
  })

  it('章标题按语言生成，第二章强制分页、第一章不分页', () => {
    const html = buildPrintHtml(input)
    expect(html).toContain('第1章 起航')
    expect(html).toContain('第2章 暗礁')
    expect(html).toContain('<h2 class="chapter first">')
    expect(html).toContain('<h2 class="chapter">')
  })

  it('正文分段并去掉 Markdown 标记', () => {
    const html = buildPrintHtml(input)
    expect(html.match(/<p class="body">/g)).toHaveLength(3)
    expect(html).toContain('<p class="body">第一段。</p>')
    expect(html).toContain('<p class="body">第二段。</p>')
    expect(html).toContain('<p class="body">加粗与斜体。</p>')
    expect(html).not.toContain('**')
  })

  it('转义标题与正文里的 HTML 字符', () => {
    const html = buildPrintHtml({
      ...input,
      title: 'A <B> & "C"',
      chapters: [{ chapterNumber: 1, title: 'x', content: '1 < 2 & 3 > 2' }],
    })
    expect(html).toContain('A &lt;B&gt; &amp; &quot;C&quot;')
    expect(html).toContain('1 &lt; 2 &amp; 3 &gt; 2')
    expect(html).not.toContain('A <B> & "C"')
  })

  it('英文作品用 Chapter 编号', () => {
    const html = buildPrintHtml({ ...input, language: 'en-US', chapters: [{ chapterNumber: 3, title: 'Departure', content: 'Hello.' }] })
    expect(html).toContain('Chapter 3 Departure')
  })
})
