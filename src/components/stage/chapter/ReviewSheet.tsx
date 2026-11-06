import { useState } from 'react'
import { Plus, RotateCcw } from 'lucide-react'
import type { useReviewChecklist, EditableReviewItem } from '../../editor/review-checklist'
import { includedCount, normalizeSeverity, severityCopy } from '../../editor/review-checklist'
import { analyzeChapterPacing } from '../../../shared/pacing-radar'
import { pluralEn } from '../../../shared/plural-en'
import { useLocaleStore } from '../../../stores/locale-store'
import { Button } from '../../ui/Button'
import { Check } from '../../ui/Check'
import { Notice } from '../../ui/Notice'
import { Sheet } from '../../ui/Sheet'
import { StatGrid } from '../../ui/StatGrid'

type Checklist = ReturnType<typeof useReviewChecklist>

/** 状态核对：本章蓝图出场、但动态状态停更在更早章节的角色（战力/伤势/位置等按作者确认记录）。 */
const STATE_FIELD_LABELS: Record<string, readonly [string, string]> = {
  location: ['位置', 'Location'],
  powerLevel: ['境界/战力', 'Power level'],
  physicalState: ['伤势', 'Physical state'],
  mentalState: ['心理', 'Mental state'],
  keyItems: ['随身物品', 'Key items'],
  recentEvents: ['近期事件', 'Recent events'],
}

function StaleStateSection({ characters }: { characters: readonly { name: string; lastChapter: number; fields: readonly string[] }[] }) {
  const text = useLocaleStore(s => s.text)
  if (characters.length === 0) return null
  return (
    <Notice tone="warn" title={text('状态核对', 'State check')}>
      <div className="stage-ch-stalelist">
        {characters.map(character => (
          <p key={character.name} className="stage-ch-staleitem">
            <strong>{character.name}</strong>
            {' · '}
            {text(`状态停更于第 ${character.lastChapter} 章`, `state last confirmed at chapter ${character.lastChapter}`)}
            {': '}
            {character.fields.map(field => text(STATE_FIELD_LABELS[field]?.[0] ?? field, STATE_FIELD_LABELS[field]?.[1] ?? field)).join(text('、', ', '))}
          </p>
        ))}
        <p className="stage-ch-stalehint">{text(
          '这些角色本章出场，但他们的动态状态停留在更早的作者确认记录；若正文与此冲突，请核对或在角色卡更新状态。',
          'These characters appear in this chapter, but their dynamic states were last confirmed earlier. If the prose conflicts, verify or update their character cards.',
        )}</p>
      </div>
    </Notice>
  )
}

/** 网文节奏雷达：本地统计当前草稿的对话占比、段落密度与章尾钩子，无需模型调用。 */
function PacingRadarSection({ draftText }: { draftText: string }) {
  const text = useLocaleStore(s => s.text)
  const locale = useLocaleStore(s => s.locale)
  if (!draftText.trim()) return null
  const metrics = analyzeChapterPacing(draftText)
  if (metrics.charCount < 200) return null
  const hookLabel = metrics.endingHook === 'strong' ? text('强钩子', 'Strong hook')
    : metrics.endingHook === 'weak' ? text('弱钩子', 'Weak hook')
      : text('无钩子', 'No hook')
  const hookHint = metrics.endingHook === 'strong' ? text('章尾留有悬念', 'The ending leaves suspense')
    : metrics.endingHook === 'weak' ? text('结尾略有转折或预告', 'The ending turns or previews slightly')
      : text('结尾平铺直叙，考虑加一个悬念', 'Flat ending; consider adding suspense')
  return (
    <section className="stage-ch-pacing" aria-label={text('节奏雷达', 'Pacing radar')}>
      <StatGrid
        label={text('本章节奏指标', 'Chapter pacing metrics')}
        items={[
          { id: 'dialogue', label: text('对话占比', 'Dialogue share'), value: `${Math.round(metrics.dialogueCharRatio * 100)}%` },
          { id: 'turns', label: text('对话轮数', 'Dialogue turns'), value: metrics.dialogueTurns.toLocaleString(locale) },
          { id: 'avgPara', label: text('平均段落字数', 'Avg. paragraph'), value: metrics.avgParagraphChars.toLocaleString(locale) },
          { id: 'longPara', label: text('长段占比', 'Long paragraphs'), value: `${Math.round(metrics.longParagraphRatio * 100)}%` },
          { id: 'hook', label: text('章尾钩子', 'Ending hook'), value: hookLabel, hint: hookHint },
        ]}
      />
      {(metrics.longParagraphRatio > 0.3 || metrics.endingHook === 'none') && (
        <Notice tone="warn" title={text('节奏提示', 'Pacing note')}>
          {[
            metrics.longParagraphRatio > 0.3 && text(
              `超过三成的段落长于 220 字，连载阅读容易疲劳；考虑在动作节点切段。`,
              `Over 30% of paragraphs exceed 220 characters — consider splitting at action beats for serialized reading.`,
            ),
            metrics.endingHook === 'none' && text(
              '章尾没有明显悬念钩子；网文连载通常期待一个让读者想点开下一章的收尾。',
              'The ending has no clear hook; serialized chapters usually close with a reason to open the next one.',
            ),
          ].filter(Boolean).join(text('；', '; '))}
        </Notice>
      )}
    </section>
  )
}

function FindingStatus({ item, checklist }: { item: EditableReviewItem; checklist: Checklist }) {
  const text = useLocaleStore(s => s.text)
  const finding = checklist.cycle?.findings.find(candidate => item.findingId
    ? candidate.findingId === item.findingId
    : candidate.reviewItemIndex === item.reviewItemIndex)
  const status = item.decision === 'waive' ? 'author-waived' : finding?.status ?? item.findingStatus
  const label = status === 'resolved' ? text('复验：已解决', 'Recheck: resolved')
    : status === 'unresolved' ? text('复验：未解决', 'Recheck: unresolved')
      : status === 'unknown' ? text('复验：待核实', 'Recheck: unknown')
        : status === 'author-waived' ? text('作者选择不修改', 'Author chose not to revise')
          : status === 'unverified' ? text('复验：未验证', 'Recheck: unverified')
            : null
  return label ? <span className="stage-ch-issue-status" data-status={status}>{label}</span> : null
}

/** 一条审稿意见：勾选即纳入修稿；作者补充的意见与点了「编辑」的意见展开成可改的字段。 */
function IssueCard({ item, checklist, onEdit }: {
  item: EditableReviewItem
  checklist: Checklist
  onEdit: (patch: Partial<EditableReviewItem>) => void
}) {
  const text = useLocaleStore(s => s.text)
  const [editing, setEditing] = useState(item.origin === 'author')
  const copy = severityCopy(item.severity, text)
  const isPass = item.severity === 'pass'
  const finding = checklist.cycle?.findings.find(candidate => item.findingId
    ? candidate.findingId === item.findingId
    : candidate.reviewItemIndex === item.reviewItemIndex)
  const canWaive = item.origin === 'ai' && Boolean(item.findingId ?? finding?.findingId) && finding?.status !== 'resolved'
  const tag = `${copy.label} · ${item.category}`
  const body = (
    <span className="stage-ch-issue-body">
      <span className="stage-ch-issue-tag" data-severity={item.severity}>{tag}</span>
      {!editing && <span className="stage-ch-issue-text">{item.description || text('（未填写）', '(empty)')}</span>}
      {!editing && item.quote && <q className="stage-ch-issue-quote">{item.quote}</q>}
      {item.sourceChapter && <span className="stage-ch-issue-meta">{text(`来源：第${item.sourceChapter}章`, `Source: Chapter ${item.sourceChapter}`)}</span>}
      <FindingStatus item={item} checklist={checklist} />
    </span>
  )
  return (
    <div className="stage-ch-issue" data-on={!isPass && item.decision === 'apply'} data-severity={item.severity}>
      {isPass
        ? <div className="stage-ch-issue-pass">{body}</div>
        : <Check checked={item.decision === 'apply'} onChange={checked => onEdit({ decision: checked ? 'apply' : 'ignore' })} label={body} />}
      {editing && !isPass && (
        <div className="stage-ch-issue-fields">
          <div className="stage-ch-issue-row">
            <input className="pi-input" aria-label={text('问题分类', 'Issue category')} value={item.category} onChange={event => onEdit({ category: event.target.value })} />
            <select
              className="pi-input"
              aria-label={text('严重程度', 'Severity')}
              value={item.severity}
              onChange={event => {
                const severity = normalizeSeverity(event.target.value)
                onEdit({ severity, ...(severity === 'unknown' ? { decision: 'ignore' } : {}) })
              }}
            >
              <option value="error">{text('严重问题', 'Critical issue')}</option>
              <option value="warning">{text('改进建议', 'Improvement')}</option>
              <option value="unknown">{text('待核实', 'Needs verification')}</option>
            </select>
          </div>
          <textarea
            className="pi-input stage-ch-textarea"
            aria-label={text('审稿问题', 'Review issue')}
            aria-invalid={item.origin === 'author' && !item.description.trim() || undefined}
            rows={3}
            value={item.description}
            placeholder={item.origin === 'author' ? text('写下要在这次修稿里解决的问题', 'Describe what this revision should fix') : undefined}
            onChange={event => onEdit({ description: event.target.value })}
          />
          <input
            className="pi-input"
            aria-label={text('相关原文（可选）', 'Related text (optional)')}
            placeholder={text('相关原文（可选）', 'Related text (optional)')}
            value={item.quote ?? ''}
            onChange={event => onEdit({ quote: event.target.value })}
          />
        </div>
      )}
      {!isPass && (
        <div className="stage-ch-issue-actions">
          <span className="stage-ch-issue-hint">{copy.actionLabel}</span>
          {item.origin === 'ai' && (
            <Button variant="text" size="sm" onClick={() => setEditing(value => !value)}>{editing ? text('收起', 'Done') : text('编辑', 'Edit')}</Button>
          )}
          {canWaive && (
            <Button variant="text" size="sm" onClick={() => onEdit({ decision: item.decision === 'waive' ? 'ignore' : 'waive' })}>
              {item.decision === 'waive' ? text('重新选择', 'Choose again') : text('不修改此项', 'Do not revise this item')}
            </Button>
          )}
          {item.origin === 'author' && (
            <Button variant="text" size="sm" onClick={() => checklist.removeItem(item.id)}>{text('移除', 'Remove')}</Button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 单章视图的审稿侧页（ReviewReport 的数据逻辑）：严重、建议、待核实三格统计，逐条勾选纳入修稿，
 * 添加作者意见与总体修稿指导，合并后复验未完成时可重试。勾选数与章节动作条上的「按 N 项意见修稿」同步。
 */
export default function ReviewSheet({ checklist, subtitle, reportText, draftText, staleStateCharacters, onClose }: {
  checklist: Checklist
  subtitle: string
  reportText: string
  /** 当前草稿正文；传入后显示本地节奏雷达（无需模型）。 */
  draftText?: string
  /** 本章蓝图出场但动态状态停更在更早章节的角色。 */
  staleStateCharacters?: readonly { name: string; lastChapter: number; fields: readonly string[] }[]
  onClose: () => void
}) {
  const text = useLocaleStore(s => s.text)
  const { items, cycle } = checklist
  const actionable = items.filter(item => item.severity !== 'pass')
  const passed = items.length - actionable.length
  const count = (severity: EditableReviewItem['severity']) => items.filter(item => item.severity === severity).length
  // 改动已确认的清单就是重新编辑：之后修稿前会再确认一次。
  const edit = (item: EditableReviewItem, patch: Partial<EditableReviewItem>) => {
    checklist.updateItem(item.id, patch)
    checklist.setEditingChecklist(true)
  }

  return (
    <Sheet
      open
      title={text('审稿报告', 'Review report')}
      subtitle={subtitle}
      closeLabel={text('关闭审稿报告', 'Close review report')}
      onClose={onClose}
      footer={(
        <div className="stage-ch-sheet-foot">
          <span>{text('勾选的意见会用于修稿', 'Checked notes are used for the revision')}</span>
          <span className="stage-ch-sheet-count">{includedCount(items)} / {actionable.length}</span>
        </div>
      )}
    >
      <StatGrid
        label={text('审稿统计', 'Review summary')}
        items={[
          { id: 'error', label: text('严重', 'Critical'), value: count('error') },
          { id: 'warning', label: text('建议', 'Suggestions'), value: count('warning') },
          { id: 'unknown', label: text('待核实', 'To verify'), value: count('unknown') },
        ]}
      />
      {draftText !== undefined && <PacingRadarSection draftText={draftText} />}
      {staleStateCharacters && <StaleStateSection characters={staleStateCharacters} />}
      {checklist.summary && <p className="stage-ch-sheet-summary">{checklist.summary}</p>}
      {checklist.goalReview && (
        <p className="stage-ch-sheet-note">
          {checklist.goalReview.coverage === 'complete'
            ? text('本章目标已逐项检查；覆盖完整不代表全部完成。', 'Chapter goals checked individually; full coverage does not mean all goals are completed.')
            : checklist.goalReview.coverage === 'not_configured'
              ? text('本章未配置可检查的目标，未进行目标验收。', 'No chapter goals are configured; goal acceptance was not performed.')
              : text('本章目标检查不完整，尚有待核实项。', 'Chapter goal review is incomplete and needs verification.')}
        </p>
      )}
      {cycle?.revisionStatus === 'merge-committed' && cycle.recheckDisposition === 'required' && (
        <Notice
          tone="warn"
          title={text('合并后复验还没完成', 'The post-merge recheck is incomplete')}
          actions={(
            <Button variant="secondary" size="sm" disabled={checklist.rechecking} onClick={() => void checklist.retryRequiredRecheck()}>
              <RotateCcw size={13} aria-hidden />{checklist.rechecking ? text('正在复验…', 'Rechecking…') : text('重试合并后复验', 'Retry post-merge recheck')}
            </Button>
          )}
        >
          {text('合并已保存。复验会检查这些意见是否已经解决，结果写回这份报告。', 'The merge is saved. The recheck verifies whether these notes were resolved and writes the result back to this report.')}
        </Notice>
      )}
      {checklist.recheckMessage && (
        <p role={checklist.recheckMessage.kind === 'error' ? 'alert' : 'status'} className="stage-ch-sheet-message" data-tone={checklist.recheckMessage.kind}>
          {checklist.recheckMessage.text}
        </p>
      )}
      {actionable.length === 0 && (
        <p className="stage-ch-sheet-note">
          {checklist.goalReview && checklist.goalReview.coverage !== 'complete'
            ? text('暂无已确认的检查结果', 'No confirmed review results yet')
            : text('审稿通过，未发现问题', 'Review passed. No issues found.')}
        </p>
      )}
      <div className="stage-ch-issues">
        {actionable.map(item => <IssueCard key={item.id} item={item} checklist={checklist} onEdit={patch => edit(item, patch)} />)}
      </div>
      <Button variant="text" size="sm" className="stage-ch-add" onClick={() => { checklist.addAuthorItem(); checklist.setEditingChecklist(true) }}>
        <Plus size={14} aria-hidden />{text('添加我的意见', 'Add my note')}
      </Button>
      <details className="stage-write-more stage-ch-guidance" open={Boolean(checklist.authorGuidance) || undefined}>
        <summary>{text('总体修稿指导', 'Overall revision guidance')}<small>{text('可选', 'Optional')}</small></summary>
        <textarea
          className="pi-input stage-ch-textarea"
          aria-label={text('总体修稿指导', 'Overall revision guidance')}
          rows={3}
          value={checklist.authorGuidance}
          placeholder={text('例如：优先修复角色动机的前后不一致，保持本章克制的节奏。', 'For example: fix the inconsistent motivation first and keep this chapter’s restrained pace.')}
          onChange={event => { checklist.setAuthorGuidance(event.target.value); checklist.setEditingChecklist(true) }}
        />
      </details>
      {checklist.confirmed && !checklist.editingChecklist && (
        <p className="stage-ch-sheet-note" role="status">{text('清单已确认，保存为新的不可变快照；原始 AI 审稿没有被修改。', 'The checklist is confirmed as a new immutable snapshot; the original AI review is unchanged.')}</p>
      )}
      {checklist.checklistError && <p role="alert" className="stage-ch-sheet-message" data-tone="error">{checklist.checklistError}</p>}
      {passed > 0 && (
        <details className="stage-ch-passed">
          <summary>{text(`检查通过 ${passed} 项`, `${passed} ${pluralEn(passed, 'check')} passed`)}</summary>
          {items.filter(item => item.severity === 'pass').map(item => <IssueCard key={item.id} item={item} checklist={checklist} onEdit={patch => edit(item, patch)} />)}
        </details>
      )}
      <details className="stage-ch-passed">
        <summary>{text('标记说明', 'What the marks mean')}</summary>
        <ul className="stage-ch-legend">
          {(['error', 'warning', 'unknown', 'pass'] as const).map(severity => {
            const copy = severityCopy(severity, text)
            return <li key={severity} data-severity={severity}><b>{copy.label}</b>{copy.actionLabel}</li>
          })}
        </ul>
      </details>
      <details className="stage-ch-passed">
        <summary>{checklist.confirmed ? text('查看此确认记录原文', 'View this confirmation record') : text('查看原始 AI 审稿文本', 'View original AI review text')}</summary>
        <pre className="stage-ch-raw">{reportText}</pre>
      </details>
    </Sheet>
  )
}
