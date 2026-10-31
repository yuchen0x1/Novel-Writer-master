/**
 * 时间线：把"故事内时间"上发生的事件按线索（lane）排开，并与正文章节互相引用。
 *
 * 这里只放纯数据与校验，不碰文件与 IPC；主进程落盘与渲染层编辑共用同一套规则，
 * 保证手改过的 JSON 也不会把界面打崩。
 */

export const TIMELINE_VERSION = 1 as const
export const TIMELINE_MAX_EVENTS = 500
export const TIMELINE_MAX_LANES = 12
export const TIMELINE_MAX_TITLE = 120
export const TIMELINE_MAX_AT = 40
export const TIMELINE_MAX_DESCRIPTION = 2000

export interface TimelineEvent {
  id: string
  /** 线索名：主线、感情线、暗线……同一作品内自由命名。 */
  lane: string
  /** 故事内时间标签（自由文本，如「第 3 天·雨夜」「卷二·春」）。 */
  at: string
  title: string
  description?: string
  /** 关联的正文章号；0/缺省表示还没落到具体章节。 */
  chapterNumber?: number
}

export interface TimelineDocument {
  version: typeof TIMELINE_VERSION
  /** 线索顺序即泳道顺序。 */
  lanes: string[]
  events: TimelineEvent[]
}

export const EMPTY_TIMELINE: TimelineDocument = Object.freeze({
  version: TIMELINE_VERSION,
  lanes: [],
  events: [],
})

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const laneName = (value: unknown): string => text(value, 40) || '未命名线索'

/**
 * 宽松解析：非法条目丢弃、重复 id 丢弃、线索表补全、事件数封顶。
 * 返回的永远是可直接渲染的文档，不抛错——时间线坏掉不该让人打不开作品。
 */
export function parseTimeline(raw: unknown): TimelineDocument {
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_TIMELINE, lanes: [], events: [] }
  const record = raw as { lanes?: unknown; events?: unknown }
  const lanes: string[] = []
  if (Array.isArray(record.lanes)) {
    for (const lane of record.lanes) {
      const name = laneName(lane)
      if (!lanes.includes(name) && lanes.length < TIMELINE_MAX_LANES) lanes.push(name)
    }
  }

  const events: TimelineEvent[] = []
  const seen = new Set<string>()
  if (Array.isArray(record.events)) {
    for (const item of record.events) {
      if (typeof item !== 'object' || item === null) continue
      const source = item as Partial<TimelineEvent>
      const id = text(source.id, 64)
      const title = text(source.title, TIMELINE_MAX_TITLE)
      if (!id || seen.has(id) || !title) continue
      const lane = laneName(source.lane)
      if (!lanes.includes(lane)) {
        if (lanes.length >= TIMELINE_MAX_LANES) continue
        lanes.push(lane)
      }
      const chapterNumber = typeof source.chapterNumber === 'number'
        && Number.isInteger(source.chapterNumber) && source.chapterNumber > 0
        ? source.chapterNumber
        : undefined
      const description = text(source.description, TIMELINE_MAX_DESCRIPTION)
      seen.add(id)
      events.push({
        id,
        lane,
        at: text(source.at, TIMELINE_MAX_AT),
        title,
        ...(description ? { description } : {}),
        ...(chapterNumber ? { chapterNumber } : {}),
      })
      if (events.length >= TIMELINE_MAX_EVENTS) break
    }
  }
  return { version: TIMELINE_VERSION, lanes, events }
}

/** 事件的编辑序：按章号优先，其次按故事内时间文本，最后按标题。 */
export function sortTimelineEvents(events: readonly TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((left, right) => {
    const leftChapter = left.chapterNumber ?? Number.MAX_SAFE_INTEGER
    const rightChapter = right.chapterNumber ?? Number.MAX_SAFE_INTEGER
    if (leftChapter !== rightChapter) return leftChapter - rightChapter
    const byTime = left.at.localeCompare(right.at, 'zh-CN')
    if (byTime !== 0) return byTime
    return left.title.localeCompare(right.title, 'zh-CN')
  })
}

export function eventsByLane(document: TimelineDocument): Array<{ lane: string; events: TimelineEvent[] }> {
  const sorted = sortTimelineEvents(document.events)
  return document.lanes.map(lane => ({
    lane,
    events: sorted.filter(event => event.lane === lane),
  }))
}

/** 生成不与现有条目冲突的 id；时间线是本地单人编辑，不需要 uuid 依赖。 */
export function nextTimelineEventId(existing: readonly TimelineEvent[]): string {
  const used = new Set(existing.map(event => event.id))
  for (let index = 1; index <= TIMELINE_MAX_EVENTS + 1; index += 1) {
    const candidate = `evt-${index}`
    if (!used.has(candidate)) return candidate
  }
  return `evt-${Date.now()}`
}
