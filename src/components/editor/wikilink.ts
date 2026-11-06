/**
 * Wikilink 扩展 —— 正文里的 [[角色/设定]] 双向链接。
 *
 * - 输入 `[[` 弹出实体联想补全（角色、设定词条），回车或点击补全为 `[[名称]]`；
 * - 已写成的 `[[名称]]` 高亮显示，鼠标悬停弹出速览卡片（档案摘要）。
 *
 * 词条由调用方传入（编辑器不读存储），样式走纸墨令牌保证双主题。
 */
import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  MatchDecorator,
  EditorView,
} from '@codemirror/view'
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'

/** 可被 [[ ]] 引用的实体（角色 / 设定 / 世界观词条） */
export interface WikilinkEntry {
  /** 实体名（补全与链接的目标文本） */
  name: string
  /** 可选别名，也参与补全匹配 */
  aliases?: readonly string[]
  /** 悬浮卡片里的一行摘要 */
  summary?: string
  /** 实体类型徽标 */
  kind?: 'character' | 'setting' | 'item'
}

const WIKILINK_RE = /\[\[([^\]\n]{1,80})\]\]/gu

// ---------- 悬浮速览卡片 ----------

const tooltipCss = `
.zcode-wikilink-card {
  position: fixed;
  z-index: 9999;
  max-width: 360px;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--rule-strong);
  background: var(--paper);
  color: var(--ink);
  box-shadow: var(--shadow-panel);
  font-size: 12.5px;
  line-height: 1.65;
  pointer-events: none;
  white-space: pre-wrap;
}
.zcode-wikilink-card .zl-card-kind {
  display: inline-block;
  margin-right: 6px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  border: 1px solid var(--rule-strong);
  color: var(--ink-3);
}
.zcode-wikilink-card .zl-card-name {
  font-weight: 700;
  font-size: 13px;
}
`

/** 注入一次全局样式（卡片跟随主题令牌，深浅色自动适配） */
let styleInjected = false
function ensureTooltipStyle(): void {
  if (styleInjected) return
  const style = document.createElement('style')
  style.textContent = tooltipCss
  document.head.appendChild(style)
  styleInjected = true
}

const KIND_LABEL: Record<NonNullable<WikilinkEntry['kind']>, readonly [string, string]> = {
  character: ['角色', 'Character'],
  setting: ['设定', 'Setting'],
  item: ['物品', 'Item'],
}

function buildCard(entry: WikilinkEntry, localeZh: boolean): HTMLElement {
  const card = document.createElement('div')
  card.className = 'zcode-wikilink-card'
  const head = document.createElement('div')
  if (entry.kind) {
    const badge = document.createElement('span')
    badge.className = 'zl-card-kind'
    badge.textContent = localeZh ? KIND_LABEL[entry.kind][0] : KIND_LABEL[entry.kind][1]
    head.appendChild(badge)
  }
  const name = document.createElement('span')
  name.className = 'zl-card-name'
  name.textContent = entry.name
  head.appendChild(name)
  card.appendChild(head)
  if (entry.summary?.trim()) {
    const body = document.createElement('div')
    body.style.marginTop = '4px'
    body.textContent = entry.summary.trim()
    card.appendChild(body)
  }
  return card
}

/** 在编辑器里创建 [[名称]] 装饰 + 悬浮卡片 */
export function wikilinkHighlight(entries: readonly WikilinkEntry[], localeZh: boolean) {
  const byName = new Map<string, WikilinkEntry>()
  for (const entry of entries) {
    byName.set(entry.name, entry)
    for (const alias of entry.aliases ?? []) {
      if (!byName.has(alias)) byName.set(alias, entry)
    }
  }

  const decorator = new MatchDecorator({
    regexp: WIKILINK_RE,
    decoration: Decoration.mark({ class: 'cm-wikilink' }),
  })

  let activeCard: HTMLElement | null = null
  let hideTimer: number | undefined

  const hideCard = () => {
    if (hideTimer !== undefined) { window.clearTimeout(hideTimer); hideTimer = undefined }
    activeCard?.remove()
    activeCard = null
  }
  const showCard = (target: HTMLElement) => {
    const match = WIKILINK_RE.exec(target.textContent ?? '')
    WIKILINK_RE.lastIndex = 0
    const inner = match?.[1]?.trim()
    const entry = inner ? byName.get(inner) : undefined
    if (!entry) { hideCard(); return }
    if (activeCard?.dataset.wlName === entry.name) return
    hideCard()
    ensureTooltipStyle()
    const card = buildCard(entry, localeZh)
    card.dataset.wlName = entry.name
    const rect = target.getBoundingClientRect()
    card.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 380))}px`
    card.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 140)}px`
    document.body.appendChild(card)
    activeCard = card
  }

  return [
    ViewPlugin.fromClass(class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view)
      }
      update(update: ViewUpdate) {
        this.decorations = decorator.updateDeco(update, this.decorations)
      }
    }, {
      decorations: plugin => plugin.decorations,
      eventHandlers: {
        mouseover(event) {
          const target = event.target as HTMLElement | null
          if (target?.classList?.contains('cm-wikilink')) showCard(target)
        },
        mouseout(event) {
          const target = event.target as HTMLElement | null
          if (target?.classList?.contains('cm-wikilink')) {
            // 稍作延迟，避免鼠标在卡片与链接间抖动时闪烁
            if (hideTimer !== undefined) window.clearTimeout(hideTimer)
            hideTimer = window.setTimeout(hideCard, 120)
          }
        },
        blur() { hideCard() },
      },
    }),
    EditorView.theme({
      '.cm-wikilink': {
        color: 'var(--accent)',
        textDecoration: 'underline',
        textDecorationColor: 'var(--accent)',
        textUnderlineOffset: '3px',
        cursor: 'help',
      },
    }),
  ]
}

// ---------- [[ 联想补全 ----------

/** `[[` 触发的实体联想补全源（导出以便单元测试直接验证匹配行为） */
export function wikilinkSource(entries: readonly WikilinkEntry[]) {
  const options = entries.map(entry => ({
    label: entry.name,
    detail: entry.summary?.slice(0, 40) ?? '',
    type: entry.kind === 'character' ? 'variable' : entry.kind === 'item' ? 'keyword' : 'namespace',
    apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
      // 把「[[前缀」整体替换为完整链接；光标落在右括号后
      const line = view.state.doc.lineAt(from)
      const before = view.state.sliceDoc(line.from, from)
      const bracketAt = before.lastIndexOf('[[')
      const replaceFrom = bracketAt >= 0 ? line.from + bracketAt : from
      view.dispatch({
        changes: { from: replaceFrom, to, insert: `[[${entry.name}]]` },
        selection: { anchor: replaceFrom + entry.name.length + 4 },
      })
    },
  }))
  return (context: CompletionContext): CompletionResult | null => {
    const before = context.matchBefore(/\[\[([^\]\n]*)$/u)
    if (!before) return null
    // 刚敲下「[[」且后面已有正常文字时（历史文本）不弹
    const query = before.text.slice(2).toLowerCase()
    const filtered = query
      ? options.filter(option => (
        option.label.toLowerCase().includes(query)
        || entries.find(entry => entry.name === option.label)?.aliases?.some(alias => alias.toLowerCase().includes(query))
      ))
      : options
    if (filtered.length === 0) return null
    return {
      from: before.from,
      options: filtered,
      validFor: /^[^\]\n]*$/u,
      // 自己按名称与别名过滤；关闭 CM 的模糊匹配，否则「[[」前缀永远匹配不上词条名
      filter: false,
    }
  }
}

/** `[[` 触发的实体联想补全扩展 */
export function wikilinkCompletion(entries: readonly WikilinkEntry[]) {
  return autocompletion({
    override: [wikilinkSource(entries)],
    icons: false,
    activateOnTyping: true,
    maxRenderedOptions: 12,
  })
}
