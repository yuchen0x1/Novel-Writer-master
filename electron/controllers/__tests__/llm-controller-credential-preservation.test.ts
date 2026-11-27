import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REDACTED_MODEL_API_KEY } from '../../../src/shared/ipc-channels'
import { ENCRYPTED_KEY_PREFIX } from '../../utils/model-credential-security'

type IpcHandler = (...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, 'utf8')),
  decryptString: vi.fn((value: Buffer) => {
    const decoded = value.toString('utf8')
    if (decoded === 'encrypted:unreadable') throw new Error('keychain entry is unreadable')
    return decoded.replace(/^encrypted:/, '')
  }),
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString,
  },
}))

let fixtureRoot = ''
let velaHome = ''

function handler(channel: string): IpcHandler {
  const registered = mocks.handlers.get(channel)
  if (!registered) throw new Error(`Missing IPC handler: ${channel}`)
  return registered
}

beforeEach(async () => {
  vi.resetModules()
  mocks.handlers.clear()
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-model-credential-preservation-'))
  velaHome = await (await import('../../services/__tests__/global-data-fixture')).prepareGlobalDataFixture(fixtureRoot)
  const { registerLLMController } = await import('../llm-controller')
  registerLLMController()
})

afterEach(() => {
  delete process.env.AI_NOVEL_VELA_HOME
  delete process.env.AI_NOVEL_APP_DATA_HOME
  fs.rmSync(fixtureRoot, { recursive: true, force: true })
})

describe('model credential preservation', () => {
  it('keeps an unreadable encrypted credential intact when another model is updated', async () => {
    const modelsPath = path.join(velaHome, 'models.json')
    const unreadableKey = `${ENCRYPTED_KEY_PREFIX}${Buffer.from('encrypted:unreadable', 'utf8').toString('base64')}`
    const editableKey = `${ENCRYPTED_KEY_PREFIX}${Buffer.from('encrypted:editable', 'utf8').toString('base64')}`
    fs.writeFileSync(modelsPath, JSON.stringify([
      {
        id: 'unreadable-model',
        name: 'Unreadable model',
        provider: 'custom',
        protocol: 'openai',
        modelName: 'manual-model',
        baseUrl: 'https://provider.invalid/v1',
        apiKey: unreadableKey,
        purposes: ['generation'],
      },
      {
        id: 'edited-model',
        name: 'Edited model',
        provider: 'custom',
        protocol: 'openai',
        modelName: 'manual-model',
        baseUrl: 'https://provider.invalid/v1',
        apiKey: editableKey,
        purposes: ['generation'],
      },
    ]))

    const listed = await handler('llm:list-models')({}) as Array<{ id: string, apiKey: string }>
    expect(listed.find((model) => model.id === 'unreadable-model')?.apiKey).toBe(REDACTED_MODEL_API_KEY)

    await expect(handler('llm:save-model')({}, {
      id: 'edited-model',
      name: 'Edited model',
      provider: 'custom',
      protocol: 'openai',
      modelName: 'manual-model',
      baseUrl: 'https://provider.invalid/v1',
      apiKey: REDACTED_MODEL_API_KEY,
      purposes: ['generation'],
    })).resolves.toEqual({ success: true })

    const written = JSON.parse(fs.readFileSync(modelsPath, 'utf8')) as Array<{ id: string, apiKey: string }>
    expect(written.find((model) => model.id === 'unreadable-model')?.apiKey).toBe(unreadableKey)
    expect(written.find((model) => model.id === 'edited-model')?.apiKey).toBe(editableKey)
  })
})
