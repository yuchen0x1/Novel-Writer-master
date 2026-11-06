import { describe, expect, it } from 'vitest'
import {
  buildLorebookRules,
  scanActivatedLorebookEntries,
  renderActivatedLorebookPrompt,
} from '../lorebook-triggers'
import type { CharacterRosterSnapshot } from '../../../shared/character-roster'

describe('lorebook-triggers', () => {
  const fixtureRoster: CharacterRosterSnapshot = {
    schemaVersion: 1,
    revision: 1,
    migrationState: 'ready',
    status: 'ready',
    entries: [
      {
        characterId: 'char-1',
        name: '林岚',
        role: 'protagonist',
        gender: '男',
        age: '22',
        appearance: '身穿黑袍',
        personality: '沉着冷静',
        background: '孤儿',
        abilities: '太虚剑意',
        motivation: '寻找真相',
        relationships: [],
        arc: '',
        notes: '别名：小岚，剑客',
        currentState: {
          location: '海港哨站',
          powerLevel: '筑基初期',
          physicalState: '轻伤',
          mentalState: '警惕',
          keyItems: '断水剑',
          recentEvents: '击退海兽',
          updatedAtChapter: 2,
        },
      },
      {
        characterId: 'char-2',
        name: '九幽老祖',
        role: 'antagonist',
        gender: '男',
        age: '800',
        appearance: '白发如雪',
        personality: '阴鸷',
        background: '魔宗老祖',
        abilities: '幽冥鬼爪',
        motivation: '夺舍重生',
        relationships: [],
        arc: '',
        notes: '',
      },
    ],
    renderedMarkdown: '',
    projectionHash: 'mock',
    factHash: 'mock',
    nameOnlyFactHash: 'mock',
  }

  const worldSetting = `
### 宗门与势力
正道以青云宗为首。

### 斩龙台
位于海港东部八十里的悬崖上，有上古封魔阵法。
`

  it('builds trigger rules from roster and world setting markdown', () => {
    const rules = buildLorebookRules(fixtureRoster, worldSetting)
    expect(rules.length).toBeGreaterThanOrEqual(3)

    const linlan = rules.find(r => r.name === '林岚')
    expect(linlan).toBeDefined()
    expect(linlan?.keywords).toContain('林岚')
    expect(linlan?.keywords).toContain('小岚')
    expect(linlan?.keywords).toContain('剑客')
    expect(linlan?.content).toContain('太虚剑意')
    expect(linlan?.content).toContain('筑基初期')

    const zhanlong = rules.find(r => r.name === '斩龙台')
    expect(zhanlong).toBeDefined()
    expect(zhanlong?.type).toBe('setting')
    expect(zhanlong?.content).toContain('上古封魔阵法')
  })

  it('scans and activates rules when keyword appears in context text', () => {
    const rules = buildLorebookRules(fixtureRoster, worldSetting)

    // Context text mentions "斩龙台" and "剑客" (trigger for 林岚)
    const context = '本章主角前往斩龙台调查海啸异动，路上遇到了剑客的故人。'
    const activated = scanActivatedLorebookEntries(context, rules)

    expect(activated.some(a => a.name === '斩龙台')).toBe(true)
    expect(activated.some(a => a.name === '林岚')).toBe(true)
    expect(activated.some(a => a.name === '九幽老祖')).toBe(false)
  })

  it('renders prompt text cleanly with language support', () => {
    const rules = buildLorebookRules(fixtureRoster, worldSetting)
    const context = '九幽老祖突然现身于斩龙台之上。'
    const activated = scanActivatedLorebookEntries(context, rules)

    const renderedZh = renderActivatedLorebookPrompt(activated, 'zh-CN')
    expect(renderedZh).toContain('【上下文硬规则约束（设定触发器命中）】')
    expect(renderedZh).toContain('九幽老祖')
    expect(renderedZh).toContain('斩龙台')

    const renderedEn = renderActivatedLorebookPrompt(activated, 'en-US')
    expect(renderedEn).toContain('[Activated Codex Constraints / Lorebook Triggers]')
  })
})
