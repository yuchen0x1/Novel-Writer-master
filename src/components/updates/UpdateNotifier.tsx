import { useState } from 'react'

import { useLocaleStore } from '../../stores/locale-store'
import { InkDialog } from '../stage/InkDialog'
import { Button } from '../ui/Button'
import { plainReleaseNotes } from './release-notes'
import { useUpdateState } from './use-update-state'

/** 本次会话里点过「稍后更新」的版本：每小时自动检查还会继续跑，但同一个版本不再反复弹窗。 */
const dismissedVersions = new Set<string>()

/**
 * 发现新版本时的全局弹窗：展示该版本的更新内容，稍后更新只收起本次会话的弹窗，
 * 立即更新在 Windows 上开始下载（进度见书房与设置卡片），macOS 上打开下载页。
 */
export function UpdateNotifier() {
  const text = useLocaleStore(s => s.text)
  const model = useUpdateState()
  const { state, presentation } = model
  const [dismissedVersion, setDismissedVersion] = useState<string>()
  const [updating, setUpdating] = useState(false)
  const version = state.availableVersion
  const open = presentation.kind === 'available'
    && version !== undefined
    && !state.isReminderDeferred
    && dismissedVersion !== version
    && !dismissedVersions.has(version)

  const remindLater = () => {
    if (!version) return
    dismissedVersions.add(version)
    setDismissedVersion(version)
  }

  const updateNow = async () => {
    if (!version || updating) return
    setUpdating(true)
    try {
      if (presentation.canDownload) await model.downloadUpdate()
      else if (presentation.canOpenRelease) await model.openRelease()
      dismissedVersions.add(version)
      setDismissedVersion(version)
    } finally {
      setUpdating(false)
    }
  }

  const notes = version && state.releaseNotes ? plainReleaseNotes(state.releaseNotes) : ''

  return (
    <InkDialog
      open={open}
      onOpenChange={next => { if (!next) remindLater() }}
      keepOnOutsideClick={updating}
      title={text(`发现新版本 v${version ?? ''}`, `New version v${version ?? ''} is available`)}
      description={presentation.canOpenRelease
        ? text('打开官方下载页，选择适用于本机的 macOS 安装包。', 'Open the official download page and choose the macOS installer for your Mac.')
        : text(
          '下载完成后可重启安装。正在运行的创作任务结束后才能安装。',
          'Restart to install once the download and any active writing tasks finish.',
        )}
      footer={
        <>
          <Button variant="text" size="sm" disabled={updating} onClick={remindLater}>
            {text('稍后更新', 'Later')}
          </Button>
          <Button variant="primary" size="sm" disabled={updating || (!presentation.canDownload && !presentation.canOpenRelease)} onClick={() => void updateNow()}>
            {updating ? text('正在准备…', 'Preparing…')
              : presentation.canOpenRelease ? text('打开下载页', 'Open download page') : text('立即更新', 'Update now')}
          </Button>
        </>
      }
    >
      <div className="update-popup-notes" role="note" aria-label={text('更新内容', 'Release notes')}>
        {notes || text(
          '这个版本没有附上更新说明，可到官方主页查看。',
          'This release has no notes; see the official website for details.',
        )}
      </div>
    </InkDialog>
  )
}
