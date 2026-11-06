import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { EditorView } from '@uiw/react-codemirror'
import { acceptCompletion } from '@codemirror/autocomplete'

import '../../../index.css'
import CodeMirrorEditor from '../CodeMirrorEditor'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

const ENTRIES = [
  { name: '林岚', kind: 'character' as const, summary: '主角，太虚剑意', aliases: ['小岚'] },
  { name: '九幽老祖', kind: 'character' as const, summary: '魔宗老祖' },
  { name: '斩龙台', kind: 'setting' as const, summary: '上古封魔之地' },
]

beforeEach(() => {
  container = document.createElement('div')
  container.className = 'dark'
  container.style.height = '300px'
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('CodeMirror wikilink', () => {
  it('highlights existing [[名称]] links', async () => {
    await act(async () => root.render(
      <CodeMirrorEditor content="他想起[[林岚]]说过的话。" mode="prose" wikilinkEntries={ENTRIES} />,
    ))

    await new Promise(resolve => setTimeout(resolve, 50))
    const link = container.querySelector<HTMLElement>('.cm-wikilink')
    expect(link).toBeTruthy()
    expect(link?.textContent).toBe('[[林岚]]')
  })

  it('offers entity completions after typing [[ and applies the full link', async () => {
    let latest = ''
    await act(async () => root.render(
      <CodeMirrorEditor
        content=""
        mode="prose"
        wikilinkEntries={ENTRIES}
        onChange={value => { latest = value }}
      />,
    ))

    const editorDom = container.querySelector<HTMLElement>('.cm-editor')
    const surface = container.querySelector<HTMLElement>('.cm-content')
    expect(surface).toBeTruthy()
    await act(async () => surface!.focus())
    const editorView = EditorView.findFromDOM(editorDom!)
    expect(editorView).toBeTruthy()
    const view = editorView as EditorView
    await act(async () => {
      // userEvent 与真实键入一致，触发 CodeMirror 的补全激活
      view.dispatch({ changes: { from: 0, insert: '[[九' }, selection: { anchor: 3 }, userEvent: 'input.type' })
    })

    // 补全弹窗出现且包含候选
    await vi.waitFor(() => {
      const items = [...document.querySelectorAll('.cm-tooltip-autocomplete > ul > li')]
      expect(items.length).toBeGreaterThan(0)
      const match = items.find(item => item.textContent?.includes('九幽老祖'))
      expect(match).toBeTruthy()
    })

    // 程序化采纳补全后完整链接写入文档（等过 interactionDelay 的防误触窗口）
    await new Promise(resolve => setTimeout(resolve, 120))
    await act(async () => {
      const accepted = acceptCompletion(view)
      expect(accepted).toBe(true)
    })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(latest).toContain('[[九幽老祖]]')
  })

  it('does not decorate wikilinks when no entries are provided', async () => {
    await act(async () => root.render(
      <CodeMirrorEditor content="旧文本 [[林岚]] 不高亮。" mode="prose" />,
    ))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(container.querySelector('.cm-wikilink')).toBeNull()
  })
})
