/**
 * 正文排版的最小公共层：DOCX 与 PDF 共用同一套「Markdown 正文 → 纯文本段落」规则，
 * 免得两种导出对同一份稿子给出不同的分段结果。
 */

/** 去掉行内 Markdown 标记，保留文字本身。 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gmu, '')
    .replace(/^>\s?/gmu, '')
    .replace(/^[-*+]\s+/gmu, '')
    .replace(/\*\*(.+?)\*\*/gu, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?![*])/gu, '$1$2')
    .replace(/`([^`]+)`/gu, '$1')
}

/** 按空行分段；段内换行折成空格（中文段落内部不应有硬换行）。 */
export function proseParagraphs(content: string): string[] {
  return stripInlineMarkdown(content.replace(/\r\n?/gu, '\n'))
    .split(/\n[\t ]*\n(?:[\t ]*\n)*/u)
    .map(paragraph => paragraph.replace(/\n/gu, ' ').trim())
    .filter(paragraph => paragraph.length > 0)
}

/** 章标题文案：中文「第N章 标题」，英文「Chapter N Title」；没有章号时只给标题。 */
export function chapterHeadingText(chapter: { chapterNumber: number; title: string }, language: string): string {
  const numbered = Number.isFinite(chapter.chapterNumber) && chapter.chapterNumber > 0
    ? chapter.chapterNumber
    : undefined
  const title = chapter.title.trim() || (language.toLowerCase().startsWith('zh') ? '未命名' : 'Untitled')
  if (numbered === undefined) return title
  return language.toLowerCase().startsWith('zh') ? `第${numbered}章 ${title}` : `Chapter ${numbered} ${title}`
}
