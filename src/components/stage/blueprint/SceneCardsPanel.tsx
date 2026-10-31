import { useId, useState } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'

import type { SceneCard } from '../../../shared/scene-cards'
import type { SceneCardInput } from './use-scene-cards'
import { useLocaleStore } from '../../../stores/locale-store'
import { Button } from '../../ui/Button'

interface SceneCardsPanelProps {
  chapterNumber: number
  scenes: readonly SceneCard[]
  saving: boolean
  error: string | null
  onSave: (scene: SceneCardInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

type Draft = Omit<SceneCard, 'id'>
const emptyDraft = (chapterNumber: number, order: number): Draft => ({
  chapterNumber, order, title: '', location: '', storyTime: '', participants: [], goal: '', conflict: '', transition: '', notes: '',
})

export default function SceneCardsPanel({ chapterNumber, scenes, saving, error, onSave, onDelete }: SceneCardsPanelProps) {
  const text = useLocaleStore(s => s.text)
  const [editing, setEditing] = useState<SceneCard | null>(null)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(chapterNumber, scenes.length + 1))
  const ids = { title: useId(), location: useId(), time: useId(), participants: useId(), goal: useId(), conflict: useId(), transition: useId(), notes: useId() }
  const activeId = editing?.id

  const startNew = () => {
    setEditing(null)
    setDraft(emptyDraft(chapterNumber, scenes.length + 1))
  }
  const startEdit = (scene: SceneCard) => {
    setEditing(scene)
    setDraft({ ...scene })
  }
  const submit = async () => {
    if (!draft.title.trim()) return
    await onSave({ ...draft, id: activeId })
    startNew()
  }

  return (
    <section className="stage-scene-panel" aria-label={text(`第 ${chapterNumber} 章场景卡`, `Scene cards for chapter ${chapterNumber}`)}>
      <div className="stage-scene-head">
        <div>
          <h2>{text('场景卡', 'Scene cards')}</h2>
          <p>{text('把一章拆成可执行的场景：地点、时间、人物、目标、冲突和转场。', 'Break the chapter into executable scenes: place, time, people, goal, conflict, and transition.')}</p>
          {error && <p className="stage-scene-error" role="alert">{error}</p>}
        </div>
        <Button variant="secondary" size="sm" onClick={startNew} disabled={saving}><Plus size={14} aria-hidden />{text('新建场景', 'New scene')}</Button>
      </div>

      {scenes.length === 0 && <p className="stage-scene-empty">{text('本章还没有场景卡。', 'No scene cards for this chapter yet.')}</p>}
      <div className="stage-scene-list">
        {scenes.map(scene => (
          <article key={scene.id} className="stage-scene-item">
            <div className="stage-scene-item-head">
              <span className="stage-scene-order">{scene.order}</span>
              <div><h3>{scene.title}</h3><p>{[scene.location, scene.storyTime].filter(Boolean).join(' · ')}</p></div>
              <span className="stage-scene-spacer" />
              <Button variant="text" size="sm" onClick={() => startEdit(scene)}>{text('编辑', 'Edit')}</Button>
              <Button variant="icon" size="sm" aria-label={text(`删除场景 ${scene.title}`, `Delete scene ${scene.title}`)} title={text('删除场景', 'Delete scene')} onClick={() => void onDelete(scene.id)}><Trash2 size={14} aria-hidden /></Button>
            </div>
            <dl className="stage-scene-facts">
              {scene.participants.length > 0 && <><dt>{text('人物', 'People')}</dt><dd>{scene.participants.join('、')}</dd></>}
              {scene.goal && <><dt>{text('目标', 'Goal')}</dt><dd>{scene.goal}</dd></>}
              {scene.conflict && <><dt>{text('冲突', 'Conflict')}</dt><dd>{scene.conflict}</dd></>}
              {scene.transition && <><dt>{text('转场', 'Transition')}</dt><dd>{scene.transition}</dd></>}
            </dl>
          </article>
        ))}
      </div>

      <div className="stage-scene-editor" data-active={activeId || undefined}>
        <div className="stage-scene-editor-head"><h3>{activeId ? text('编辑场景', 'Edit scene') : text('新场景', 'New scene')}</h3>{activeId && <Button variant="icon" size="sm" aria-label={text('取消编辑场景', 'Cancel scene editing')} title={text('取消', 'Cancel')} onClick={startNew}><X size={14} aria-hidden /></Button>}</div>
        <div className="stage-scene-grid">
          <label htmlFor={ids.title}>{text('场景标题', 'Scene title')}<input id={ids.title} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></label>
          <label htmlFor={ids.location}>{text('地点', 'Location')}<input id={ids.location} value={draft.location} onChange={event => setDraft({ ...draft, location: event.target.value })} /></label>
          <label htmlFor={ids.time}>{text('故事时间', 'Story time')}<input id={ids.time} value={draft.storyTime} onChange={event => setDraft({ ...draft, storyTime: event.target.value })} /></label>
          <label htmlFor={ids.participants}>{text('出场人物', 'Participants')}<input id={ids.participants} value={draft.participants.join('、')} onChange={event => setDraft({ ...draft, participants: event.target.value.split(/[,，、\s]+/u) })} /></label>
          <label htmlFor={ids.goal}>{text('场景目标', 'Scene goal')}<textarea id={ids.goal} rows={2} value={draft.goal} onChange={event => setDraft({ ...draft, goal: event.target.value })} /></label>
          <label htmlFor={ids.conflict}>{text('冲突', 'Conflict')}<textarea id={ids.conflict} rows={2} value={draft.conflict} onChange={event => setDraft({ ...draft, conflict: event.target.value })} /></label>
          <label htmlFor={ids.transition}>{text('转场', 'Transition')}<textarea id={ids.transition} rows={2} value={draft.transition} onChange={event => setDraft({ ...draft, transition: event.target.value })} /></label>
          <label htmlFor={ids.notes}>{text('备注', 'Notes')}<textarea id={ids.notes} rows={2} value={draft.notes} onChange={event => setDraft({ ...draft, notes: event.target.value })} /></label>
        </div>
        <Button variant="primary" size="sm" disabled={saving || !draft.title.trim()} onClick={() => void submit()}><Save size={14} aria-hidden />{saving ? text('保存中…', 'Saving…') : activeId ? text('保存场景', 'Save scene') : text('添加场景', 'Add scene')}</Button>
      </div>
    </section>
  )
}
