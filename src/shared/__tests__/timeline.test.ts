import { describe, expect, it } from 'vitest'

import {
  eventsByLane,
  nextTimelineEventId,
  parseTimeline,
  sortTimelineEvents,
  TIMELINE_MAX_LANES,
  type TimelineEvent,
} from '../timeline'

const event = (overrides: Partial<TimelineEvent> = {}): TimelineEvent => ({
  id: 'evt-1',
  lane: '主线',
  at: '',
  title: '事件',
  ...overrides,
})

describe('时间线解析', () => {
  it('接受合法文档并补全线索表', () => {
    const doc = parseTimeline({
      lanes: ['主线'],
      events: [{ id: 'e1', lane: '感情线', title: '初见', at: '第 1 天' }],
    })
    expect(doc.events).toHaveLength(1)
    expect(doc.lanes).toEqual(['主线', '感情线'])
    expect(doc.version).toBe(1)
  })

  it('丢弃无标题、重复 id 与非法章号', () => {
    const doc = parseTimeline({
      lanes: [],
      events: [
        { id: 'e1', lane: '主线', title: '保留' },
        { id: 'e1', lane: '主线', title: '重复 id' },
        { id: '', lane: '主线', title: '无 id' },
        { id: 'e2', lane: '主线', title: '   ' },
        { id: 'e3', lane: '主线', title: '章号', chapterNumber: -3 },
        { id: 'e4', lane: '主线', title: '章号', chapterNumber: 2.5 },
      ],
    })
    // 非法章号只是丢字段，事件本身仍然保留。
    expect(doc.events.map(item => item.id)).toEqual(['e1', 'e3', 'e4'])
    expect(doc.events.find(item => item.id === 'e3')?.chapterNumber).toBeUndefined()
    expect(doc.events.find(item => item.id === 'e4')?.chapterNumber).toBeUndefined()
  })

  it('字段超长被截断而不是整条丢弃', () => {
    const doc = parseTimeline({ events: [{ id: 'e1', lane: '主线', title: 'x'.repeat(400), at: 'y'.repeat(100) }] })
    expect(doc.events[0].title).toHaveLength(120)
    expect(doc.events[0].at).toHaveLength(40)
  })

  it('线索数封顶，超出的线索不丢事件但要丢掉新线索', () => {
    const events = Array.from({ length: TIMELINE_MAX_LANES + 3 }, (_, index) => ({
      id: `e${index}`, lane: `线${index}`, title: 't',
    }))
    const doc = parseTimeline({ events })
    expect(doc.lanes).toHaveLength(TIMELINE_MAX_LANES)
    expect(doc.events.length).toBeLessThanOrEqual(TIMELINE_MAX_LANES)
  })

  it('非对象输入返回空文档', () => {
    expect(parseTimeline(null).events).toEqual([])
    expect(parseTimeline('nope').lanes).toEqual([])
  })
})

describe('排序与分组', () => {
  it('先按章号、再按故事内时间、最后按标题', () => {
    const sorted = sortTimelineEvents([
      event({ id: 'c', title: 'B', chapterNumber: 2 }),
      event({ id: 'a', title: '后', at: '第 9 天', chapterNumber: 1 }),
      event({ id: 'b', title: '前', at: '第 1 天', chapterNumber: 1 }),
      event({ id: 'z', title: '未落章' }),
    ])
    expect(sorted.map(item => item.id)).toEqual(['b', 'a', 'c', 'z'])
  })

  it('没有章号的事件排在最后', () => {
    const sorted = sortTimelineEvents([event({ id: 'no-chapter' }), event({ id: 'ch', chapterNumber: 1 })])
    expect(sorted[0].id).toBe('ch')
  })

  it('按线索分组保持线索顺序', () => {
    const groups = eventsByLane({
      version: 1,
      lanes: ['主线', '感情线'],
      events: [event({ id: 'a', lane: '感情线' }), event({ id: 'b', lane: '主线' })],
    })
    expect(groups.map(group => group.lane)).toEqual(['主线', '感情线'])
    expect(groups[1].events[0].id).toBe('a')
  })
})

describe('事件 id', () => {
  it('避开已占用的序号', () => {
    expect(nextTimelineEventId([])).toBe('evt-1')
    expect(nextTimelineEventId([event({ id: 'evt-1' }), event({ id: 'evt-2' })])).toBe('evt-3')
  })
})

