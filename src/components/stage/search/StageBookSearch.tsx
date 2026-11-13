import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { ipc } from '../../../services/ipc-client'
import { displayedErrorMessage } from '../../../i18n/app-errors'
import { navigate } from '../../../stores/navigation/navigation-intents'
import { openBuiltinEditor } from '../../../stores/open-builtin-editor'
import { useLocaleStore } from '../../../stores/locale-store'
import { useProjectStore } from '../../../stores/project-store'
import { projectSessionContextFromProject, sameProjectSessionContext } from '../../../shared/project-session-context'
import type { ProjectSessionContext } from '../../../shared/ipc-channels'
import { BOOK_SEARCH_MAX_TERMS, findSearchHighlights, parseSearchTerms, type BookSearchHit, type BookSearchResult, type BookSearchScope } from '../../../shared/book-search'
import { pluralEn } from '../../../shared/plural-en'

type Text = (zh: string, en: string) => string

const SCOPE_NAMES: Record<BookSearchScope, [string, string]> = {
  chapter: ['正文', 'Manuscript'],
  blueprint: ['蓝图', 'Blueprint'],
  character: ['角色', 'Cast'],
  outline: ['设定', 'Setup'],
}

const FIELD_NAMES: Record<string, [string, string]> = {
  content: ['正文', 'Text'],
  title: ['标题', 'Title'],
  purpose: ['核心目的', 'Purpose'],
  keyEvents: ['关键事件', 'Key events'],
  suspenseHook: ['悬念钩子', 'Suspense hook'],
  userGuidance: ['作者指导', 'Guidance'],
  notes: ['备注', 'Notes'],
  name: ['角色名', 'Name'],
  role: ['定位', 'Role'],
  appearance: ['外貌', 'Appearance'],
  personality: ['性格', 'Personality'],
  background: ['背景', 'Background'],
  abilities: ['能力', 'Abilities'],
  motivation: ['动机', 'Motivation'],
  relationships: ['关系', 'Relationships'],
  arc: ['弧光', 'Arc'],
  premise: ['故事前提', 'Premise'],
  worldbuilding: ['世界观', 'World'],
  synopsis: ['情节大纲', 'Outline'],
  coreOutline: ['核心大纲', 'Core outline'],
  worldSetting: ['世界设定', 'World setting'],
  goldenFinger: ['金手指', 'Golden finger'],
  protagonistProfile: ['主角档案', 'Protagonist'],
  writingStyle: ['文风', 'Style'],
  globalGuidance: ['行文指导', 'Guidance'],
}

function hitTitle(hit: BookSearchHit, text: Text): string {
  if (hit.scope === 'chapter') {
    const title = hit.title.trim()
    return text(`第 ${hit.chapterNumber} 章${title ? ` · ${title}` : ''}`, `Chapter ${hit.chapterNumber}${title ? ` · ${title}` : ''}`)
  }
  if (hit.scope === 'blueprint') {
    const title = hit.title.trim()
    return text(`第 ${hit.chapterNumber} 章${title ? ` · ${title}` : ''}`, `Chapter ${hit.chapterNumber}${title ? ` · ${title}` : ''}`)
  }
  return hit.title || text('未命名', 'Unnamed')
}

/** 点击命中跳到对应页面：章节直接打开那一章，其余打开各自的工作台。 */
function openHit(hit: BookSearchHit, text: Text): void {
  if (hit.scope === 'chapter' && hit.chapterNumber !== undefined) {
    navigate({ kind: 'chapter', chapterNumber: hit.chapterNumber })
    return
  }
  if (hit.scope === 'blueprint' && hit.chapterNumber !== undefined) {
    openBuiltinEditor('chapter-card-editor', text('章节蓝图', 'Chapter blueprint'), 'chapter-card', undefined, hit.chapterNumber)
    return
  }
  if (hit.scope === 'character') {
    openBuiltinEditor('character-editor', text('角色名单', 'Cast'), 'character')
    return
  }
  openBuiltinEditor('world-building-editor', text('故事架构', 'Story architecture'), 'world-building')
}

const EMPTY_RESULT: BookSearchResult = { query: '', totalMatches: 0, hits: [], truncated: false }

function HighlightedSnippet({ content, terms }: { content: string; terms: string[] }) {
  let cursor = 0
  const parts = findSearchHighlights(content, terms).flatMap(match => {
    const before = content.slice(cursor, match.index)
    cursor = match.index + match.length
    return [before, <mark key={match.index}>{content.slice(match.index, cursor)}</mark>]
  })
  return <>{parts}{content.slice(cursor)}</>
}

/** A new lease gets a fresh UI, even when the same book is reopened. */
export default function StageBookSearch() {
  const project = useProjectStore(s => s.currentProject)
  const text = useLocaleStore(s => s.text)
  const session = useMemo(() => projectSessionContextFromProject(project), [project])
  if (!session) return <p className="stage-search-empty" role="status">{text('请先打开作品再检索。', 'Open a project to search.')}</p>
  return <ProjectBookSearch key={JSON.stringify([session.projectId, session.leaseId, session.projectPath])} session={session} />
}

/**
 * 全书检索：在正文最新稿、章节蓝图、角色与架构设定里查关键词。
 * 查询在主进程完成，这里只拿到摘录；点一条命中就跳到相应页面。
 * 结果与失败都带各自的查询词：词一变，旧结果自动失效，不用手动清状态。
 */
function ProjectBookSearch({ session }: { session: ProjectSessionContext }) {
  const text = useLocaleStore(s => s.text)
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<BookSearchResult | null>(null)
  const [failed, setFailed] = useState<{ query: string; message: string } | null>(null)
  const searchRequest = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [composing, setComposing] = useState(false)
  const [scope, setScope] = useState<BookSearchScope | 'all'>('all')
  const keywords = useMemo(() => parseSearchTerms(query), [query])

  const terms = useMemo(() => query.trim(), [query])
  const current = result?.query === terms ? result : EMPTY_RESULT
  const searching = !composing && terms !== '' && failed?.query !== terms && result?.query !== terms
  const isCurrentSession = useCallback(() => sameProjectSessionContext(session, projectSessionContextFromProject(useProjectStore.getState().currentProject)), [session])

  useEffect(() => {
    const request = ++searchRequest.current
    if (terms === '' || composing) return
    let active = true
    const timer = window.setTimeout(() => {
      if (!isCurrentSession()) return
      Promise.resolve().then(() => ipc.invokeWithProjectSession(session, 'db:book-search', terms, session.projectPath))
        .then((value: BookSearchResult) => {
          if (!active || request !== searchRequest.current || !isCurrentSession()) return
          setResult({ ...value, query: terms })
          setFailed(null)
        })
        .catch((error: unknown) => {
          if (!active || request !== searchRequest.current || !isCurrentSession()) return
          setFailed({ query: terms, message: displayedErrorMessage(useLocaleStore.getState().locale, error) })
        })
    }, 280)
    return () => { active = false; window.clearTimeout(timer) }
  }, [terms, attempt, composing, isCurrentSession, session])

  const retry = () => { setFailed(null); setResult(null); setAttempt(value => value + 1) }
  const updateQuery = (value: string) => {
    if (value.trim() !== terms) { setResult(null); setFailed(null) }
    setQuery(value)
  }
  const clear = () => { updateQuery(''); input.current?.focus() }

  const groups = useMemo(() => {
    const order: BookSearchScope[] = ['chapter', 'blueprint', 'character', 'outline']
    return order
      .map(scope => ({ scope, hits: current.hits.filter(hit => hit.scope === scope) }))
      .filter(group => group.hits.length > 0 && (scope === 'all' || group.scope === scope))
  }, [current, scope])

  const summary = (() => {
    if (terms === '' || composing || failed?.query === terms) return ''
    if (searching) return text('正在检索…', 'Searching…')
    if (current.totalMatches === 0) {
      return text(`没有找到「${terms}」`, `No matches for “${terms}”`)
    }
    const hits = current.hits.length
    return text(
      `「${terms}」：${current.totalMatches} 处命中，列出 ${hits} 条`,
      `“${terms}”: ${current.totalMatches} matches, showing ${hits} ${pluralEn(hits, 'hit')}`,
    )
  })()

  return (
    <div className="stage-search">
      <header className="stage-search-head">
        <h2 className="stage-search-title">{text('全书检索', 'Book search')}</h2>
        <p className="stage-search-help">
          {text(`在正文最新稿、蓝图、角色与设定里查找。空格分词，最多 ${BOOK_SEARCH_MAX_TERMS} 个词，都要出现才算命中。`, `Search manuscripts, blueprints, cast and setup. Separate up to ${BOOK_SEARCH_MAX_TERMS} terms with spaces; every term must appear.`)}
        </p>
        <div className="stage-search-box">
          <Search size={15} aria-hidden="true" />
          <input
            ref={input}
            className="stage-search-input"
            type="text"
            value={query}
            onChange={event => updateQuery(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); clear() } }}
            placeholder={text('输入关键词…', 'Type a keyword…')}
            aria-label={text('检索关键词', 'Search keyword')}
          />
          {query !== '' && (
            <button type="button" className="stage-search-clear" onClick={clear} aria-label={text('清空', 'Clear')}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="stage-search-filters" role="group" aria-label={text('筛选已返回的结果', 'Filter returned results')}>
          {(['all', ...Object.keys(SCOPE_NAMES)] as Array<BookSearchScope | 'all'>).map(value => (
            <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)}>
              {value === 'all' ? text('全部', 'All') : text(...SCOPE_NAMES[value])}
              {' '}({value === 'all' ? current.hits.length : current.hits.filter(hit => hit.scope === value).length})
            </button>
          ))}
        </div>
      </header>
      <div className="stage-search-results" aria-busy={searching}>
        {terms === '' && <p className="stage-search-empty">{text('输入人物、地点或情节关键词，查找它们在作品中的出现位置。', 'Enter a character, place or plot keyword to find it in your project.')}</p>}
        {failed?.query === terms && terms !== ''
          ? <div className="stage-search-empty" role="alert">
            {text('检索失败：', 'Search failed: ')}{failed.message}
            <button type="button" className="stage-search-retry" onClick={retry}>{text('重试检索', 'Retry search')}</button>
          </div>
          : <>
            {summary !== '' && <p className="stage-search-summary" role="status">{summary}</p>}
            {current.truncated && (
              <p className="stage-search-more">{text('命中太多，只列出前一部分。换个更具体的关键词可以收窄。', 'Too many matches — only the first part is listed. A more specific keyword narrows the list.')}</p>
            )}
            {terms !== '' && !composing && !searching && current.totalMatches === 0 && (
              <p className="stage-search-empty">
                {text('换个更短或更常见的关键词试试。检索范围是最新一稿的正文、蓝图、角色卡与架构设定。', 'Try a shorter or more common keyword. The search covers the latest draft of each chapter, blueprints, character cards and settings.')}
              </p>
            )}
            {!searching && !composing && current.hits.length > 0 && groups.length === 0 && <p className="stage-search-empty">{text('已返回的结果中没有这一类命中，可切换到「全部」。', 'No returned hits in this category. Select All to see other results.')}</p>}
            {groups.map(group => (
              <section key={group.scope} className="stage-search-group" aria-label={text(...SCOPE_NAMES[group.scope])}>
                <h3 className="stage-search-group-name">
                  {text(...SCOPE_NAMES[group.scope])}
                  {' '}
                  {text(`（${group.hits.length}）`, `(${group.hits.length})`)}
                </h3>
                <ul className="stage-search-list">
                  {group.hits.map((hit, index) => (
                    <li key={`${hit.scope}-${hit.chapterNumber ?? hit.title}-${hit.field}-${index}`}>
                      <button type="button" className="stage-search-hit" onClick={() => { if (isCurrentSession()) openHit(hit, text) }}>
                        <span className="stage-search-hit-head">
                          <span className="stage-search-hit-title">{hitTitle(hit, text)}</span>
                          <span className="stage-search-hit-field">{text(...(FIELD_NAMES[hit.field] ?? [hit.field, hit.field]))}</span>
                          <span className="stage-search-hit-count">
                            {text(`${hit.matches} 处`, `${hit.matches} ${pluralEn(hit.matches, 'match')}`)}
                          </span>
                        </span>
                        <span className="stage-search-hit-snippet"><HighlightedSnippet content={hit.snippet} terms={keywords} /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>}
      </div>
    </div>
  )
}
