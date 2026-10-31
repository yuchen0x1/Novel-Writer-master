import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * 输入法回归的接线检查。
 *
 * 这些组件的交互需要真实 DOM（项目用 vitest browser 模式跑，本目录下只有浏览器用例），
 * 而组字期间的回车误发送恰恰是最难在无头环境里稳定复现的一类缺陷。这里改为断言三处
 * 键盘入口都经过同一份组字判定：新增入口若绕开它，测试会先红。
 */
const sources = {
  'AgentInputBox.tsx': readFileSync(new URL('../AgentInputBox.tsx', import.meta.url), 'utf8'),
  'SlashCommandMenu.tsx': readFileSync(new URL('../SlashCommandMenu.tsx', import.meta.url), 'utf8'),
  'MentionMenu.tsx': readFileSync(new URL('../MentionMenu.tsx', import.meta.url), 'utf8'),
}

describe('AI 输入框与两个菜单的组字守卫', () => {
  it('输入框用 submitsOnEnter 决定是否发送', () => {
    expect(sources['AgentInputBox.tsx']).toContain('submitsOnEnter(')
    // 旧的裸判断会把拼音当消息发出去。
    expect(sources['AgentInputBox.tsx']).not.toMatch(/if \(e\.key === 'Enter' && !e\.shiftKey\) \{/)
  })

  it.each(['SlashCommandMenu.tsx', 'MentionMenu.tsx'] as const)('%s 的 window 监听先让给输入法', file => {
    const source = sources[file]
    const handler = /const handleKeyDown = useCallback\(\(e: KeyboardEvent\) => \{([\s\S]*?)\n {2}\}, \[/.exec(source)
    expect(handler).not.toBeNull()
    const body = handler![1].trim()
    expect(body.startsWith('// 组字中的方向键/回车/Esc 属于输入法，菜单不接管。')).toBe(true)
    expect(body).toContain('if (isImeComposing(e)) return')
  })
})
