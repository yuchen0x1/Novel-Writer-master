import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { REDACTED_MODEL_API_KEY } from '../../../src/shared/ipc-channels'
import type {
  ModelDiscoveryResult,
  ModelDiscoveryRequest,
  ModelProfile,
} from '../../../src/shared/ipc-channels'

type IpcHandler = (...args: unknown[]) => Promise<unknown>

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, IpcHandler>(),
  models: [] as ModelProfile[],
  discoverModels: vi.fn<(request: ModelDiscoveryRequest) => Promise<ModelDiscoveryResult>>(),
  writeJsonFile: vi.fn<(filePath: string, data: unknown) => void>(),
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  ipcMain: {
    handle: vi.fn((channel: string, handler: IpcHandler) => {
      mocks.handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../../utils/config-utils', () => ({
  MODELS_CONFIG_PATH: 'models.json',
  GLOBAL_CONFIG_PATH: 'config.json',
  DEFAULT_GLOBAL_CONFIG: { proxy: { enabled: false } },
  readJsonFile: vi.fn((filePath: string, fallback: unknown) => filePath === 'models.json' ? mocks.models : fallback),
  tryReadJsonFile: vi.fn(() => ({ status: 'missing' })),
  writeJsonFile: mocks.writeJsonFile,
}))

vi.mock('../../llm/llm-factory', () => ({
  LLMFactory: {
    getProvider: vi.fn(() => ({ generate: vi.fn(), generateStream: vi.fn() })),
  },
}))

vi.mock('../../database', () => ({ getCurrentProjectPath: () => null }))
vi.mock('../../repositories/llm-repository', () => ({
  LLMHistoryRepository: { logCall: vi.fn() },
}))
vi.mock('../../services/project-access', () => ({
  projectAccess: { assertCurrentProjectContext: vi.fn() },
}))
vi.mock('../../services/model-discovery-service', () => ({
  ModelDiscoveryService: class {
    discoverModels(request: ModelDiscoveryRequest) {
      return mocks.discoverModels(request)
    }
  },
}))

import { registerLLMController } from '../llm-controller'

const savedProfile: ModelProfile = {
  id: 'saved-profile-id',
  name: 'Saved profile',
  provider: 'custom',
  protocol: 'openai',
  modelName: 'manual-model',
  apiKey: `credential-${crypto.randomUUID()}`,
  baseUrl: 'https://provider.invalid/v1',
  temperature: 0.7,
  maxTokens: 4096,
  purposes: ['generation'],
}

const unsavedRequest: ModelDiscoveryRequest = {
  provider: savedProfile.provider,
  protocol: savedProfile.protocol,
  apiKey: savedProfile.apiKey,
  baseUrl: savedProfile.baseUrl,
  purposes: ['embedding'],
}

beforeAll(() => {
  registerLLMController()
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.models = []
  mocks.discoverModels.mockResolvedValue({
    success: true,
    models: [{ id: 'provider-model', name: 'Provider Model', value: 'provider-model' }],
  })
})

describe('llm model discovery controller boundary', () => {
  it('discovers from the current unsaved renderer form without requiring a saved profile', async () => {
    const handler = mocks.handlers.get('llm:discover-models')
    if (!handler) throw new Error('Missing llm:discover-models handler')

    const result = await handler({}, unsavedRequest)

    expect(mocks.discoverModels).toHaveBeenCalledWith(unsavedRequest)
    expect(JSON.stringify(result)).not.toContain(savedProfile.apiKey)
  })

  it('returns model metadata without exposing saved API keys', async () => {
    mocks.models = [savedProfile]
    const handler = mocks.handlers.get('llm:list-models')
    if (!handler) throw new Error('Missing llm:list-models handler')

    const result = await handler({}) as ModelProfile[]

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: savedProfile.id, apiKey: REDACTED_MODEL_API_KEY })
    expect(JSON.stringify(result)).not.toContain(savedProfile.apiKey)
  })

  it('resolves a redacted saved key only inside the main-process discovery boundary', async () => {
    mocks.models = [savedProfile]
    const handler = mocks.handlers.get('llm:discover-models')
    if (!handler) throw new Error('Missing llm:discover-models handler')

    const request: ModelDiscoveryRequest = {
      modelId: savedProfile.id,
      provider: savedProfile.provider,
      protocol: savedProfile.protocol,
      apiKey: REDACTED_MODEL_API_KEY,
      baseUrl: savedProfile.baseUrl,
      purposes: savedProfile.purposes,
    }
    await handler({}, request)

    expect(mocks.discoverModels).toHaveBeenCalledWith({ ...request, apiKey: savedProfile.apiKey })
  })

  it('never persists the renderer placeholder as a credential for a brand-new profile', async () => {
    const handler = mocks.handlers.get('llm:save-model')
    if (!handler) throw new Error('Missing llm:save-model handler')
    expect(mocks.models).toEqual([])

    const result = await handler({}, {
      id: 'copied-profile-id',
      name: 'Copied profile',
      provider: 'custom',
      protocol: 'openai',
      modelName: 'manual-model',
      apiKey: REDACTED_MODEL_API_KEY,
      baseUrl: 'https://provider.invalid/v1',
      temperature: 0.7,
      maxTokens: 4096,
      purposes: ['generation'],
    }) as { success: boolean }

    expect(result.success).toBe(true)
    const written = mocks.writeJsonFile.mock.calls.at(-1)?.[1] as ModelProfile[]
    // 新 id 没有磁盘上的真 Key 可沿用；把占位符写进去会让这份配置此后一直
    // 显示「已保存 Key」，实际请求必然 401。
    expect(written.at(-1)?.apiKey).toBe('')
    expect(JSON.stringify(written)).not.toContain(REDACTED_MODEL_API_KEY)
  })
})
