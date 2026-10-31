import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { displayedErrorMessage } from '../../../i18n/app-errors'
import { ipc } from '../../../services/ipc-client'
import { projectSessionContextFromProject } from '../../../shared/project-session-context'
import {
  eventsByLane,
  nextTimelineEventId,
  parseTimeline,
  type TimelineDocument,
  type TimelineEvent,
} from '../../../shared/timeline'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'

interface Draft {
  id?: string
  lane: string
  at: string
  title: string
  chapterNumber: string
  description: string
}

const EMPTY_DRAFT: Draft = { lane: '', at: '', title: '', chapterNumber: '', description: '' }

/** 时间线：按线索（泳道）编排故事内事件，事件可关联正文章号。 */
export default function StageTimeline() {
  const text = useLocaleStore(s => s.text)
  const project = useProjectStore(s => s.currentProject)
  const sessionLease = project?.sessionLease

  const [loaded, setLoaded] = useState<{ lease?: string; doc: TimelineDocument } | null>(null)
  const [failure, setFailure] = useState<{ lease?: string; message: string } | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [newLane, setNewLane] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef<TimelineDocument | null>(null)

  const session = useMemo(() => projectSessionContextFromProject(project), [project])
  const document = loaded && loaded.lease === sessionLease ? loaded.doc : null
  const message = failure && failure.lease === sessionLease ? failure.message : null

  useEffect(() => {
    if (!session) return
    let cancelled = false
    ipc.invokeWithProjectSession(session, 'timeline:read', session.projectPath)
      .then((value: TimelineDocument) => {
        if (cancelled) return
        const parsed = parseTimeline(value)
        latest.current = parsed
        setLoaded({ lease: session.leaseId, doc: parsed })
        setDraft(current => ({ ...current, lane: current.lane || parsed.lanes[0] || '' }))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setFailure({ lease: session.leaseId, message: displayedErrorMessage(useLocaleStore.getState().locale, error) })
      })
    return () => { cancelled = true }
  }, [session])

  const persist = useCallback((next: TimelineDocument) => {
    if (!session) return
    latest.current = next
    setLoaded({ lease: session.leaseId, doc: next })
    setStatus('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void ipc.invokeWithProjectSession(session, 'timeline:save', next, session.projectPath)
        .then((saved: TimelineDocument) => {
          const parsed = parseTimeline(saved)
          latest.current = parsed
          setLoaded({ lease: session.leaseId, doc: parsed })
          setStatus('saved')
        })
        .catch((error: unknown) => {
          setStatus('error')
          setFailure({ lease: session.leaseId, message: displayedErrorMessage(useLocaleStore.getState().locale, error) })
        })
    }, 400)
  }, [session])

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    // 卸载前把最后一次改动补发出去；会话已失效时主进程会拒绝，属于预期。
    const pending = latest.current
    if (pending && session) {
      void ipc.invokeWithProjectSession(session, 'timeline:save', pending, session.projectPath).catch(() => {})
    }
  }, [session])

  const lanes = document?.lanes ?? []
  const groups = useMemo(() => (document ? eventsByLane(document) : []), [document])

  const resetDraft = () => setDraft({ ...EMPTY_DRAFT, lane: lanes[0] ?? '' })

  const submit = () => {
    const title = draft.title.trim()
    if (!title || !document) return
    const lane = (newLane.trim() || draft.lane.trim() || lanes[0] || text('主线', 'Main line')).slice(0, 40)
    const chapterNumber = Number.parseInt(draft.chapterNumber, 10)
    const laneDraft = lane || '主线'
    const event: TimelineEvent = {
      id: draft.id ?? nextTimelineEventId(document.events),
      lane: laneDraft,
      at: draft.at.trim().slice(0, 40),
      title: title.slice(0, 120),
      ...(draft.description.trim() ? { description: draft.description.trim().slice(0, 2000) } : {}),
      ...(Number.isInteger(chapterNumber) && chapterNumber > 0 ? { chapterNumber } : {}),
    }
    const events = draft.id
      ? document.events.map(item => (item.id === draft.id ? event : item))
      : [...document.events, event]
    const nextLanes = document.lanes.includes(laneDraft) ? document.lanes : [...document.lanes, laneDraft]
    persist(parseTimeline({ lanes: nextLanes, events }))
    setDraft({ ...EMPTY_DRAFT, lane: laneDraft })
    setNewLane('')
  }

  const edit = (event: TimelineEvent) => {
    setDraft({
      id: event.id,
      lane: event.lane,
      at: event.at,
      title: event.title,
      chapterNumber: event.chapterNumber ? String(event.chapterNumber) : '',
      description: event.description ?? '',
    })
  }

  const remove = (event: TimelineEvent) => {
    if (!document) return
    persist(parseTimeline({ lanes: document.lanes, events: document.events.filter(item => item.id !== event.id) }))
    if (draft.id === event.id) resetDraft()
  }

  if (!session) {
    return <div className="stage-timeline stage-timeline-empty">{text('打开一部作品后可以编排时间线。', 'Open a book to lay out its timeline.')}</div>
  }

  return (
    <div className="stage-timeline">
      <header className="stage-timeline-head">
        <div>
          <h2 className="stage-timeline-title">{text('时间线', 'Timeline')}</h2>
          <p className="stage-timeline-hint">
            {text('把故事内的事件按线索排开；可关联正文章号，方便回看事件发生在哪一章。', 'Lay out in-story events by thread and link them to chapters.')}
          </p>
        </div>
        <span className="stage-timeline-status" data-status={status} role="status">
          {status === 'saving' ? text('保存中…', 'Saving…')
            : status === 'saved' ? text('已保存', 'Saved')
              : status === 'error' ? text('保存失败', 'Save failed')
                : ''}
        </span>
      </header>

      {message && <p className="stage-timeline-failed" role="alert">{message}</p>}

      <form
        className="stage-timeline-form"
        onSubmit={event => { event.preventDefault(); submit() }}
      >
        <input
          aria-label={text('事件标题', 'Event title')}
          placeholder={text('事件标题，例如「港口失火」', 'Event title, e.g. “The harbour fire”')}
          value={draft.title}
          onChange={event => setDraft({ ...draft, title: event.target.value })}
        />
        <input
          aria-label={text('故事内时间', 'In-story time')}
          placeholder={text('时间，例如「第 3 天·雨夜」', 'Time, e.g. “Day 3, rainy night”')}
          value={draft.at}
          onChange={event => setDraft({ ...draft, at: event.target.value })}
        />
        <select
          aria-label={text('线索', 'Thread')}
          value={draft.lane}
          onChange={event => { setDraft({ ...draft, lane: event.target.value }); setNewLane('') }}
        >
          {lanes.map(lane => <option key={lane} value={lane}>{lane}</option>)}
        </select>
        <input
          aria-label={text('新线索名', 'New thread name')}
          placeholder={text('或新建线索', 'or a new thread')}
          value={newLane}
          onChange={event => setNewLane(event.target.value)}
        />
        <input
          aria-label={text('关联章号', 'Chapter number')}
          placeholder={text('章号', 'Ch.')}
          inputMode="numeric"
          value={draft.chapterNumber}
          onChange={event => setDraft({ ...draft, chapterNumber: event.target.value.replace(/[^\d]/g, '') })}
        />
        <button type="submit" disabled={!draft.title.trim()}>
          {draft.id ? text('更新事件', 'Update event') : text('添加事件', 'Add event')}
        </button>
        {draft.id && (
          <button type="button" onClick={resetDraft}>{text('取消编辑', 'Cancel')}</button>
        )}
      </form>

      {(document?.events.length ?? 0) === 0 ? (
        <p className="stage-timeline-empty">{text('还没有事件。先加一条，泳道会随线索自动出现。', 'No events yet. Add one and its thread becomes a lane.')}</p>
      ) : (
        <div className="stage-timeline-board">
          {groups.map(group => (
            <section key={group.lane} className="stage-timeline-lane" aria-label={group.lane}>
              <h3 className="stage-timeline-lane-title">{group.lane}</h3>
              <ol className="stage-timeline-events">
                {group.events.map(event => (
                  <li key={event.id} className="stage-timeline-event">
                    <div className="stage-timeline-event-head">
                      {event.at && <span className="stage-timeline-at">{event.at}</span>}
                      {event.chapterNumber && (
                        <span className="stage-timeline-chapter">{text(`第 ${event.chapterNumber} 章`, `Ch. ${event.chapterNumber}`)}</span>
                      )}
                    </div>
                    <p className="stage-timeline-event-title">{event.title}</p>
                    {event.description && <p className="stage-timeline-event-desc">{event.description}</p>}
                    <div className="stage-timeline-event-actions">
                      <button type="button" onClick={() => edit(event)}>{text('编辑', 'Edit')}</button>
                      <button type="button" onClick={() => remove(event)}>{text('删除', 'Delete')}</button>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
