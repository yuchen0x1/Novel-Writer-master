/**
 * 网文节奏雷达 —— 针对连载小说的章节文本做轻量本地诊断。
 *
 * 全部为纯文本统计，不调用模型、不写库：调用方拿到的指标可以直接渲染
 * 成雷达图或列表。设计目标是「一眼看出节奏问题」：
 * - 对话占比：对话太少像说明文，太多像剧本；
 * - 平均段落长度 / 长段占比：大段文字是连载阅读最大的毒点；
 * - 对白轮换密度：回合制对话推进冲突；
 * - 章尾钩子：结尾是否留了悬念（问号、省略号、转折词、未闭合动作）。
 */

export interface PacingRadarMetrics {
  /** 全文字数（不含空白） */
  charCount: number
  /** 段落数 */
  paragraphCount: number
  /** 平均段落字数 */
  avgParagraphChars: number
  /** 超过 220 字的长段占比（0-1） */
  longParagraphRatio: number
  /** 对话字符占比（0-1）：被「」“”『』"" 包裹的文本 / 全文 */
  dialogueCharRatio: number
  /** 对话轮数（每个独立引号段算一轮） */
  dialogueTurns: number
  /** 描写/叙述段占比（0-1），1 - 对话占比的近似 */
  narrationRatio: number
  /** 章尾钩子判定：none（无钩子）/ weak（弱钩子）/ strong（强钩子） */
  endingHook: 'none' | 'weak' | 'strong'
  /** 钩子命中的提示（双语可渲染） */
  hookEvidence: string[]
}

/** 提取对话内容（合并引号内文本） */
export function extractDialogueText(text: string): string {
  const matches = text.match(/[“][^”]*[”]|[「][^」]*[」]|[『][^』]*[』]/gu) ?? []
  return matches.join('')
}

function splitParagraphs(text: string): string[] {
  return text.split(/\n{1,}/u).map(line => line.trim()).filter(Boolean)
}

/** 章尾钩子检测：取最后 ~200 字判断 */
export function detectEndingHook(text: string): { verdict: PacingRadarMetrics['endingHook']; evidence: string[] } {
  const tail = text.replace(/\s+/gu, ' ').trimEnd().slice(-220)
  if (!tail) return { verdict: 'none', evidence: [] }
  const evidence: string[] = []

  const strongPatterns: Array<[RegExp, readonly [string, string]]> = [
    [/[？?]\s*[”」』]?\s*$/u, ['结尾停在问句上（强悬念）', 'ends on a question (strong hook)']],
    [/(?:突然|忽然|猛地|骤然|蓦地)[^。！!…]*[。…]?$/u, ['结尾是突发动作（强钩子）', 'ends on a sudden action (strong hook)']],
    [/……\s*$/u, ['结尾留白（省略号）', 'ends with an ellipsis']],
    [/[^。！!…？?][，,][^。！!…？?]*$/u, ['结尾停在半句上', 'ends mid-sentence']],
  ]
  const weakPatterns: Array<[RegExp, readonly [string, string]]> = [
    [/(?:却|但|可是|然而|谁知|岂料|没想到)[^。！!…？?]*[。！!…？?]\s*$/u, ['结尾句含转折词', 'final sentence ends with a turn']],
    [/(?:下一[章刻步]|接下来|而这一切)[^。]{0,30}$/u, ['结尾预告后续', 'ends previewing what is next']],
  ]

  for (const [pattern, label] of strongPatterns) {
    if (pattern.test(tail)) {
      evidence.push(label[0])
      return { verdict: 'strong', evidence }
    }
  }
  for (const [pattern, label] of weakPatterns) {
    if (pattern.test(tail)) {
      evidence.push(label[0])
      return { verdict: 'weak', evidence }
    }
  }
  return { verdict: 'none', evidence }
}

/** 主入口：把一章正文转成节奏指标 */
export function analyzeChapterPacing(text: string): PacingRadarMetrics {
  const paragraphs = splitParagraphs(text)
  const visible = text.replace(/\s+/gu, '')
  const charCount = visible.length

  const paraStats = paragraphs.map(p => p.replace(/\s+/gu, '').length)
  const avgParagraphChars = paragraphs.length > 0 ? paraStats.reduce((a, b) => a + b, 0) / paragraphs.length : 0
  const longParagraphs = paraStats.filter(len => len > 220).length
  const longParagraphRatio = paragraphs.length > 0 ? longParagraphs / paragraphs.length : 0

  const dialogueText = extractDialogueText(text)
  const dialogueCharCount = dialogueText.replace(/[“”「」『』]/gu, '').replace(/\s+/gu, '').length
  // 对话占比的分母不含引号本身：占比 = 对话内容 / (对话内容 + 叙述内容)
  const quoteMarkCount = (text.match(/[“”「」『』]/gu) ?? []).length
  const narrationChars = Math.max(0, charCount - quoteMarkCount - dialogueCharCount)
  const proseChars = dialogueCharCount + narrationChars
  const dialogueCharRatio = proseChars > 0 ? Math.min(1, dialogueCharCount / proseChars) : 0
  const dialogueTurns = (dialogueText.match(/[“][^”]*[”]|[「][^」]*[」]|『[^』]*』/gu) ?? []).length

  const hook = detectEndingHook(text)

  return {
    charCount,
    paragraphCount: paragraphs.length,
    avgParagraphChars: Math.round(avgParagraphChars),
    longParagraphRatio,
    dialogueCharRatio,
    dialogueTurns,
    narrationRatio: Math.max(0, 1 - dialogueCharRatio),
    endingHook: hook.verdict,
    hookEvidence: hook.evidence,
  }
}

/** 与前后章对比，找状态连续性跳变（战力/伤势/位置）。输入是相邻章节 currentState 摘要文本。 */
export interface ContinuityJump {
  field: 'powerLevel' | 'physicalState' | 'location'
  previous: string
  current: string
  /** 是否可解释（同一字段值完全不同即提示，由调用方决定是否需要 AI 复核） */
  suspicious: boolean
}

export function detectContinuityJumps(
  previous: Partial<Record<'powerLevel' | 'physicalState' | 'location', string>> | null,
  current: Partial<Record<'powerLevel' | 'physicalState' | 'location', string>> | null,
): ContinuityJump[] {
  if (!previous || !current) return []
  const fields: ContinuityJump['field'][] = ['powerLevel', 'physicalState', 'location']
  const jumps: ContinuityJump[] = []
  for (const field of fields) {
    const prev = previous[field]?.trim() ?? ''
    const cur = current[field]?.trim() ?? ''
    if (!prev || !cur) continue
    if (prev !== cur) {
      jumps.push({ field, previous: prev, current: cur, suspicious: true })
    }
  }
  return jumps
}
