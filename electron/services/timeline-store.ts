import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { EMPTY_TIMELINE, parseTimeline, type TimelineDocument } from '../../src/shared/timeline'
import { getProjectDataRoot } from './project-data-locator'

const TIMELINE_FILE = 'timeline.json'
/** 时间线是单文件 JSON，超过这个体量基本是写坏了；拒绝而不是硬写。 */
const MAX_TIMELINE_BYTES = 2 * 1024 * 1024

export function timelineFilePath(projectRoot: string): string {
  return path.join(getProjectDataRoot(projectRoot), TIMELINE_FILE)
}

/** 读不到或读坏都退回空时间线：文件是作者可手改的，坏掉不该让作品打不开。 */
export function readTimeline(projectRoot: string): TimelineDocument {
  try {
    const file = timelineFilePath(projectRoot)
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_TIMELINE_BYTES) return { ...EMPTY_TIMELINE, lanes: [], events: [] }
    return parseTimeline(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return { ...EMPTY_TIMELINE, lanes: [], events: [] }
  }
}

/**
 * 原子写：同目录临时文件 + rename。先校验再落盘，写出去的永远是 parse 归一化后的文档，
 * 上层看到的与磁盘上的保持一致。
 */
export async function writeTimeline(projectRoot: string, input: unknown): Promise<TimelineDocument> {
  const document = parseTimeline(input)
  const payload = JSON.stringify(document, null, 2)
  if (Buffer.byteLength(payload, 'utf8') > MAX_TIMELINE_BYTES) throw new Error('TIMELINE_TOO_LARGE')
  const file = timelineFilePath(projectRoot)
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  await fsp.mkdir(path.dirname(file), { recursive: true })
  try {
    await fsp.writeFile(temporary, payload, 'utf8')
    await fsp.rename(temporary, file)
  } finally {
    await fsp.rm(temporary, { force: true }).catch(() => {})
  }
  return document
}
