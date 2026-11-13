import { afterEach, expect, it, vi } from 'vitest'
import { userEvent } from 'vitest/browser'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import StageSpine from '../StageSpine'
import { deriveStages, type WorkFacts } from '../../../stores/navigation/stage-progress'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
})

it('keeps chapters clickable when the desktop window has limited height', async () => {
  const facts: WorkFacts = {
    config: { coreOutline: '重返旧港', genre: '悬疑', targetAudience: '成年读者', totalChapters: 1, wordsPerChapter: 3000 },
    architecture: {}, blueprints: [], drafts: {}, runningChapters: new Set(),
  }
  const onChapter = vi.fn()
  host = document.createElement('div')
  host.className = 'paper-ink stage-shell'
  host.style.cssText = 'height: 560px; width: 1024px;'
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(
    <div className="stage-frame">
      <StageSpine stages={deriveStages(facts)} chapters={[{number: 1, title: '导入的正文', phase: 'draft', running: false, draft: null, hasFinal: false}]}
        location={{kind: 'stage', stage: 'manuscript', chapter: 1}} onChapter={onChapter}
        onStage={() => undefined} onResource={() => undefined} onExport={() => undefined} onSettings={() => undefined} />
    </div>,
  ))
  const chapter = host.querySelector<HTMLButtonElement>('.stage-chapter')!
  await userEvent.click(chapter)
  expect(onChapter).toHaveBeenCalledWith(1)
})
