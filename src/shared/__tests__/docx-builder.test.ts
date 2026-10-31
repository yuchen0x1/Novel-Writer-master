import { describe, expect, it } from 'vitest'

import { buildDocx } from '../docx-builder'

// ZIP 头是二进制，正文部件是 UTF-8：用 UTF-8 解码整包，二进制段变成替换字符但不影响子串断言。
const utf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes)

const baseInput = {
  title: '雾港谜案',
  author: '测试作者',
  language: 'zh-CN',
  createdIso: '2026-01-01T00:00:00Z',
  chapters: [
    { chapterNumber: 1, title: '起航', content: '第一段正文。\n\n第二段正文。' },
    { chapterNumber: 2, title: '暗礁', content: '**加粗**与*斜体*都应当变成普通文字。' },
  ],
}

describe('DOCX 构建器', () => {
  it('产出可被 ZIP 识别、包含 OOXML 必需部件的字节流', () => {
    const bytes = buildDocx(baseInput)
    const text = utf8(bytes)

    expect(bytes[0]).toBe(0x50)
    expect(bytes[1]).toBe(0x4b)
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) {
      expect(text).toContain(part)
    }
    expect(text).toContain('<w:document')
    expect(text).toContain('</w:document>')
  })

  it('按章写标题，正文按空行分段并保留首行缩进', () => {
    const text = utf8(buildDocx(baseInput))

    expect(text).toContain('第1章 起航')
    expect(text).toContain('第2章 暗礁')
    expect(text).toContain('<w:ind w:firstLineChars="200"/>')
    expect(text).toContain('第一段正文。')
    expect(text).toContain('第二段正文。')
    // 两个正文段各自成段，而不是挤进同一个 w:p。
    expect(text).toContain('第一段正文。</w:t></w:r></w:p><w:p><w:pPr><w:ind w:firstLineChars="200"/>')
  })

  it('Markdown 标记不进入 Word 正文', () => {
    const text = utf8(buildDocx(baseInput))
    expect(text).toContain('加粗与斜体都应当变成普通文字。')
    expect(text).not.toContain('**加粗**')
  })

  it('英文作品用 Chapter 编号', () => {
    const text = utf8(buildDocx({ ...baseInput, language: 'en-US', chapters: [{ chapterNumber: 3, title: 'Departure', content: 'Hello.' }] }))
    expect(text).toContain('Chapter 3 Departure')
  })

  it('标题与正文里的 XML 特殊字符被转义', () => {
    const text = utf8(buildDocx({
      ...baseInput,
      title: 'A <B> & "C"',
      chapters: [{ chapterNumber: 1, title: 'x', content: '1 < 2 & 3 > 2' }],
    }))
    expect(text).toContain('A &lt;B&gt; &amp; &quot;C&quot;')
    expect(text).toContain('1 &lt; 2 &amp; 3 &gt; 2')
    expect(text).not.toContain('A <B> & "C"')
  })

  it('同一输入得到字节相同的结果', () => {
    expect(buildDocx(baseInput)).toEqual(buildDocx(baseInput))
  })

  it('用真实的 unzip 实现能完整列出所有部件', async () => {
    const yauzl = await import('yauzl')
    const bytes = buildDocx(baseInput)
    const entries = await new Promise<string[]>((resolve, reject) => {
      yauzl.fromBuffer(Buffer.from(bytes), { lazyEntries: true }, (error, zip) => {
        if (error || !zip) { reject(error); return }
        const names: string[] = []
        zip.on('entry', entry => { names.push(entry.fileName); zip.readEntry() })
        zip.on('end', () => resolve(names))
        zip.on('error', reject)
        zip.readEntry()
      })
    })
    expect(entries).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/document.xml',
      'word/styles.xml',
      'word/_rels/document.xml.rels',
    ])
  })
})

