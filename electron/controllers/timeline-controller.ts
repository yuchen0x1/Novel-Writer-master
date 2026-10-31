import { ipcMain } from 'electron'

import type { ProjectSessionContext } from '../../src/shared/ipc-channels'
import { getCurrentProjectPath } from '../database'
import { projectAccess } from '../services/project-access'
import { readTimeline, writeTimeline } from '../services/timeline-store'

function samePath(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right
  return projectAccess.sameCanonicalProjectRoot(left, right)
}

/** 时间线属于当前作品：租约、当前库路径与调用方声明的路径三者必须一致。 */
function assertTimelineSession(context: ProjectSessionContext, expectedProjectPath: string): void {
  if (typeof expectedProjectPath !== 'string' || !expectedProjectPath) {
    throw new Error('PROJECT_CONTEXT_REQUIRED')
  }
  const lease = projectAccess.assertCurrentSession(context)
  if (!samePath(lease.rootPath, expectedProjectPath) || !samePath(getCurrentProjectPath(), expectedProjectPath)) {
    throw new Error('PROJECT_SESSION_STALE')
  }
}

export interface TimelineControllerOptions {
  ipc?: Pick<typeof ipcMain, 'handle'>
}

export function registerTimelineController({ ipc = ipcMain }: TimelineControllerOptions = {}): void {
  ipc.handle('timeline:read', async (_event, expectedProjectPath: string, context: ProjectSessionContext) => {
    assertTimelineSession(context, expectedProjectPath)
    return readTimeline(expectedProjectPath)
  })

  ipc.handle('timeline:save', async (
    _event,
    document: unknown,
    expectedProjectPath: string,
    context: ProjectSessionContext,
  ) => {
    assertTimelineSession(context, expectedProjectPath)
    return writeTimeline(expectedProjectPath, document)
  })
}

