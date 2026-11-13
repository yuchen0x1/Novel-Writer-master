import { afterEach, describe, expect, it, vi } from 'vitest'
import { findSearchHighlights } from '../book-search'
import { addWords, goalPercent, heatLevel, normalizeGoal, parsePersistedGoal } from '../writing-goal'
import { bindWritingGoalPersistence, flushWritingGoalPersistence, useWritingGoalStore } from '../../stores/writing-goal-store'
import { buildEpub, escapeXmlText } from '../epub-builder'
import { buildDocx } from '../docx-builder'
import { proseParagraphs } from '../prose-text'
import { buildPrintHtml } from '../pdf-html'

afterEach(() => { flushWritingGoalPersistence(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('search highlight boundaries', () => {
  it('treats punctuation as literal text instead of regex syntax', () => {
    expect(findSearchHighlights('a+b [雾] .*', ['a+b', '[雾]', '.*'])).toEqual([
      { index: 0, length: 3 }, { index: 4, length: 3 }, { index: 8, length: 2 },
    ])
  })
  it('returns original coordinates after Unicode characters that expand in lowercase', () => {
    const content = 'İ😀FOG fog'
    expect(findSearchHighlights(content, ['fog']).map(hit => content.slice(hit.index, hit.index + hit.length))).toEqual(['FOG', 'fog'])
  })
  it('prefers longer overlapping terms and ignores empty terms', () => {
    expect(findSearchHighlights('雾钟 雾', ['', '雾', '雾钟'])).toEqual([{ index: 0, length: 2 }, { index: 3, length: 1 }])
    expect(findSearchHighlights('text', [])).toEqual([])
  })
})

describe('writing ledger validation and persistence', () => {
  it('rejects impossible calendar days while preserving leap days', () => {
    expect(parsePersistedGoal({ ledger: { '2026-02-30': 10, '2026-13-01': 20, '2024-02-29': 30, '2026-02-29': 40 } }).ledger).toEqual({ '2024-02-29': 30 })
    const ledger = { '2026-11-13': 20 }
    expect(addWords(ledger, 'NaN-NaN-NaN', 30)).toBe(ledger)
    expect(addWords(ledger, '2026-11-13', 0.1)).toBe(ledger)
  })
  it('keeps invalid numeric input out of progress and goal controls', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(goalPercent(value, 2000)).toBe(0)
      expect(heatLevel(value, 2000)).toBe(0)
    }
    for (const value of [null, '', ' ', Symbol('bad'), {}]) expect(normalizeGoal(value)).toBe(2000)
  })
  it('coalesces writes and flushes the latest value immediately before exit', () => {
    vi.useFakeTimers()
    const setItem = vi.fn()
    vi.stubGlobal('localStorage', { setItem })
    useWritingGoalStore.setState({ dailyGoal: 2000, ledger: {} })
    useWritingGoalStore.getState().recordWords(10, new Date('2026-11-13T12:00:00'))
    useWritingGoalStore.getState().recordWords(20, new Date('2026-11-13T12:00:00'))
    expect(setItem).not.toHaveBeenCalled()
    flushWritingGoalPersistence()
    expect(JSON.parse(setItem.mock.calls[0][1]).ledger).toEqual({ '2026-11-13': 30 })
    vi.advanceTimersByTime(1000)
    expect(setItem).toHaveBeenCalledTimes(1)
  })
  it('flushes on backgrounding and pagehide, and removes listeners on cleanup', () => {
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'hidden' })
    const setItem = vi.fn()
    vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('localStorage', { setItem })
    const dispose = bindWritingGoalPersistence()
    doc.dispatchEvent(new Event('visibilitychange')); win.dispatchEvent(new Event('pagehide'))
    expect(setItem).toHaveBeenCalledTimes(2)
    dispose()
    expect(setItem).toHaveBeenCalledTimes(3)
    win.dispatchEvent(new Event('pagehide')); doc.dispatchEvent(new Event('visibilitychange'))
    expect(setItem).toHaveBeenCalledTimes(3)
  })
  it('does not throw when storage is full or unavailable', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('quota') } })
    expect(flushWritingGoalPersistence).not.toThrow()
    const before = useWritingGoalStore.getState().ledger
    useWritingGoalStore.getState().recordWords(10, new Date(NaN))
    expect(useWritingGoalStore.getState().ledger).toBe(before)
  })
})

describe('export XML safety', () => {
  it('keeps Windows CRLF, legacy CR and whitespace-only paragraph separators', () => {
    for (const newline of ['\r\n', '\r', '\n']) {
      expect(proseParagraphs(`第一段${newline}段内${newline} \t${newline}第二段`)).toEqual(['第一段 段内', '第二段'])
    }
  })
  it('preserves paragraph boundaries in both DOCX and print HTML', () => {
    const input = { title: '书', language: 'zh-CN', createdIso: '2026-11-13T00:00:00Z', chapters: [{ chapterNumber: 1, title: '章', content: '首段\r\n\r\n尾段' }] }
    expect(buildPrintHtml(input)).toContain('<p class="body">首段</p><p class="body">尾段</p>')
    const xml = new TextDecoder().decode(buildDocx(input))
    expect(xml).toContain('首段</w:t></w:r></w:p><w:p>')
  })
  it('removes invalid XML scalars but keeps newlines, tabs, Chinese and emoji', () => {
    expect(escapeXmlText('中😀\t\n\r\u0000\u0001\uD800<&')).toBe('中😀\t\n\r&lt;&amp;')
  })
  it('escapes EPUB language attributes as well as body and metadata', () => {
    const xml = new TextDecoder().decode(buildEpub({ title: 'A\u0000书', language: 'en" onload="alert(1)', modifiedIso: '2026-11-13T00:00:00Z', chapters: [{ chapterNumber: 1, title: '章', content: '中\u0001😀' }] }))
    expect(xml).toContain('xml:lang="en&quot; onload=&quot;alert(1)"')
    expect(xml).not.toContain('xml:lang="en" onload=')
    expect(xml).toContain('中😀')
  })
  it('shares the character sanitization with DOCX export', () => {
    const xml = new TextDecoder().decode(buildDocx({ title: '书', language: 'zh-CN', createdIso: '2026-11-13T00:00:00Z', chapters: [{ chapterNumber: 1, title: '章', content: '中\u0001😀' }] }))
    expect(xml).toContain('中😀')
    expect(xml).not.toContain('中\u0001😀')
  })
})
