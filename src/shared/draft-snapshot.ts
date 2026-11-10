/**
 * 章节草稿的自动快照：每次生成落稿与正文保存时记录一份内容，
 * 恢复时用快照内容新建一稿，不覆盖、不删除任何已有稿。
 */
export type DraftSnapshotSource = 'create' | 'save'

export interface DraftSnapshotMeta {
  snapshotId: number
  draftId: number
  chapterNumber: number
  source: DraftSnapshotSource
  wordCount: number
  contentHash: string
  createdAt: string
}

/** 每稿保留的快照上限；超出后丢最旧的。 */
export const DRAFT_SNAPSHOT_KEEP = 30

/** 版本切换器里最多展示的快照条数。 */
export const DRAFT_SNAPSHOT_SHOWN = 10
