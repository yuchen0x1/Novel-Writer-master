import { useEffect, useMemo, useState } from 'react'

import type { WikilinkEntry } from './wikilink'
import { ipc } from '../../services/ipc-client'
import { projectSessionContextFromProject } from '../../shared/project-session-context'
import { worldSettingHeadings } from '../../services/workflows/lorebook-triggers'
import { useLocaleStore } from '../../stores/locale-store'
import { useProjectStore } from '../../stores/project-store'

/**
 * 构建 [[ ]] 双向链接候选词条：角色（名册姓名 + 别名 + 一行速览摘要）
 * 与世界观设定（novelConfig.worldSetting 的二至四级标题词条，kind=setting）。
 */
export function useWikilinkEntries(projectKey: string): readonly WikilinkEntry[] {
  const project = useProjectStore(s => s.currentProject)
  const worldSetting = useProjectStore(s => s.currentProject?.novelConfig?.worldSetting)
  const locale = useLocaleStore(s => s.locale)

  // 世界观设定词条不依赖名册请求，直接从项目配置解析（派生值，无 effect 同步写状态）。
  const settingEntries = useMemo(() => worldSettingHeadings(worldSetting)
    .map(section => ({
      name: section.title,
      summary: section.body,
      kind: 'setting' as const,
    })), [worldSetting])

  // 名册角色词条异步加载；加载键与当前项目对不上时按未加载处理。
  const [rosterLoaded, setRosterLoaded] = useState<{ key: string; entries: readonly WikilinkEntry[] } | null>(null)

  useEffect(() => {
    const session = projectSessionContextFromProject(project)
    if (!session || session.projectPath !== projectKey) return
    let cancelled = false
    void ipc.invokeWithProjectSession(session, 'db:character-roster-read', session.projectPath)
      .then(roster => {
        if (cancelled) return
        const built: WikilinkEntry[] = []
        if (roster && (roster.status === 'ready' || roster.status === 'empty')) {
          const aliasByCharacterId = new Map<string, string[]>()
          for (const alias of roster.aliases ?? []) {
            if (!alias.characterId || !alias.name?.trim()) continue
            const list = aliasByCharacterId.get(alias.characterId) ?? []
            list.push(alias.name.trim())
            aliasByCharacterId.set(alias.characterId, list)
          }
          for (const card of roster.entries) {
            if (!card.name?.trim()) continue
            const summaryParts = [
              card.role && locale === 'zh-CN' ? `定位：${card.role}` : card.role ? `Role: ${card.role}` : '',
              card.personality?.trim(),
              card.abilities?.trim(),
              card.currentState?.powerLevel?.trim(),
            ].filter(Boolean)
            built.push({
              name: card.name.trim(),
              aliases: aliasByCharacterId.get(card.characterId ?? '') ?? [],
              summary: summaryParts.slice(0, 3).join(locale === 'zh-CN' ? ' ｜ ' : ' | '),
              kind: 'character',
            })
          }
        }
        setRosterLoaded({ key: projectKey, entries: built })
      })
      .catch(() => {
        // 名册读不出时保留世界观词条即可，不必提示
        if (!cancelled) setRosterLoaded({ key: projectKey, entries: [] })
      })
    return () => { cancelled = true }
  }, [project, projectKey, locale])

  return useMemo(() => (
    rosterLoaded && rosterLoaded.key === projectKey
      ? [...settingEntries, ...rosterLoaded.entries]
      : settingEntries
  ), [rosterLoaded, settingEntries, projectKey])
}
