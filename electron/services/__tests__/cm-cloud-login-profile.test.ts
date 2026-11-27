import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import type { CmCloudProjectSessionContext } from '../../../src/shared/cm-cloud'

const mocks = vi.hoisted(() => ({
  activeRootPath: '/tmp/project-a',
  assertCurrentProjectContext: vi.fn(),
}))

vi.mock('../project-access', () => ({
  projectAccess: {
    assertCurrentProjectContext: mocks.assertCurrentProjectContext,
    sameCanonicalProjectRoot: (left: string, right: string) => left === right,
  },
}))

import { CmCloudBackupService } from '../cm-cloud-backup-service'
import type { CmCloudCli } from '../cm-cloud-cli'
import type { CmCloudProjectConfig } from '../cm-cloud-config-store'

const projectSession: CmCloudProjectSessionContext = {
  projectId: 'project-a',
  leaseId: 'lease-a',
  projectPath: '/tmp/project-a',
}

function config(profile: string): CmCloudProjectConfig {
  return {
    enabled: true,
    disclosureConfirmed: true,
    profile,
    lastBackupAt: null,
    lastFileName: null,
    lastErrorCode: null,
    state: 'ready',
    dedicatedRootName: null,
  }
}

function createService(profile: string, status = 'SUCCESS') {
  const login = vi.fn(async (profile: string) => {
    void profile
    return {
      command: 'auth login',
      envelope: status === 'SUCCESS'
        ? { status: 'SUCCESS', data: {} }
        : { status, data: { authPageUrl: 'https://cloud.example/auth' } },
    }
  })
  const service = new CmCloudBackupService({
    cli: { login } as unknown as CmCloudCli,
    configStore: { get: () => config(profile) } as never,
    getCurrentProjectPath: () => mocks.activeRootPath,
  })
  return { service, login }
}

mocks.assertCurrentProjectContext.mockImplementation((context: CmCloudProjectSessionContext) => {
  if (context.projectPath !== mocks.activeRootPath) throw new Error('PROJECT_SESSION_ROOT_MISMATCH')
  return { projectId: context.projectId, leaseId: context.leaseId, rootPath: mocks.activeRootPath, kind: 'manifest' }
})

describe('cm-cloud login binds the credential to the profile backups actually read', () => {
  it('authenticates the configured profile instead of a hardcoded default', async () => {
    const { service, login } = createService('work')

    const result = await service.login(projectSession)

    expect(login).toHaveBeenCalledTimes(1)
    expect(login.mock.calls[0]![0]).toBe('work')
    expect(result.state).toBe('authorized')
  })

  it('still uses the default profile when the project never set one', async () => {
    const { service, login } = createService('default')

    await service.login(projectSession)

    expect(login.mock.calls[0]![0]).toBe('default')
  })

  it('rejects a session whose project root is not the active project', async () => {
    const { service, login } = createService('work')

    await expect(service.login({ ...projectSession, projectPath: '/tmp/other-project' }))
      .rejects.toMatchObject({ code: 'CM_CLOUD_PROJECT_SESSION_REQUIRED' })
    expect(login).not.toHaveBeenCalled()
  })

  it('surfaces the pending authorization page without inventing an authorized state', async () => {
    const { service } = createService('work', 'AUTH_REQUIRED')

    await expect(service.login(projectSession)).resolves.toEqual({
      state: 'pending',
      authPageUrl: 'https://cloud.example/auth',
    })
  })

  it('keeps a committed backup successful when the author switched projects during upload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-novel-cm-cloud-completion-'))
    let savedConfig = config('work')
    const authStatus = vi.fn(async () => { throw new Error('AUTH_PROBE_SHOULD_NOT_RUN_AFTER_COMMIT') })
    const service = new CmCloudBackupService({
      cli: {
        runtime: async () => ({ available: true, pythonCommand: 'python' }),
        agentInfo: async () => ({ envelope: { status: 'SUCCESS', data: {
          dedicatedRoot: { rootRef: 'backup-root', namePath: '/backups' },
        } } }),
        upload: async () => {
          mocks.activeRootPath = '/tmp/project-b'
          return { envelope: { status: 'SUCCESS', data: { fileName: 'committed.ainovel' } } }
        },
        authStatus,
      } as unknown as CmCloudCli,
      configStore: {
        get: () => ({ ...savedConfig }),
        save: (_projectId: string, patch: Partial<CmCloudProjectConfig>) => {
          savedConfig = { ...savedConfig, ...patch }
          return { ...savedConfig }
        },
      } as never,
      getCurrentProjectPath: () => mocks.activeRootPath,
      getGlobalDataRoot: () => root,
      exportPortableProject: async () => ({} as never),
    })
    try {
      await expect(service.backup({ projectSession, manual: true })).resolves.toMatchObject({
        uploadedName: 'committed.ainovel',
        status: { state: 'backup-complete', authenticated: true },
      })
      expect(savedConfig.state).toBe('backup-complete')
      expect(savedConfig.lastErrorCode).toBeNull()
      expect(authStatus).not.toHaveBeenCalled()
    } finally {
      mocks.activeRootPath = projectSession.projectPath
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
