import { useCallback, useEffect, useMemo, useState } from 'react'

import { displayedErrorMessage } from '../../../i18n/app-errors'
import { ipc } from '../../../services/ipc-client'
import { projectSessionContextFromProject } from '../../../shared/project-session-context'
import { nextSceneId, parseSceneDocument, scenesForChapter, type SceneCard, type SceneDocument } from '../../../shared/scene-cards'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'

export type SceneCardInput = Omit<SceneCard, 'id'> & { id?: string }

export function useSceneCards(projectKey: string) {
  const project = useProjectStore(s => s.currentProject)
  const text = useLocaleStore(s => s.text)
  const session = useMemo(() => {
    const current = projectSessionContextFromProject(project)
    return current?.projectPath === projectKey ? current : null
  }, [project, projectKey])
  const [document, setDocument] = useState<SceneDocument | null>(null)
  const [loadedLease, setLoadedLease] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const visibleDocument = session && loadedLease === session.leaseId ? document : null

  useEffect(() => {
    if (!session) return
    let cancelled = false
    void ipc.invokeWithProjectSession(session, 'db:scene-card-get-all', session.projectPath)
      .then(value => {
        if (cancelled) return
        setDocument(parseSceneDocument({ scenes: value }))
        setLoadedLease(session.leaseId)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(displayedErrorMessage(useLocaleStore.getState().locale, cause))
      })
    return () => { cancelled = true }
  }, [session])

  const saveScene = useCallback(async (input: SceneCardInput) => {
    if (!visibleDocument || !session || loadedLease !== session.leaseId) return
    const scene: SceneCard = {
      ...input,
      id: input.id ?? nextSceneId(visibleDocument.scenes),
      title: input.title.trim(),
      participants: [...new Set(input.participants.map(item => item.trim()).filter(Boolean))],
    }
    setSaving(true)
    setError(null)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:scene-card-upsert', scene, session.projectPath)
      if (!result.success || !result.scene) throw new Error(result.error || 'SCENE_CARD_SAVE_FAILED')
      setDocument(current => current ? parseSceneDocument({ scenes: [...current.scenes.filter(item => item.id !== result.scene!.id), result.scene!] }) : current)
      setLoadedLease(session.leaseId)
    } catch (cause) {
      setError(displayedErrorMessage(useLocaleStore.getState().locale, cause, text('场景卡保存失败', 'Could not save scene card')))
      throw cause
    } finally { setSaving(false) }
  }, [visibleDocument, loadedLease, session, text])

  const deleteScene = useCallback(async (id: string) => {
    if (!visibleDocument || !session || loadedLease !== session.leaseId) return
    setSaving(true)
    setError(null)
    try {
      const result = await ipc.invokeWithProjectSession(session, 'db:scene-card-delete', id, session.projectPath)
      if (!result.success) throw new Error(result.error || 'SCENE_CARD_DELETE_FAILED')
      setDocument(current => current ? { ...current, scenes: current.scenes.filter(scene => scene.id !== id) } : current)
    } catch (cause) {
      setError(displayedErrorMessage(useLocaleStore.getState().locale, cause, text('场景卡删除失败', 'Could not delete scene card')))
      throw cause
    } finally { setSaving(false) }
  }, [visibleDocument, loadedLease, session, text])

  const byChapter = useCallback((chapterNumber: number) => visibleDocument ? scenesForChapter(visibleDocument, chapterNumber) : [], [visibleDocument])
  return { document: visibleDocument, saving, error, byChapter, saveScene, deleteScene }
}
