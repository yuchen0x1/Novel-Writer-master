/**
 * 写作目标的纯函数层：按"本机日期"累计每天的字数增量，再据此算连续天数与热力图等级。
 *
 * 这里刻意不碰存储与时区服务：日期一律由调用方传入 `now`，测试与跨时区行为都可复现。
 * 字数单位与编辑器一致（countDraftUnits），中文按字、英文按词。
 */

export type WritingLedger = Readonly<Record<string, number>>

export const WRITING_GOAL_DEFAULT = 2000
export const WRITING_GOAL_MIN = 100
export const WRITING_GOAL_MAX = 50000
/** 只保留半年：更老的记录对"连续天数"和热力图都没有意义，留着只是让本地存储越来越胖。 */
export const WRITING_LEDGER_KEEP_DAYS = 180
export const WRITING_HEATMAP_DAYS = 84

/** 本机日期键 YYYY-MM-DD（不是 UTC：作者眼里的"今天"是本地日历）。 */
export function localDayKey(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function shiftDays(now: Date, days: number): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  next.setDate(next.getDate() + days)
  return next
}

/** 只累计正向增量：删改、回退不应该把"今天写了多少"扣回去。 */
export function addWords(ledger: WritingLedger, day: string, delta: number): WritingLedger {
  if (!isCalendarDay(day) || !Number.isFinite(delta) || Math.round(delta) <= 0) return ledger
  return { ...ledger, [day]: Math.min(Number.MAX_SAFE_INTEGER, wordsOn(ledger, day) + Math.round(delta)) }
}

/** Validate actual calendar days, including leap years, without UTC conversion. */
function isCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) return false
  const [year, month, date] = day.split('-').map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return year > 0 && month >= 1 && month <= 12 && date >= 1 && date <= lengths[month - 1]
}

export function pruneLedger(ledger: WritingLedger, now: Date, keepDays = WRITING_LEDGER_KEEP_DAYS): WritingLedger {
  const oldest = localDayKey(shiftDays(now, -(keepDays - 1)))
  const kept: Record<string, number> = {}
  for (const [day, words] of Object.entries(ledger)) {
    if (isCalendarDay(day) && day >= oldest && Number.isFinite(words) && words > 0) kept[day] = words
  }
  return kept
}

export function wordsOn(ledger: WritingLedger, day: string): number {
  const value = ledger[day]
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 连续写作天数。今天还没写不算断：只要昨天写了，连续记录仍然成立，
 * 等今天结束后才归零——否则作者早上打开应用就会看到"连续 0 天"。
 */
export function currentStreak(ledger: WritingLedger, now: Date): number {
  let cursor = wordsOn(ledger, localDayKey(now)) > 0 ? 0 : -1
  let streak = 0
  for (;;) {
    const words = wordsOn(ledger, localDayKey(shiftDays(now, cursor)))
    if (words <= 0) break
    streak += 1
    cursor -= 1
  }
  return streak
}

export function goalPercent(words: number, goal: number): number {
  if (!Number.isFinite(words) || !Number.isFinite(goal) || goal <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((words / goal) * 100)))
}

/** 0 = 没写，1 = 不足一半，2 = 过半，3 = 达标，4 = 超额 150% 以上。 */
export function heatLevel(words: number, goal: number): 0 | 1 | 2 | 3 | 4 {
  if (!Number.isFinite(words) || words <= 0) return 0
  if (!Number.isFinite(goal) || goal <= 0) return 3
  if (words >= goal * 1.5) return 4
  if (words >= goal) return 3
  if (words >= goal * 0.5) return 2
  return 1
}

export interface HeatmapCell { date: string; words: number; level: 0 | 1 | 2 | 3 | 4 }

/** 最近 N 天（含今天）的格子，按时间正序，方便直接铺成 7 行的周列。 */
export function heatmapCells(ledger: WritingLedger, now: Date, goal: number, days = WRITING_HEATMAP_DAYS): HeatmapCell[] {
  const cells: HeatmapCell[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = localDayKey(shiftDays(now, -offset))
    const words = wordsOn(ledger, date)
    cells.push({ date, words, level: heatLevel(words, goal) })
  }
  return cells
}

export function normalizeGoal(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.trim() === '')) return WRITING_GOAL_DEFAULT
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return WRITING_GOAL_DEFAULT
  return Math.min(WRITING_GOAL_MAX, Math.max(WRITING_GOAL_MIN, Math.round(numeric)))
}

/** 解析本地存储：任何脏数据都退回空账本，不让它把统计页打成白屏。 */
export function parsePersistedGoal(raw: unknown): { dailyGoal: number; ledger: WritingLedger } {
  const empty = { dailyGoal: WRITING_GOAL_DEFAULT, ledger: {} as WritingLedger }
  if (typeof raw !== 'object' || raw === null) return empty
  const record = raw as { dailyGoal?: unknown; ledger?: unknown }
  const ledger: Record<string, number> = {}
  if (typeof record.ledger === 'object' && record.ledger !== null) {
    for (const [day, words] of Object.entries(record.ledger as Record<string, unknown>)) {
      if (isCalendarDay(day) && typeof words === 'number' && Number.isFinite(words) && Math.round(words) > 0) {
        ledger[day] = Math.min(Number.MAX_SAFE_INTEGER, Math.round(words))
      }
    }
  }
  return { dailyGoal: normalizeGoal(record.dailyGoal), ledger }
}

