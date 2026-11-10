import { useEffect, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import type { DraftMeta } from '../../../services/draft-index'
import { displayedErrorMessage } from '../../../i18n/app-errors'
import { sameProjectSessionContext } from '../../../shared/project-session-context'
import { countDraftUnits } from '../../../shared/draft-units'
import type { DraftSnapshotMeta } from '../../../shared/draft-snapshot'
import { sqliteTime } from '../../../shared/sqlite-time'
import { useDraftStore } from '../../../stores/draft-store'
import { useEditorStore, type EditorTab } from '../../../stores/editor-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../../project-session-gate'
import { ipc } from '../../../services/ipc-client'
import { Button } from '../../ui/Button'
import { toast } from '../../ui/Toast'
import { useAnchoredLayer } from '../../ui/use-anchored-layer'
import { InkDialog } from '../InkDialog'
import { openDraftInChapterView, swapChapterTab } from './chapter-tab-routing'
import { pluralEn } from '../../../shared/plural-en'

type Text = (zh: string, en: string) => string

function versionName(draft: DraftMeta, text: Text): string {
  if (draft.status === 'finalized') return text(`定稿 v${draft.version}`, `Final v${draft.version}`)
  if (draft.status === 'archived') return text(`已归档 v${draft.version}`, `Archived v${draft.version}`)
  if (draft.status === 'revised') return text(`修稿已合并 v${draft.version}`, `Revised v${draft.version}`)
  return text(`草稿 v${draft.version}`, `Draft v${draft.version}`)
}

/**
 * 章节标题旁的版本切换器：列出这一章的各稿，已归档的收在「显示已归档」后面。
 * 选中另一稿时在当前标签的位置换上那一稿；这一稿有未保存的修改时先问作者保存还是放弃，不会静默丢掉。
 */
export default function VersionSwitcher({ tab, current, label, title, onSave }: {
  tab: EditorTab
  current: DraftMeta
  label: string
  title: string
  /** 保存这一稿的修改；失败时抛出，切换随之取消。 */
  onSave: () => Promise<void>
}) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const project = useProjectStore(s => s.currentProject)
  const draftSession = useDraftStore(s => s.dataProjectSession)
  const chapterDrafts = useDraftStore(s => s.draftsByChapter[current.chapterNumber])
  const { open, layerId, anchorRef, triggerRef, layerRef, renderLayer, toggle, close } = useAnchoredLayer('end')
  const [showArchived, setShowArchived] = useState(current.status === 'archived')
  const [pending, setPending] = useState<DraftMeta | null>(null)
  const [snapshots, setSnapshots] = useState<DraftSnapshotMeta[] | null>(null)
  const [snapshotsFailed, setSnapshotsFailed] = useState(false)
  const [restoring, setRestoring] = useState<DraftSnapshotMeta | null>(null)
  const [busy, setBusy] = useState(false)

  const session = captureProjectSession(project)
  const drafts = session && sameProjectSessionContext(draftSession, session) && chapterDrafts ? chapterDrafts : [current]
  const sorted = [...drafts].sort((a, b) => b.version - a.version)
  const active = sorted.filter(draft => draft.status !== 'archived')
  const archived = sorted.filter(draft => draft.status === 'archived')
  const shown = showArchived ? [...active, ...archived] : active

  // 菜单打开时读这一稿的自动快照；换稿或重开菜单都按当前稿重读。
  // 读取失败单独标记：快照是附加信息，失败不该表现为「这一稿没有快照」。
  useEffect(() => {
    if (!open) return
    let alive = true
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, tab.projectKey)) {
      queueMicrotask(() => {
        if (!alive) return
        setSnapshots([])
        setSnapshotsFailed(false)
      })
      return () => { alive = false }
    }
    void ipc.invokeWithProjectSession(projectSession, 'db:draft-snapshot-list', current.id, projectSession.projectPath)
      .then(list => {
        if (!alive || !isProjectSessionCurrent(projectSession)) return
        setSnapshots(list)
        setSnapshotsFailed(false)
      })
      .catch(() => {
        if (!alive) return
        setSnapshots([])
        setSnapshotsFailed(true)
      })
    return () => { alive = false }
  }, [open, current.id, tab.projectKey])
  useEffect(() => {
    if (open) layerRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
  }, [open, layerRef])

  const swapTo = async (draft: DraftMeta) => {
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession) return
    await swapChapterTab(tab.id, () => openDraftInChapterView(draft, title, projectSession))
  }

  const choose = (draft: DraftMeta) => {
    close(true)
    if (draft.filePath === tab.filePath) return
    const editor = useEditorStore.getState()
    const opened = editor.tabs.find(candidate => candidate.type === 'chapter' && candidate.projectKey === tab.projectKey && candidate.filePath === draft.filePath)
    if (opened) {
      editor.setActiveTab(opened.id)
      return
    }
    const latest = editor.tabs.find(candidate => candidate.id === tab.id)
    if (latest?.dirty) setPending(draft)
    else void swapTo(draft)
  }

  const settle = async (save: boolean) => {
    const draft = pending
    if (!draft) return
    setBusy(true)
    try {
      if (save) {
        await onSave()
        // 保存期间又有输入，或保存被会话守卫跳过：修改还没落盘，不切换。
        if (useEditorStore.getState().tabs.find(candidate => candidate.id === tab.id)?.dirty) return
      }
      setPending(null)
      await swapTo(draft)
    } catch {
      // 保存失败的原因已由保存提示给出；留在这一稿，修改还在。
    } finally {
      setBusy(false)
    }
  }

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(layerRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? items[(index + 1) % items.length]
      : event.key === 'ArrowUp' ? items[(index - 1 + items.length) % items.length] : undefined
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  /** 用快照内容新建一稿再切过去；有未保存修改时先保存，恢复不覆盖任何已有稿。 */
  const restoreSnapshot = async () => {
    const snapshot = restoring
    if (!snapshot) return
    const projectSession = captureProjectSession(useProjectStore.getState().currentProject)
    if (!projectSession || !isProjectSessionPath(projectSession, tab.projectKey)) return
    setBusy(true)
    try {
      if (useEditorStore.getState().tabs.find(candidate => candidate.id === tab.id)?.dirty) {
        try { await onSave() } catch { return }
        if (useEditorStore.getState().tabs.find(candidate => candidate.id === tab.id)?.dirty) return
      }
      const full = await ipc.invokeWithProjectSession(projectSession, 'db:draft-snapshot-get', snapshot.snapshotId, projectSession.projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      if (!full) throw new Error(text('这份快照已不存在', 'This snapshot no longer exists'))
      // 版本号由 db:draft-create 在事务内分配，这里不再预读，避免版本被并发占走后提示错版本。
      const created = await ipc.invokeWithProjectSession(projectSession, 'db:draft-create', {
        chapterNumber: current.chapterNumber,
        source: 'rewrite',
        content: full.content,
        wordCount: countDraftUnits(full.content),
      }, projectSession.projectPath)
      if (!isProjectSessionCurrent(projectSession)) return
      if (!created.success) throw new Error(created.error || text('没有新建快照草稿', 'The snapshot draft was not created'))
      await useDraftStore.getState().loadAllDrafts(projectSession.projectPath, projectSession)
      if (!isProjectSessionCurrent(projectSession)) return
      const fresh = useDraftStore.getState().draftsByChapter[current.chapterNumber]?.find(draft => draft.id === created.id)
      setRestoring(null)
      if (fresh) await swapTo(fresh)
      toast.success(fresh
        ? text(`已从快照新建草稿 v${fresh.version}，原有各稿都保留`, `Snapshot restored as draft v${fresh.version}. Every earlier version is kept.`)
        : text('已从快照新建草稿，原有各稿都保留', 'Snapshot restored as a new draft. Every earlier version is kept.'))
    } catch (error) {
      const reason = displayedErrorMessage(locale, error)
      toast.error(text(`恢复快照失败：${reason}`, `Could not restore the snapshot: ${reason}`))
    } finally {
      setBusy(false)
    }
  }

  const snapshotTime = (snapshot: DraftSnapshotMeta) =>
    sqliteTime(snapshot.createdAt).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const row = (draft: DraftMeta) => (
    <button
      key={draft.id}
      type="button"
      role="menuitemradio"
      aria-checked={draft.id === current.id}
      className="pi-menu-item stage-ch-version-item"
      tabIndex={-1}
      onClick={() => choose(draft)}
    >
      <span>{versionName(draft, text)}{draft.id === current.id ? text(' · 当前', ' · open') : ''}</span>
      <small>
        {draft.wordCount !== undefined ? text(`${draft.wordCount.toLocaleString(locale)} 字 · `, `${draft.wordCount.toLocaleString(locale)} ${pluralEn(draft.wordCount, 'word')} · `) : ''}
        {sqliteTime(draft.updatedAt ?? draft.createdAt).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </small>
    </button>
  )

  return (
    <div className="pi-anchor" ref={anchorRef}>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        className="stage-ch-version"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? layerId : undefined}
        aria-label={text(`本章版本：${label}`, `Chapter versions: ${label}`)}
        onClick={toggle}
      >
        {label}<ChevronDown size={13} aria-hidden />
      </Button>
      {open && renderLayer(
        <div id={layerId} ref={layerRef} role="menu" aria-label={text('本章版本', 'Chapter versions')} className="pi-menu stage-ch-versions" onKeyDown={moveFocus}>
          <div className="pi-menu-label" aria-hidden>{text('本章版本', 'Chapter versions')}</div>
          {shown.map(row)}
          {archived.length > 0 && (
            <>
              <div role="separator" className="pi-menu-sep" />
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={showArchived}
                className="pi-menu-item"
                tabIndex={-1}
                onClick={() => setShowArchived(value => !value)}
              >
                {text(`显示已归档（${archived.length}）`, `Show archived (${archived.length})`)}
              </button>
            </>
          )}
          {snapshots !== null && snapshots.length > 0 && (
            <>
              <div role="separator" className="pi-menu-sep" />
              <div className="pi-menu-label">{text('本稿自动快照', 'Auto snapshots of this draft')}</div>
              {snapshots.map(snapshot => (
                <button
                  key={snapshot.snapshotId}
                  type="button"
                  role="menuitem"
                  className="pi-menu-item stage-ch-snapshot-item"
                  tabIndex={-1}
                  onClick={() => { close(true); setRestoring(snapshot) }}
                >
                  <span>{snapshotTime(snapshot)}</span>
                  <small>
                    {text(
                      `${snapshot.wordCount.toLocaleString(locale)} 字`,
                      `${snapshot.wordCount.toLocaleString(locale)} ${pluralEn(snapshot.wordCount, 'word')}`,
                    )} · {snapshot.source === 'create' ? text('生成时', 'On generation') : text('保存时', 'On save')}
                  </small>
                </button>
              ))}
            </>
          )}
          {open && snapshots !== null && snapshots.length === 0 && (
            <>
              <div role="separator" className="pi-menu-sep" />
              <div className="pi-menu-label">{text('本稿自动快照', 'Auto snapshots of this draft')}</div>
              <div className="pi-menu-note">
                {snapshotsFailed
                  ? text('快照读取失败，这次不做快照恢复。', 'Snapshots could not be read, so they are not offered this time.')
                  : text('这一稿还没有快照；保存或生成后会出现。', 'No snapshots for this draft yet. They appear after a save or a generation.')}
              </div>
            </>
          )}
        </div>,
      )}
      <InkDialog
        open={pending !== null}
        onOpenChange={next => { if (!next && !busy) setPending(null) }}
        title={text('切换前保存修改？', 'Save changes before switching?')}
        description={text(
          `「${label}」有未保存的修改。保存后再打开${pending ? versionName(pending, text) : ''}，或放弃这些修改。`,
          `“${label}” has unsaved changes. Save them before opening ${pending ? versionName(pending, text) : ''}, or discard them.`,
        )}
        footer={(
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setPending(null)}>{text('继续编辑', 'Keep editing')}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void settle(false)}>{text('放弃修改并切换', 'Discard and switch')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void settle(true)}>{text('保存并切换', 'Save and switch')}</Button>
          </>
        )}
      />
      <InkDialog
        open={restoring !== null}
        onOpenChange={next => { if (!next && !busy) setRestoring(null) }}
        title={text('从快照恢复为新草稿？', 'Restore snapshot as a new draft?')}
        description={restoring
          ? text(
            `用 ${snapshotTime(restoring)} 的快照内容新建一稿；当前各稿都保留，不会被覆盖。`,
            `Create a new draft from the snapshot taken at ${snapshotTime(restoring)}. Every existing version is kept and nothing is overwritten.`,
          )
          : ''}
        footer={(
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setRestoring(null)}>{text('取消', 'Cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void restoreSnapshot()}>{text('恢复为新草稿', 'Restore as new draft')}</Button>
          </>
        )}
      />
    </div>
  )
}
