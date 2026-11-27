import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { BUILTIN_PROMPTS, promptCatalog } from '../../../services/prompt-templates'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import PromptSettings from '../PromptSettings'
import { leaveSettings, settleSettingsLeave, useSettingsLeave } from '../unsaved-settings'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  useLocaleStore.setState({ locale: 'en-US' })
  useProjectStore.setState({ currentProject: null })
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'prompt:load-global') return { templates: [], diagnostics: [] }
    if (channel === 'prompt:save-global') return { success: true }
    throw new Error(`Unexpected IPC channel: ${channel}`)
  })
  Object.defineProperty(window, 'aiNovelAPI', { configurable: true, value: { invoke } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  settleSettingsLeave(false)
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'aiNovelAPI')
  useLocaleStore.setState({ locale: 'zh-CN' })
})

it('keeps a collapsed template draft while another template is saved and still warns before leaving', async () => {
  await act(async () => root.render(<PromptSettings />))
  const first = page.getByRole('button', { name: /^Full configuration/ })
  const second = page.getByRole('button', { name: /^Single configuration field/ })
  await act(async () => first.click())
  await act(async () => page.getByRole('textbox', { name: 'Additional creative guidance' }).fill('Keep this unsaved guidance'))
  await act(async () => second.click())

  const proceed = vi.fn()
  leaveSettings(proceed)
  expect(proceed).not.toHaveBeenCalled()
  expect(useSettingsLeave.getState().pending).not.toBeNull()
  settleSettingsLeave(false)

  await act(async () => page.getByRole('textbox', { name: 'Additional creative guidance' }).fill('Saved guidance for the other template'))
  await act(async () => page.getByRole('button', { name: 'Save globally', exact: true }).click())
  await act(async () => first.click())

  await expect.element(page.getByRole('textbox', { name: 'Additional creative guidance' })).toHaveValue('Keep this unsaved guidance')
  await act(async () => page.getByRole('combobox', { name: 'Writing language to edit' }).selectOptions('en-US'))
  expect(useSettingsLeave.getState().pending).not.toBeNull()
  await act(async () => settleSettingsLeave(false))
  await expect.element(page.getByRole('combobox', { name: 'Writing language to edit' })).toHaveValue('zh-CN')
  await expect.element(page.getByRole('textbox', { name: 'Additional creative guidance' })).toHaveValue('Keep this unsaved guidance')
})

it('does not replace author input when late prompt hydration updates its saved baseline', async () => {
  const builtin = BUILTIN_PROMPTS.find(template => template.key === 'generate_global_config')!
  let release!: () => void
  const hydration = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(promptCatalog, 'list').mockImplementation(async () => {
    await hydration
    return []
  })
  const peek = vi.spyOn(promptCatalog, 'peek')
  await act(async () => root.render(<PromptSettings />))
  await act(async () => page.getByRole('button', { name: /^Full configuration/ }).click())
  await act(async () => page.getByRole('textbox', { name: 'Additional creative guidance' }).fill('Written while loading'))
  peek.mockImplementation(key => key === builtin.key
    ? { source: 'global', template: { ...builtin, taskGuidance: 'Late saved guidance' } }
    : undefined)
  await act(async () => { release(); await hydration })

  await expect.element(page.getByRole('textbox', { name: 'Additional creative guidance' })).toHaveValue('Written while loading')
})
