import type { CharacterRosterSnapshot } from '../../shared/character-roster'

export interface LorebookTriggerRule {
  /** 实体标识名称，如角色名、道具名、地名、势力名 */
  name: string
  /** 触发关键词列表，命中任意一个即激活 */
  keywords: string[]
  /** 注入提示词中的摘要/设定内容 */
  content: string
  /** 触发类型 */
  type: 'character' | 'setting' | 'item'
}

/**
 * 从角色名册和世界观设定中提取硬规则触发器字典
 */
export function buildLorebookRules(
  roster: CharacterRosterSnapshot | null,
  worldSetting?: string,
): LorebookTriggerRule[] {
  const rules: LorebookTriggerRule[] = []

  if (roster && Array.isArray(roster.entries)) {
    for (const card of roster.entries) {
      if (!card.name?.trim()) continue
      const name = card.name.trim()
      const keywords = new Set<string>([name])
      
      // 提取 aliases 别名
      if (roster.aliases && card.characterId) {
        for (const alias of roster.aliases) {
          if (alias.characterId === card.characterId && alias.name?.trim()) {
            keywords.add(alias.name.trim())
          }
        }
      }

      // 从 notes 中如果标明了别名或触发词（如 "别名：小舟，舟哥" 或 "触发词: 灵剑"）
      if (card.notes) {
        const aliasMatch = /(?:别名|又名|触发词|绰号)[：:]\s*([^\n\r]+)/u.exec(card.notes)
        if (aliasMatch?.[1]) {
          const extra = aliasMatch[1].split(/[,，、\s]+/u).map(s => s.trim()).filter(Boolean)
          for (const k of extra) keywords.add(k)
        }
      }

      // 构建设定摘要内容
      const summaryParts = [
        card.role ? `身份/定位: ${card.role}` : null,
        card.personality ? `性格: ${card.personality}` : null,
        card.abilities ? `能力/功法: ${card.abilities}` : null,
        card.currentState?.powerLevel ? `当前境界/战力: ${card.currentState.powerLevel}` : null,
        card.currentState?.keyItems ? `随身法宝/道具: ${card.currentState.keyItems}` : null,
        card.currentState?.physicalState ? `生理状态: ${card.currentState.physicalState}` : null,
        card.currentState?.location ? `当前所在: ${card.currentState.location}` : null,
      ].filter(Boolean)

      rules.push({
        name,
        type: 'character',
        keywords: Array.from(keywords),
        content: summaryParts.length > 0 ? summaryParts.join(' | ') : (card.background || card.notes || '角色档案'),
      })
    }
  }

  // 从世界观设定 (worldSetting) 中按 Markdown 标题或分段尝试提取词条
  for (const section of worldSettingHeadings(worldSetting)) {
    rules.push({
      name: section.title,
      type: 'setting',
      keywords: [section.title],
      content: section.body,
    })
  }

  return rules
}

/** 世界观设定里的词条：二级到四级标题 + 该节正文（供触发器与 [[ ]] 链接候选共用）。 */
export function worldSettingHeadings(worldSetting?: string): Array<{ title: string; body: string }> {
  const entries: Array<{ title: string; body: string }> = []
  if (!worldSetting || typeof worldSetting !== 'string') return entries
  const sections = worldSetting.split(/(?=^#{2,4}\s+)/mu)
  for (const sec of sections) {
    const match = /^#{2,4}\s+([^\n\r]+)/u.exec(sec)
    if (match?.[1]) {
      const title = match[1].trim()
      if (title.length >= 2 && title.length <= 25) {
        const body = sec.slice(match[0].length).trim()
        if (body) {
          entries.push({ title, body: body.slice(0, 300) })
        }
      }
    }
  }
  return entries
}

/**
 * 扫描当前写作上下文文本（蓝图计划、上一章结尾、用户微操等），匹配触发激活的硬规则词条
 */
export function scanActivatedLorebookEntries(
  contextText: string,
  rules: LorebookTriggerRule[],
  alreadyIncludedNames: Set<string> = new Set(),
): LorebookTriggerRule[] {
  if (!contextText || rules.length === 0) return []
  const activated: LorebookTriggerRule[] = []

  for (const rule of rules) {
    if (alreadyIncludedNames.has(rule.name)) continue
    const matched = rule.keywords.some(keyword => {
      if (!keyword || keyword.length < 2) return false
      return contextText.includes(keyword)
    })
    if (matched) {
      activated.push(rule)
    }
  }

  return activated
}

/**
 * 渲染被激活的硬规则提示词块
 */
export function renderActivatedLorebookPrompt(
  activatedRules: LorebookTriggerRule[],
  writingLanguage: 'zh-CN' | 'en-US' = 'zh-CN',
): string {
  if (activatedRules.length === 0) return ''
  const isZh = writingLanguage === 'zh-CN'
  const header = isZh
    ? '【上下文硬规则约束（设定触发器命中）】\n检测到本章情节触发了以下关键角色/设定/世界观，创作中必须严格遵守其状态与设定：'
    : '[Activated Codex Constraints / Lorebook Triggers]\nThe following character/world entities were triggered by this chapter context. Maintain strict consistency with their established state:'

  const entries = activatedRules.map(r => `- [${r.name}] (${r.type}): ${r.content}`)
  return `${header}\n${entries.join('\n')}`
}
