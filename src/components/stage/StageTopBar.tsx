import { AlertTriangle, Check, ChevronDown, CircleDashed, LoaderCircle, Maximize2, Minimize2, Minus, PanelRightClose, PanelRightOpen, RotateCcw, Search, Settings, Square, X } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { APP_BRAND } from '../../shared/brand'
import { useEditorStore } from '../../stores/editor-store'
import { countUnsavedEditorItemsForProject } from '../../stores/editor-unsaved'
import { useLocaleStore } from '../../stores/locale-store'
import { navigate } from '../../stores/navigation/navigation-intents'
import { useStageStore } from '../../stores/navigation/stage-store'
import { useProjectStore } from '../../stores/project-store'
import { runSaveRetry, useSaveStatusStore } from '../../stores/save-status-store'
import { Button } from '../ui/Button'
import { Menu, type MenuGroupSpec } from '../ui/Menu'
import RunCapsule from './RunCapsule'
import { commandLabel } from './shortcut-keys'


interface StageTopBarProps {
  /** 位置面包屑，最后一项为当前页。 */
  crumbs: readonly string[]
  library: boolean
  focus: boolean
  /** 沉浸写作时左侧显示的当前页：正文章节显示章号与章名，其余显示标签名。 */
  focusTitle: { chapter?: number; title: string }
  workMenu: readonly MenuGroupSpec[]
  onToggleFocus: () => void
  assistantOpen?: boolean
  onToggleAssistant?: () => void
}

function WindowControls() {
  const text = useLocaleStore(s => s.text)
  return (
    <div className="stage-window-controls">
      <button type="button" aria-label={text('最小化', 'Minimize')} onClick={() => void ipc.invoke('window:minimize')}>
        <Minus size={14} aria-hidden="true" />
      </button>
      <button type="button" aria-label={text('最大化', 'Maximize')} onClick={() => void ipc.invoke('window:toggle-maximize')}>
        <Square size={12} aria-hidden="true" />
      </button>
      <button type="button" className="stage-window-close" aria-label={text('关闭', 'Close')} onClick={() => void ipc.invoke('window:close')}>
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

export default function StageTopBar({ crumbs, library, focus, focusTitle, workMenu, onToggleFocus, assistantOpen = false, onToggleAssistant }: StageTopBarProps) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  const projectName = useProjectStore(s => s.currentProject?.name)
  const projectPath = useProjectStore(s => s.currentProject?.path)
  const dirty = useEditorStore(s => Boolean(projectPath) && countUnsavedEditorItemsForProject(s.tabs, s.draftLedgers, projectPath!) > 0)
  const savingCount = useSaveStatusStore(s => s.savingCount)
  const failure = useSaveStatusStore(s => s.failure)
  const lastSavedAt = useSaveStatusStore(s => s.lastSavedAt)
  const saveStatusProject = useSaveStatusStore(s => s.projectPath)
  // 保存状态自带作品归属；只显示当前作品的，避免切书后显示上一部的失败或上次保存时间。
  const saveStatusCurrent = saveStatusProject === null || saveStatusProject === projectPath

  if (focus) {
    return (
      <header className="stage-topbar" data-focus="true">
        {focusTitle.chapter !== undefined && <span className="stage-focus-no">{focusTitle.chapter}</span>}
        <span className="stage-focus-title">{focusTitle.title}</span>
        <span className="stage-topbar-gap" />
        <Button variant="secondary" size="sm" aria-label={text('退出沉浸写作', 'Exit focus mode')} onClick={onToggleFocus}>
          <Minimize2 size={13} aria-hidden="true" />
          {text('退出沉浸', 'Exit focus')}
          <kbd>Esc</kbd>
        </Button>
        <WindowControls />
      </header>
    )
  }

  return (
    <header className="stage-topbar">
      <span className="stage-brand" aria-hidden="true" />
      {library || !projectName
        ? <span className="stage-work-title">{text(APP_BRAND.zhName, APP_BRAND.enName)}</span>
        : (
          <Menu
            label={text(`《${projectName}》作品菜单`, `“${projectName}” menu`)}
            trigger={{ className: 'stage-work-title', content: <><span className="stage-work-name" title={projectName}>{projectName}</span><ChevronDown size={14} aria-hidden="true" /></> }}
            groups={workMenu}
          />
        )}
      {crumbs.length > 0 && (
        <nav className="stage-crumbs" aria-label={text('位置', 'Location')}>
          {crumbs.map((crumb, index) => (
            <span key={`${index}-${crumb}`} className="stage-crumb" aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb}</span>
          ))}
        </nav>
      )}
      <div className="stage-topbar-center">
        <button type="button" className="stage-search-trigger" onClick={() => useStageStore.setState({ palette: 'commands' })}>
          <Search size={14} aria-hidden="true" />
          <span className="stage-search-hint">{library
            ? text('搜索作品，或打开文件夹', 'Search books, or open a folder')
            : text('搜索章节、角色，或跳转到任意阶段', 'Search chapters and characters, or jump to any stage')}</span>
          <kbd>{commandLabel('k')}</kbd>
        </button>
      </div>
      <RunCapsule />
      {!library && (
        <Button
          variant="icon"
          size="sm"
          aria-label={text(assistantOpen ? '关闭 AI 助手' : '打开 AI 助手', assistantOpen ? 'Close AI assistant' : 'Open AI assistant')}
          title={text(assistantOpen ? '关闭 AI 助手' : '打开 AI 助手', assistantOpen ? 'Close AI assistant' : 'Open AI assistant')}
          aria-pressed={assistantOpen}
          onClick={onToggleAssistant}
        >
          {assistantOpen ? <PanelRightClose size={16} aria-hidden="true" /> : <PanelRightOpen size={16} aria-hidden="true" />}
        </Button>
      )}
      {library && (
        <Button variant="icon" size="sm" aria-label={text('设置', 'Settings')} onClick={() => navigate({ kind: 'settings', section: 'llm' })}>
          <Settings size={16} aria-hidden="true" />
        </Button>
      )}
      {!library && (() => {
        // 保存中优先；失败与未保存同屏（失败时内容确实未保存，顶栏文字保持「未保存」），警示图标与重试按钮表达失败；
        // 只有失败却没有未保存内容时才整段写「保存失败」。
        const statusSavingCount = saveStatusCurrent ? savingCount : 0
        const statusFailure = saveStatusCurrent ? failure : null
        const statusLastSavedAt = saveStatusCurrent ? lastSavedAt : null
        const phase = statusSavingCount > 0 ? 'saving' : statusFailure ? 'failed' : dirty ? 'dirty' : 'saved'
        const savedTime = statusLastSavedAt !== null && phase === 'saved'
          ? new Date(statusLastSavedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
          : null
        return (
          <span
            className="stage-saved"
            data-phase={phase}
            data-dirty={phase === 'dirty' || phase === 'failed' || undefined}
            role={phase === 'failed' ? 'alert' : 'status'}
            title={statusFailure ?? (savedTime ? text(`上次保存 ${savedTime}`, `Last saved ${savedTime}`) : undefined)}
          >
            {phase === 'saving' && <><LoaderCircle size={13} className="stage-update-spin" aria-hidden="true" />{text('保存中…', 'Saving…')}</>}
            {phase === 'failed'
              ? <AlertTriangle size={13} aria-hidden="true" />
              : phase === 'dirty' && <CircleDashed size={13} aria-hidden="true" />}
            {(phase === 'dirty' || phase === 'failed') && (statusFailure && !dirty
              ? text('保存失败', 'Save failed')
              : text('未保存', 'Unsaved'))}
            {phase === 'failed' && (
              <button
                type="button"
                className="stage-saved-retry"
                aria-label={text('重试保存', 'Retry save')}
                title={text('重试上一次失败的保存', 'Retry the last failed save')}
                onClick={() => runSaveRetry()}
              >
                <RotateCcw size={12} aria-hidden="true" />
              </button>
            )}
            {phase === 'saved' && <><Check size={13} aria-hidden="true" />{text('已保存', 'Saved')}</>}
          </span>
        )
      })()}
      {!library && (
        <Button variant="icon" size="sm" aria-label={text('进入沉浸写作', 'Enter focus mode')} onClick={onToggleFocus}>
          <Maximize2 size={15} aria-hidden="true" />
        </Button>
      )}
      <WindowControls />
    </header>
  )
}
