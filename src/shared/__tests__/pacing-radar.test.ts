import { describe, expect, it } from 'vitest'
import {
  analyzeChapterPacing,
  detectEndingHook,
  detectContinuityJumps,
  extractDialogueText,
} from '../pacing-radar'

describe('pacing-radar', () => {
  it('extracts dialogue wrapped in CJK quotes', () => {
    const text = '他说：「今天风很大。」然后走了。'
    expect(extractDialogueText(text)).toContain('今天风很大')
  })

  it('computes dialogue ratio and long-paragraph ratio', () => {
    const longPara = '描写'.repeat(120) // 240 chars, > 220 => long
    const text = [
      longPara,
      '「你来了。」她说。',
      '「我不来谁来。」他答。',
      '短段。',
    ].join('\n')
    const metrics = analyzeChapterPacing(text)

    expect(metrics.paragraphCount).toBe(4)
    expect(metrics.longParagraphRatio).toBeCloseTo(0.25, 5)
    expect(metrics.dialogueTurns).toBe(2)
    expect(metrics.dialogueCharRatio).toBeGreaterThan(0)
    expect(metrics.dialogueCharRatio).toBeLessThan(1)
    expect(metrics.charCount).toBeGreaterThan(0)
  })

  it('detects strong ending hooks', () => {
    const strong = '他推开门，屋里空无一人。桌上却放着一封没有署名的信。是谁送来的？'
    expect(detectEndingHook(strong).verdict).toBe('strong')

    const weak = '他笑了笑，转身离去。可是这一次，他没有回头。'
    expect(detectEndingHook(weak).verdict).toBe('weak')

    const flat = '吃完饭，他洗碗，然后上床睡觉，很快就睡着了。'
    expect(detectEndingHook(flat).verdict).toBe('none')
  })

  it('reports narration ratio complement of dialogue ratio', () => {
    const text = '「好。」'
    const metrics = analyzeChapterPacing(text)
    expect(metrics.dialogueCharRatio).toBeCloseTo(1, 5)
    expect(metrics.narrationRatio).toBeCloseTo(0, 5)
  })

  it('detects continuity jumps between chapters', () => {
    const jumps = detectContinuityJumps(
      { powerLevel: '筑基初期', physicalState: '轻伤', location: '海港哨站' },
      { powerLevel: '练气巅峰', physicalState: '轻伤', location: '海港哨站' },
    )
    expect(jumps).toHaveLength(1)
    expect(jumps[0]).toMatchObject({ field: 'powerLevel', previous: '筑基初期', current: '练气巅峰', suspicious: true })

    expect(detectContinuityJumps(null, null)).toHaveLength(0)
  })
})
