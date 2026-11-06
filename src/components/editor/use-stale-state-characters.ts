import { useEffect, useMemo, useState } from 'react'

import { CHARACTER_STATE_TEXT_FIELDS, type CharacterStateTextField } from '../../shared/character-roster'
import { ipc } from '../../services/ipc-client'
import { projectSessionContextFromProject } from '../../shared/project-session-context'
import { useProjectStore } from '../../stores/project-store'

/** 角色某项动态状态停留在早前章节、而本章蓝图还要他出场：写作前值得核对。 */
export interface StaleStateCharacter {
  name: string
  /** 状态最后确认的章节号（取各字段 provenance 的最大值）。 */
  lastChapter: number
  /** 停留在 lastChapter 的字段（战力/伤势/位置等）。 */
  fields: readonly CharacterStateTextField[]
}

/**
 * 找出「本章蓝图出场、但动态状态停更在更早章节」的角色。
 * 只统计 provenance=author 的字段（作者亲自确认过的状态）；无 provenance 的旧档案不算陈旧。
 */
export function useStaleStateCharacters(
  projectKey: string,
  chapterNumber: number | undefined,
  cast: readonly string[],
): readonly StaleStateCharacter[] {
  const project = useProjectStore(s => s.currentProject)
  const [roster, setRoster] = useState<{ status: string; entries: Array<{
    name: string
    currentState?: {
      provenance?: Partial<Record<CharacterStateTextField, { kind: string; chapterNumber?: number }>>
    }
  }> } | null>(null)

  useEffect(() => {
    const session = projectSessionContextFromProject(project)
    if (!session || session.projectPath !== projectKey) return
    let cancelled = false
    void ipc.invokeWithProjectSession(session, 'db:character-roster-read', session.projectPath)
      .then(value => {
        if (cancelled) return
        if (value && (value.status === 'ready' || value.status === 'empty')) setRoster(value)
      })
      .catch(() => { /* 名册读不出时不提示陈旧状态，不打断写作 */ })
    return () => { cancelled = true }
  }, [project, projectKey])

  return useMemo(() => {
    if (!roster || chapterNumber === undefined || cast.length === 0) return []
    const wanted = new Set(cast.map(name => name.trim()).filter(Boolean))
    const stale: StaleStateCharacter[] = []
    for (const card of roster.entries) {
      if (!wanted.has(card.name?.trim() ?? '')) continue
      const fields: CharacterStateTextField[] = []
      let lastChapter = 0
      for (const field of CHARACTER_STATE_TEXT_FIELDS) {
        const provenance = card.currentState?.provenance?.[field]
        if (provenance?.kind !== 'author' || typeof provenance.chapterNumber !== 'number') continue
        if (provenance.chapterNumber < chapterNumber) {
          fields.push(field)
          lastChapter = Math.max(lastChapter, provenance.chapterNumber)
        }
      }
      if (fields.length > 0) stale.push({ name: card.name.trim(), lastChapter, fields })
    }
    return stale
  }, [roster, chapterNumber, cast])
}
