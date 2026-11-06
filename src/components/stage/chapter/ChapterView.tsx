import { useCallback, useEffect, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels'
import { Columns2, AlignVerticalJustifyCenter } from 'lucide-react'
import { countDraftUnits } from '../../../shared/draft-units'
import { formatResourceUri } from '../../../shared/project-paths'
import type { EditorTab } from '../../../stores/editor-store'
import { readDraftBody } from '../../../stores/draft-store'
import { useLocaleStore } from '../../../stores/locale-store'
import { chapterPhase } from '../../../stores/navigation/stage-progress'
import { useStageStore } from '../../../stores/navigation/stage-store'
import { useProjectStore } from '../../../stores/project-store'
import { toast } from '../../ui/Toast'
import type { ReviewEntry } from '../../../services/draft-index'
import { ipc } from '../../../services/ipc-client'
import { confirmationSourceReviewId, parseHumanConfirmedReviewSnapshot } from '../../../shared/human-confirmed-review'
import CodeMirrorEditor from '../../editor/CodeMirrorEditor'
import { useReviewCycle } from '../../editor/review-checklist'
import { useDraftActions } from '../../editor/use-draft-actions'
import { useWikilinkEntries } from '../../editor/use-wikilink-entries'
import { useStaleStateCharacters } from '../../editor/use-stale-state-characters'
import { sameProjectSessionContext } from '../../../shared/project-session-context'
import { captureProjectSession, isProjectSessionCurrent, isProjectSessionPath } from '../../project-session-gate'
import ChapterActions from './ChapterActions'
import ChapterHead from './ChapterHead'
import ChapterReferencePanel from './ChapterReferencePanel'
import DeletionCleanupNotices from './DeletionCleanupNotices'
import { useChapterBlueprint } from './use-chapter-blueprint'
import { useSceneCards } from '../blueprint/use-scene-cards'
import ChapterPlan from './ChapterPlan'
import { STAGE_STEP } from './chapter-lifecycle'
import VersionSwitcher from './VersionSwitcher'
import { pluralEn } from '../../../shared/plural-en'

/**
 * 这一稿显示哪份审稿与原文：最新一份有复验周期的审稿（确认后的清单按它指向的原审稿算），都没有周期（旧审稿）时取最新一份。
 * 合并后的自动复验另存一份审稿，它没有自己的周期，逐项结果写回原审稿的周期；显示原审稿才看得到复验完成几项与逐项结果。
 * 审稿记录变化时重读。
 */
function useShownReview(reviews: readonly ReviewEntry[], projectKey: string) {
  const key = reviews.map(review => review.id).join(',')
  const [report, setReport] = useState<{ key: string; id: number; content: string } | null>(null)
  useEffect(() => {
    if (reviews.length === 0) return
    const session = captureProjectSession(useProjectStore.getState().currentProject)
    if (!session || !isProjectSessionPath(session, projectKey)) return
    let cancelled = false
    const live = () => !cancelled && isProjectSessionCurrent(session)
    void (async () => {
      let shown: { id: number; content: string } | null = null
      for (const entry of [...reviews].reverse()) {
        // 读不出原文时按空报告处理：动作条照常出现，侧页里没有可勾选的意见，作者可以重新审稿。
        const content = await readDraftBody(formatResourceUri({ kind: 'review', id: entry.id }), projectKey, session).catch(() => '')
        if (!live()) return
        shown ??= { id: entry.id, content }
        const cycleReviewId = confirmationSourceReviewId(parseHumanConfirmedReviewSnapshot(content), entry.id)
        const cycle = await ipc.invokeWithProjectSession(session, 'db:review-cycle-get', cycleReviewId, session.projectPath).catch(() => null)
        if (!live()) return
        if (cycle) {
          shown = { id: entry.id, content }
          break
        }
      }
      if (shown) setReport({ key: reviews.map(review => review.id).join(','), ...shown })
    })()
    return () => { cancelled = true }
  }, [reviews, projectKey])
  return report?.key === key ? report : null
}

/**
 * 正文单章视图：章节头、生命周期、章节动作条、版本切换器与纸面正文。待写章显示本章蓝图与写作此章。
 * 审稿报告是视图里的侧页，修稿合并在纸面上逐段选择，定稿后显示后处理四步；全程不需要离开这个标签。
 */
export default function ChapterView({ tab }: { tab: EditorTab }) {
  const project = useProjectStore(s => s.currentProject)
  const session = captureProjectSession(project)
  const sessionKey = session && tab.projectKey && isProjectSessionPath(session, tab.projectKey)
    ? `${session.projectId}:${session.leaseId}`
    : `inactive:${tab.projectKey}`
  if (!tab.projectKey || tab.chapterNumber === undefined && !tab.filePath) return null
  if (!tab.filePath) return <ChapterPlan key={sessionKey} tab={tab} chapterNumber={tab.chapterNumber!} projectKey={tab.projectKey} />
  return <DraftChapter key={sessionKey} tab={tab} filePath={tab.filePath} projectKey={tab.projectKey} />
}

function DraftChapter({ tab, filePath, projectKey }: { tab: EditorTab; filePath: string; projectKey: string }) {
  const session = captureProjectSession(useProjectStore(s => s.currentProject))
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const focus = useStageStore(s => s.focus)
  const reviewTargetState = useStageStore(s => s.reviewTarget)
  const reviewTarget = reviewTargetState
    && reviewTargetState.filePath === filePath
    && Boolean(session && sameProjectSessionContext(reviewTargetState.session, session))
    ? reviewTargetState.target
    : null
  const request = useStageStore(s => s.chapterRequest)
  const draft = useDraftActions({ tabId: tab.id, filePath, content: tab.content ?? '', projectKey })
  const chapterNumber = draft.meta?.chapterNumber ?? tab.chapterNumber
  const { blueprint } = useChapterBlueprint(chapterNumber, projectKey)
  const latest = useShownReview(draft.reviews, projectKey)
  const review = useReviewCycle({ reportText: latest?.content ?? '', reviewId: latest?.id, projectKey,
    // 复验完成时新增一份审稿而显示的仍是原审稿，审稿记录也算进来，周期随之重读。
    refreshKey: `${draft.status}:${draft.pendingRevisions.map(revision => revision.id).join(',')}:${draft.reviews.map(entry => entry.id).join(',')}` })
  const [charCount, setCharCount] = useState(() => countDraftUnits(tab.content ?? ''))
  // 沉浸写作底部的字数进度，目标取设定里的每章字数。
  const target = useProjectStore(s => s.currentProject?.novelConfig.wordsPerChapter) || 0
  const [sheetSlot, setSheetSlot] = useState<HTMLDivElement | null>(null)
  // 分屏对照：左栏钉住本章蓝图与场景卡；状态跨章节记忆。
  const [splitOpen, setSplitOpen] = useState(() => {
    try { return window.localStorage.getItem('ai-novel-writer-split-reference') === '1' } catch { return false }
  })
  const toggleSplit = useCallback(() => {
    setSplitOpen(current => {
      const next = !current
      try { window.localStorage.setItem('ai-novel-writer-split-reference', next ? '1' : '0') } catch { /* 忽略 */ }
      return next
    })
  }, [])
  // 打字机居中滚动：光标所在行保持在视口中部附近；同样跨章节记忆。
  const [typewriterScroll, setTypewriterScroll] = useState(() => {
    try { return window.localStorage.getItem('ai-novel-writer-typewriter') === '1' } catch { return false }
  })
  const toggleTypewriter = useCallback(() => {
    setTypewriterScroll(current => {
      const next = !current
      try { window.localStorage.setItem('ai-novel-writer-typewriter', next ? '1' : '0') } catch { /* 忽略 */ }
      return next
    })
  }, [])
  const wikilinkEntries = useWikilinkEntries(projectKey)
  // 本章蓝图出场、但动态状态停更在更早章节的角色：交给审稿侧页做「状态核对」提示。
  const staleStateCharacters = useStaleStateCharacters(projectKey, chapterNumber, blueprint?.characters ?? [])
  // 分屏宽度持久化：拖动后记进 localStorage，下次打开恢复。
  const referenceLayout = useDefaultLayout({
    id: 'ai-novel-writer-chapter-reference-split',
    panelIds: ['chapter-reference', 'chapter-prose'],
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  })

  const facts = useStageStore(s => draft.meta && s.chapterFacts && session && sameProjectSessionContext(s.chapterFacts.session, session)
    ? s.chapterFacts.byDraft[draft.meta.id]
    : undefined)
  // 这一稿的记录与最新审稿都读出来之前不摆动作条：先按不全的数据摆会闪一下别的主按钮，清单状态也会被重置。
  const reviewReady = draft.loaded && (draft.reviews.length === 0 || latest !== null)
  const stage = draft.loaded && draft.meta ? draft.status === 'archived' ? 'archived' : chapterPhase(draft.status, facts) : null

  // 审稿或修稿刚在别处生成：重读这一稿的数据，并收起跟着工作流打开的运行侧页。新审稿换掉动作条的会话键，
  // 审稿侧页按「已审稿」默认展开；待合并修稿直接摆出合并视图。
  const { reload } = draft
  useEffect(() => {
    if (!request || request.filePath !== filePath || !sameProjectSessionContext(request.session, captureProjectSession(useProjectStore.getState().currentProject))) return
    useStageStore.setState({ chapterRequest: null, sheet: null })
    reload()
  }, [request, filePath, reload])

  const title = blueprint?.title || draft.meta?.chapterTitle || ''
  const units = charCount.toLocaleString(locale)
  const versionLabel = !draft.meta ? text('读取中…', 'Loading…')
    : stage === 'final' ? text(`定稿 · ${units} 字`, `Final · ${units} ${pluralEn(charCount, 'word')}`)
      : stage === 'archived' ? text(`已归档 v${draft.meta.version} · ${units} 字`, `Archived v${draft.meta.version} · ${units} ${pluralEn(charCount, 'word')}`)
        : stage === 'revised' ? text(`修稿已合并 v${draft.meta.version} · ${units} 字`, `Revised v${draft.meta.version} · ${units} ${pluralEn(charCount, 'word')}`)
          : text(`草稿 v${draft.meta.version} · ${units} 字`, `Draft v${draft.meta.version} · ${units} ${pluralEn(charCount, 'word')}`)
  const editable = !draft.isReadonly && !draft.isChapterBusy
  const finishReviewTarget = useCallback((findingId: string) => {
    const current = useStageStore.getState().reviewTarget
    if (current?.target.findingId === findingId) useStageStore.setState({ reviewTarget: null })
  }, [])
  const failReviewTarget = useCallback((findingId: string) => {
    toast.warning(text('原稿已变化或引文不唯一，无法自动定位这条审稿意见；请在审稿报告中手动核对。', 'The source draft changed or the quote is ambiguous, so this finding could not be located automatically. Check the review report manually.'))
    finishReviewTarget(findingId)
  }, [finishReviewTarget, text])

  const sceneCards = useSceneCards(projectKey)
  const chapterScenes = chapterNumber !== undefined ? sceneCards.byChapter(chapterNumber) : []
  const splitButton = (
    <>
      <button
        type="button"
        className="stage-ch-splitbtn"
        aria-pressed={splitOpen}
        title={text('分屏对照：左侧钉住本章蓝图与场景卡', 'Split view: pin this chapter blueprint and scene cards on the left')}
        onClick={toggleSplit}
      >
        <Columns2 size={15} aria-hidden="true" />
        <span>{text('对照', 'Split')}</span>
      </button>
      <button
        type="button"
        className="stage-ch-splitbtn"
        aria-pressed={typewriterScroll}
        title={text('打字机滚动：光标所在行保持居中', 'Typewriter scrolling: keep the caret line near the middle')}
        onClick={toggleTypewriter}
      >
        <AlignVerticalJustifyCenter size={15} aria-hidden="true" />
        <span>{text('打字机', 'Typewriter')}</span>
      </button>
    </>
  )

  const proseEditor = !draft.mergeData && (
    <div className="stage-ch-prose" data-readonly={!editable || undefined}>
      <CodeMirrorEditor
        mode="prose"
        fitContent
        paragraphIndent
        wikilinkEntries={wikilinkEntries}
        typewriterScroll={typewriterScroll}
        content={tab.content ?? ''}
        filePath={filePath}
        editable={editable}
        hideStatusBar
        onCharCountChange={setCharCount}
        reviewTarget={reviewTarget ?? undefined}
        onReviewTargetFailure={failReviewTarget}
        onReviewTargetComplete={finishReviewTarget}
        onChange={draft.onBodyChange}
        onSave={body => draft.save(body)}
      />
    </div>
  )

  const page = (
    <article className="stage-ch-page" aria-busy={!draft.loaded}>
      {chapterNumber !== undefined && (
        <ChapterHead
          chapterNumber={chapterNumber}
          role={blueprint?.role}
          title={title}
          step={stage === 'archived' || stage === null ? null : STAGE_STEP[stage]}
          focus={focus}
          actions={splitButton}
          version={draft.meta
            ? <VersionSwitcher tab={tab} current={draft.meta} label={versionLabel} title={title} onSave={() => draft.save(draft.currentBodyRef.current, true)} />
            : <span className="stage-ch-version stage-ch-version-chip" role="status">{versionLabel}</span>}
        />
      )}
      {draft.meta && stage && chapterNumber !== undefined && reviewReady && (
        <ChapterActions
          key={review.sessionKey}
          sheetSlot={sheetSlot}
          tab={tab}
          stage={stage}
          chapterNumber={chapterNumber}
          title={title}
          draft={draft}
          facts={facts}
          staleStateCharacters={staleStateCharacters}
          review={latest ? { report: latest.content, reviewId: latest.id, snapshot: review.snapshot, cycle: review.cycle, reloadCycle: review.reloadCycle } : null}
          focus={focus}
        />
      )}
      {chapterNumber !== undefined && (
        <div className="stage-ch-notices"><DeletionCleanupNotices projectKey={projectKey} chapterNumber={chapterNumber} /></div>
      )}
      {proseEditor}
    </article>
  )

  return (
    <div className="stage-ch" data-focus={focus || undefined}>
      {splitOpen ? (
        <Group
          className="stage-ch-split"
          orientation="horizontal"
          defaultLayout={referenceLayout.defaultLayout}
          onLayoutChanged={referenceLayout.onLayoutChanged}
        >
          <Panel id="chapter-reference" defaultSize="30%" minSize="16%" maxSize="55%">
            <ChapterReferencePanel blueprint={blueprint ?? null} scenes={chapterScenes} />
          </Panel>
          <Separator className="stage-ch-resizehandle" aria-label={text('拖动调整参考栏宽度', 'Drag to resize the reference panel')} />
          <Panel id="chapter-prose" minSize="40%">
            <div className="stage-ch-scroll">{page}</div>
          </Panel>
        </Group>
      ) : (
        <div className="stage-ch-scroll">{page}</div>
      )}
      <div ref={setSheetSlot} className="stage-ch-sheet-slot" />
      {focus && (
        <footer className="stage-ch-focusbar" aria-label={text('写作状态', 'Writing status')}>
          {target ? (
            <>
              <span>{text(`${units} / ${target.toLocaleString(locale)} 字`, `${units} / ${target.toLocaleString(locale)} ${pluralEn(target, 'word')}`)}</span>
              <span className="stage-ch-focus-progress" role="progressbar" aria-label={text('本章目标字数进度', 'Progress toward the chapter target')}
                aria-valuemin={0} aria-valuemax={target} aria-valuenow={Math.min(charCount, target)}>
                <span style={{ width: `${Math.min(100, charCount / target * 100)}%` }} />
              </span>
            </>
          ) : <span>{text(`${units} 字`, `${units} ${pluralEn(charCount, 'word')}`)}</span>}
          <span>{tab.dirty ? text('有未保存的修改', 'Unsaved changes') : text('已保存', 'Saved')}</span>
        </footer>
      )}
    </div>
  )
}
