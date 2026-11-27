import { parseFragment } from 'parse5'

/**
 * 把更新说明拍成可读纯文本。来源有两种：
 * - GitHub Atom 摘要流（electron-updater 的 GitHub provider）给的是渲染后的 HTML；
 * - 其他后端给原始 markdown。
 * HTML 先转行结构（块级标签换行、列表项加圆点、实体解码），再走同一套 markdown 清理，两条路都出干净文本。
 */
interface HtmlNode {
  nodeName: string
  tagName?: string
  value?: string
  childNodes?: HtmlNode[]
}

const BLOCK_TAGS = new Set([
  'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'ol', 'p', 'pre', 'ul',
])

function htmlText(node: HtmlNode): string {
  if (node.nodeName === '#text') return node.value ?? ''
  const tag = node.tagName?.toLowerCase()
  if (tag === 'script' || tag === 'style' || tag === 'template') return ''
  if (tag === 'br') return '\n'

  const children = (node.childNodes ?? []).map(htmlText).join('')
  if (tag === 'li') return `\n· ${children}\n`
  if (tag && BLOCK_TAGS.has(tag)) return `\n\n${children}\n\n`
  return children
}

function hasHtmlElements(node: HtmlNode): boolean {
  return Boolean(node.tagName) || (node.childNodes ?? []).some(hasHtmlElements)
}

function htmlToLines(html: string): { isHtml: boolean; text: string } {
  const fragment = parseFragment(html) as unknown as HtmlNode
  return { isHtml: hasHtmlElements(fragment), text: htmlText(fragment) }
}

export function plainReleaseNotes(notes: string): string {
  const parsed = htmlToLines(notes)
  const source = parsed.isHtml ? parsed.text : notes
  return source
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim()
      if (!trimmed) return ''
      const bullet = /^[-*]\s+(.*)$/.exec(trimmed)
      const content = (bullet ? bullet[1] : trimmed)
        .replace(/^#{1,6}\s+/, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .trim()
      if (!content) return ''
      return bullet ? '· ' + content : content
    })
    .filter(Boolean)
    .join('\n')
}
