import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const errorMessage = error => error instanceof Error ? error.message : String(error)

function command(args, cwd) {
  const result = spawnSync('git', args, {
    cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { status: result.status ?? 128, text: result.stdout || '', error: result.error?.message || result.stderr || '' }
}
function git(args, cwd) {
  const result = command(args, cwd)
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.error}`)
  return result.text.trimEnd()
}
export function repositorySlug(remoteUrl) {
  return remoteUrl.match(/^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/i)?.[1]
}

export function scanBranches({ cwd = process.cwd(), baseRef, now = new Date() } = {}) {
  const resolvedBase = baseRef || git(['symbolic-ref', 'refs/remotes/origin/HEAD'], cwd)
  const fullBase = git(['rev-parse', '--symbolic-full-name', resolvedBase], cwd)
  if (!fullBase.startsWith('refs/remotes/')) throw new Error('Base must be a remote-tracking branch.')
  const [baseRemote, ...baseParts] = fullBase.slice('refs/remotes/'.length).split('/')
  const baseName = baseParts.join('/')
  const baseSha = git(['rev-parse', '--verify', `${fullBase}^{commit}`], cwd)
  const refs = git(['for-each-ref', '--format=%(refname)%09%(symref)%09%(objectname)%09%(committerdate:iso-strict)', 'refs/heads', 'refs/remotes'], cwd)
    .split(/\r?\n/).filter(Boolean).map(line => {
      const [ref, symbolic, sha, date] = line.split('\t')
      const local = ref.startsWith('refs/heads/')
      const parts = ref.slice(local ? 'refs/heads/'.length : 'refs/remotes/'.length).split('/')
      const remote = local ? null : parts.shift()
      return { ref, symbolic, sha, date, local, remote, name: parts.join('/') }
    }).filter(ref => !ref.symbolic)
  const worktrees = git(['worktree', 'list', '--porcelain'], cwd).split(/\r?\n/)
    .filter(line => line.startsWith('branch ')).map(line => line.slice(7))
  const remoteRepositories = new Map()
  for (const remote of new Set(refs.map(ref => ref.remote).filter(Boolean))) {
    remoteRepositories.set(remote, repositorySlug(git(['remote', 'get-url', remote], cwd)))
  }
  const rows = []
  for (const ref of refs) {
    const stable = ref.ref === fullBase || ref.ref === `refs/heads/${baseName}`
    const comparison = command(['rev-list', '--left-right', '--count', `${baseSha}...${ref.sha}`], cwd)
    const [behind, ahead] = comparison.status === 0 ? comparison.text.trim().split(/\s+/).map(Number) : [null, null]
    const diff = command(['diff', '--name-status', '--no-renames', '-z', `${baseSha}...${ref.sha}`], cwd)
    const tokens = diff.text.split('\0')
    const files = []
    for (let index = 0; index + 1 < tokens.length; index += 2) files.push({ status: tokens[index], path: tokens[index + 1] })
    const merge = ahead > 0 ? command(['merge-tree', '--write-tree', baseSha, ref.sha], cwd) : { status: 0 }
    const mergeState = comparison.status !== 0 ? 'unknown' : merge.status === 0 ? 'clean' : merge.status === 1 ? 'conflict' : 'unknown'
    rows.push({
      ...ref, stable, symbolic: undefined, ahead, behind, files,
      repository: remoteRepositories.get(ref.remote || baseRemote),
      checkedOut: ref.local && worktrees.includes(ref.ref),
      ageDays: Math.max(0, Math.floor((now.valueOf() - new Date(ref.date).valueOf()) / 86_400_000)),
      mergeState,
      treeSha: git(['rev-parse', `${ref.sha}^{tree}`], cwd),
      commits: git(['log', '-5', '--format=%H %s', `${baseSha}..${ref.sha}`], cwd).split(/\r?\n/).filter(Boolean),
      readError: comparison.status !== 0 || diff.status !== 0 || merge.status > 1,
    })
  }
  for (const row of rows) {
    row.sameTipAs = rows.filter(other => other.ref !== row.ref && other.sha === row.sha).map(other => other.ref)
    row.sameTreeAs = rows.filter(other => other.ref !== row.ref && other.treeSha === row.treeSha && other.sha !== row.sha).map(other => other.ref)
  }
  return {
    capturedAt: now.toISOString(), baseRef: fullBase, baseName, baseSha,
    repository: remoteRepositories.get(baseRemote),
    localCount: refs.filter(ref => ref.local).length,
    remoteCount: refs.filter(ref => !ref.local).length,
    dirty: Boolean(git(['status', '--porcelain'], cwd)), rows,
  }
}

export function createGitHubReader({ repository, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '')) throw new Error('Invalid GitHub repository identity.')
  return async pathname => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${pathname}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${pathname}`)
    return response.json()
  }
}
export async function readGitHubEvidence(api) {
  const evidence = { pullsKnown: false, branchesKnown: false, pulls: [], branches: [], errors: [] }
  try {
    for (let page = 1; ; page++) {
      const batch = await api(`/pulls?state=open&per_page=100&page=${page}`)
      evidence.pulls.push(...batch)
      if (batch.length < 100) break
    }
    evidence.pullsKnown = true
  } catch (error) { evidence.errors.push(errorMessage(error)) }
  try {
    for (let page = 1; ; page++) {
      const batch = await api(`/branches?per_page=100&page=${page}`)
      evidence.branches.push(...batch)
      if (batch.length < 100) break
    }
    evidence.branchesKnown = true
  } catch (error) { evidence.errors.push(errorMessage(error)) }
  // Keep PR identity even when one status API fails. Bounded sequential reads avoid a request burst.
  for (const pull of evidence.pulls) {
    pull.evidence = { complete: false, green: false, checks: [], errors: [] }
    try {
      const details = await api(`/pulls/${pull.number}`)
      if (details.head.sha !== pull.head.sha) throw new Error('PR head changed during audit.')
      pull.evidence.mergeable = details.mergeable
      pull.evidence.mergeableState = details.mergeable_state
      const runs = []
      for (let page = 1; ; page++) {
        const batch = await api(`/commits/${pull.head.sha}/check-runs?filter=latest&per_page=100&page=${page}`)
        runs.push(...batch.check_runs)
        if (runs.length >= batch.total_count) break
        if (batch.check_runs.length === 0) throw new Error('Check pagination incomplete.')
      }
      pull.evidence.checks = runs.map(run => ({ name: run.name, status: run.status, conclusion: run.conclusion }))
      const status = await api(`/commits/${pull.head.sha}/status`)
      pull.evidence.statusState = status.state
      pull.evidence.statusCount = status.total_count
      pull.evidence.complete = true
      pull.evidence.green = runs.length + status.total_count > 0
        && runs.every(run => run.status === 'completed' && run.conclusion === 'success')
        && (status.total_count === 0 || status.state === 'success')
    } catch (error) { pull.evidence.errors.push(errorMessage(error)) }
  }
  return evidence
}

export function classifyBranch(row, snapshot, github) {
  if (row.stable) return { category: 'BASE', reason: '稳定基线，始终保留。' }
  const associated = github.pulls.filter(pull => (pull.head?.repo?.full_name === row.repository && pull.head.ref === row.name)
    || (pull.base?.repo?.full_name === row.repository && pull.base.ref === row.name))
  const pr = associated.find(pull => pull.head?.repo?.full_name === row.repository && pull.head.ref === row.name)
  const remote = github.branches.find(branch => row.repository === snapshot.repository && branch.name === row.name)
  if (row.checkedOut) return { category: 'C', reason: '被 worktree 使用，保留。', pr }
  if (row.readError || row.mergeState === 'unknown') return { category: 'C', reason: 'Git 比较或冲突检测不完整。', pr }
  if (row.repository !== snapshot.repository) return { category: 'C', reason: '其他远程仓库，缺少其活动与保护证据。', pr }
  if (remote?.protected) return { category: 'C', reason: 'GitHub 标记为受保护分支。', pr }
  if (row.ahead === 0) {
    if (associated.length) return { category: 'C', reason: '提交已包含，但仍有关联的开放 PR。', pr }
    if (!github.pullsKnown || !github.branchesKnown || !remote || remote.commit.sha !== row.sha) {
      return { category: 'C', reason: '提交已包含；活动、保护或远程 tip 证据不全，暂不清理。', pr }
    }
    return { category: 'D', reason: '提交全部包含于基线；无开放 PR、非保护分支。仅建议清理，仍须确认开发依赖。', pr }
  }
  if (row.mergeState === 'conflict') return { category: 'C', reason: '存在合并冲突，保留待处理。', pr }
  if (!pr || pr.head.sha !== row.sha || pr.base.ref !== snapshot.baseName) return { category: 'C', reason: '无匹配 tip 且目标正确的开放 PR，保留。', pr }
  if (pr.draft) return { category: 'C', reason: 'PR 仍为草稿，开发未完成。', pr }
  const green = pr.evidence?.complete && pr.evidence.green
  return {
    category: 'B', pr,
    reason: green ? '已报告的检查通过；仍需代码兼容性、必需检查和审批策略审核。'
      : `等待验证或修复；${pr.evidence?.errors?.join('; ') || '检查缺失、未结束或未通过。'}`,
  }
}

const text = value => String(value ?? '—').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/[\r\n\t]/g, ' ').replaceAll('`', '&#96;')
export function renderReport(snapshot, github) {
  const classified = snapshot.rows.map(row => ({ ...row, ...classifyBranch(row, snapshot, github) }))
  const counts = Object.fromEntries(['A', 'B', 'C', 'D'].map(category => [category, classified.filter(row => row.category === category).length]))
  const lines = [
    '# Git 分支自动审计报告', '',
    `时间：${snapshot.capturedAt}；仓库：${text(snapshot.repository)}`, '',
    `基线：${text(snapshot.baseRef)} @ ${snapshot.baseSha}`, '',
    `本地 ${snapshot.localCount} 个 / 远程 ${snapshot.remoteCount} 个；工作区：${snapshot.dirty ? '含未提交改动' : '干净'}。`, '',
    `开放 PR：${github.pullsKnown ? github.pulls.length : '未知（读取不完整）'}。A=${counts.A}，B=${counts.B}，C=${counts.C}，D=${counts.D}；BASE 单列。同名本地与远程引用分开计数。`, '',
    ...github.errors.map(error => `- API 限制：${text(error)}`), '',
    '| 引用 | 最后提交 / 年龄 | ahead / behind | 合并树 | PR | 类别 | 结论 |',
    '|---|---|---:|---|---|---|---|',
  ]
  for (const row of classified) lines.push(`| ${text(row.ref)} | ${text(row.date)} / ${row.ageDays} 天 | ${row.ahead ?? '?'} / ${row.behind ?? '?'} | ${row.mergeState} | ${row.pr ? `#${row.pr.number}` : '—'} | ${row.category} | ${text(row.reason)} |`)
  lines.push('', '## 每个引用的证据', '')
  for (const row of classified) {
    lines.push(`### ${text(row.ref)}`, '', `Tip：${row.sha}；tree：${row.treeSha}。`, '')
    if (row.ageDays >= 90) lines.push('- 已至少 90 天无提交；仅标记，不因陈旧自动删除。')
    if (row.behind >= 50) lines.push('- 落后基线至少 50 个提交，需评估集成成本。')
    if (row.sameTipAs.length) lines.push(`- 相同 tip：${row.sameTipAs.map(text).join('、')}。`)
    if (row.sameTreeAs.length) lines.push(`- tree 相同但历史不同：${row.sameTreeAs.map(text).join('、')}；不据此删除独立提交。`)
    lines.push('- 最近独立提交（最多 5 条）：', ...(row.commits.length ? row.commits.map(item => `  - ${text(item)}`) : ['  - 无。']))
    lines.push('- 相对合并基点的文件变化：', ...(row.files.length ? row.files.map(file => `  - ${file.status} ${text(file.path)}`) : ['  - 无。']), '')
    if (row.pr?.evidence) {
      const evidence = row.pr.evidence
      lines.push(`- 检查证据：${evidence.complete ? '读取完成' : '未完整读取'}；commit status=${text(evidence.statusState)}；GitHub mergeable=${text(evidence.mergeableState)}。`,
        ...evidence.checks.map(check => `  - ${text(check.name)}：${text(check.status)} / ${text(check.conclusion)}`), '')
    }
  }
  lines.push('## 自动处理边界', '', '只读扫描，不切换分支、不更新分支 tip、不合并、不删除、不创建 PR、不更改保护规则。merge-tree 会写入临时 Git 对象，不改变工作区。', '',
    'A 类需要代码审核和仓库审批策略证据；扫描器不会仅凭绿色检查授予 A 类。D 只是清理建议，执行前还须复核 tip、worktree、开放 PR、保护规则及开发依赖。', '')
  return `${lines.join('\n')}\n`
}

export async function main(args = process.argv.slice(2)) {
  const values = new Map()
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]
    if (!['--output', '--json', '--base', '--offline'].includes(flag)) throw new Error(`Unknown option: ${flag}`)
    if (flag === '--offline') values.set(flag, true)
    else {
      if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`)
      values.set(flag, args[++index])
    }
  }
  const snapshot = scanBranches({ baseRef: values.get('--base') || process.env.BRANCH_GOVERNANCE_BASE })
  const offline = values.has('--offline')
  const github = offline
    ? { pullsKnown: false, branchesKnown: false, pulls: [], branches: [], errors: ['离线扫描；未读取 GitHub 活动、保护和检查证据。'] }
    : await readGitHubEvidence(createGitHubReader({ repository: snapshot.repository, token: process.env.GITHUB_TOKEN || process.env.GH_TOKEN }))
  const markdown = renderReport(snapshot, github)
  for (const [flag, content] of [['--output', markdown], ['--json', `${JSON.stringify({ ...snapshot, github }, null, 2)}\n`]]) {
    if (!values.has(flag)) continue
    const output = path.resolve(values.get(flag))
    fs.mkdirSync(path.dirname(output), { recursive: true })
    fs.writeFileSync(output, content, 'utf8')
    console.log(`Wrote ${output}`)
  }
  if (!values.has('--output')) process.stdout.write(markdown)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(errorMessage(error)); process.exitCode = 1 })
}
