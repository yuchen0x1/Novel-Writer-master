import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { classifyBranch, createGitHubReader, main, readGitHubEvidence, renderReport, repositorySlug, scanBranches } from '../branch-governance-report.mjs'

const roots = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novel-branch-audit-'))
  roots.push(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Branch audit test')
  git('config', 'user.email', 'branch-test@example.invalid')
  git('remote', 'add', 'origin', 'git@github.com:example/test.repo.git')
  fs.writeFileSync(path.join(root, 'base.txt'), 'base')
  git('add', 'base.txt')
  git('commit', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/main', base)
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  return { root, git, base }
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(path.basename(root)).toMatch(/^novel-branch-audit-/)
    fs.rmSync(root, { recursive: true, force: true })
  }
})
const unknown = () => ({ pullsKnown: false, branchesKnown: false, pulls: [], branches: [], errors: ['API unavailable'] })
const known = () => ({ pullsKnown: true, branchesKnown: true, pulls: [], branches: [], errors: [] })
const row = (overrides = {}) => ({ stable: false, repository: 'example/test.repo', name: 'fix/one', sha: 'a'.repeat(40), ahead: 1, behind: 0, mergeState: 'clean', ...overrides })
const snapshot = { repository: 'example/test.repo', baseName: 'main' }
const pull = (overrides = {}) => ({
  number: 1, draft: false,
  head: { repo: { full_name: snapshot.repository }, ref: 'fix/one', sha: 'a'.repeat(40) },
  base: { repo: { full_name: snapshot.repository }, ref: 'main' }, ...overrides,
})

describe('branch governance uses Git identities and preserves worktrees', () => {
  it('keeps divergent local/remote branches as separate rows and ignores symbolic refs', () => {
    const f = fixture()
    f.git('branch', 'fix/one')
    fs.writeFileSync(path.join(f.root, 'remote.txt'), 'remote')
    f.git('add', 'remote.txt')
    f.git('commit', '-m', 'remote change')
    const remoteTip = f.git('rev-parse', 'HEAD')
    f.git('update-ref', 'refs/remotes/origin/fix/one', remoteTip)
    const report = scanBranches({ cwd: f.root })
    expect(report.localCount).toBe(2)
    expect(report.remoteCount).toBe(2)
    expect(report.rows.find(item => item.ref === 'refs/heads/fix/one')).toMatchObject({ sha: f.base, ahead: 0 })
    expect(report.rows.find(item => item.ref === 'refs/remotes/origin/fix/one')).toMatchObject({ sha: remoteTip, ahead: 1, files: [{ status: 'A', path: 'remote.txt' }] })
    expect(report.rows.some(item => item.ref === 'refs/remotes/origin/HEAD')).toBe(false)
    expect(f.git('rev-parse', 'HEAD')).toBe(remoteTip)
    expect(f.git('status', '--porcelain')).toBe('')
  })

  it('reports conflicts and preserves the index, branch and dirty file bytes', () => {
    const f = fixture()
    f.git('checkout', '-b', 'fix/conflict')
    fs.writeFileSync(path.join(f.root, 'base.txt'), 'feature\n')
    f.git('commit', '-am', 'feature')
    const feature = f.git('rev-parse', 'HEAD')
    f.git('update-ref', 'refs/remotes/origin/fix/conflict', feature)
    f.git('checkout', 'main')
    fs.writeFileSync(path.join(f.root, 'base.txt'), 'main\n')
    f.git('commit', '-am', 'main')
    f.git('update-ref', 'refs/remotes/origin/main', f.git('rev-parse', 'HEAD'))
    fs.writeFileSync(path.join(f.root, 'base.txt'), 'uncommitted\r\n')
    const before = fs.readFileSync(path.join(f.root, '.git', 'index'))
    const scan = scanBranches({ cwd: f.root })
    expect(scan.rows.find(item => item.ref === 'refs/remotes/origin/fix/conflict')).toMatchObject({ mergeState: 'conflict', ahead: 1, behind: 1 })
    expect(scan.dirty).toBe(true)
    expect(fs.readFileSync(path.join(f.root, 'base.txt'), 'utf8')).toBe('uncommitted\r\n')
    expect(fs.readFileSync(path.join(f.root, '.git', 'index'))).toEqual(before)
    expect(f.git('branch', '--show-current')).toBe('main')
  })

  it('supports default branch names containing a slash and detects duplicate trees', () => {
    const f = fixture()
    f.git('branch', 'release/stable')
    f.git('update-ref', 'refs/remotes/origin/release/stable', f.base)
    f.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/release/stable')
    f.git('commit', '--allow-empty', '-m', 'same tree, independent history')
    const scan = scanBranches({ cwd: f.root })
    expect(scan.baseName).toBe('release/stable')
    expect(scan.rows.find(item => item.ref === 'refs/heads/release/stable').stable).toBe(true)
    expect(scan.rows.find(item => item.ref === 'refs/heads/main').sameTreeAs).toContain('refs/remotes/origin/release/stable')
  })
})

describe('conservative branch classification', () => {
  it('retains a merged branch when activity/protection evidence is unavailable', () => {
    expect(classifyBranch(row({ ahead: 0 }), snapshot, unknown()).category).toBe('C')
  })
  it('retains checked-out, protected or open-PR branches even when merged', () => {
    const data = known()
    data.branches.push({ name: 'fix/one', protected: false, commit: { sha: 'a'.repeat(40) } })
    expect(classifyBranch(row({ ahead: 0, checkedOut: true }), snapshot, data).category).toBe('C')
    data.branches[0].protected = true
    expect(classifyBranch(row({ ahead: 0 }), snapshot, data).category).toBe('C')
    data.branches[0].protected = false
    data.pulls.push(pull())
    expect(classifyBranch(row({ ahead: 0 }), snapshot, data).category).toBe('C')
  })
  it('only suggests cleanup for fully contained, inactive, verified remote tips', () => {
    const data = known()
    data.branches.push({ name: 'fix/one', protected: false, commit: { sha: 'a'.repeat(40) } })
    expect(classifyBranch(row({ ahead: 0 }), snapshot, data).category).toBe('D')
    data.branches[0].commit.sha = 'b'.repeat(40)
    expect(classifyBranch(row({ ahead: 0 }), snapshot, data).category).toBe('C')
  })
  it('requires a current-head PR to the correct target and preserves draft work', () => {
    const data = known()
    data.pulls.push(pull())
    expect(classifyBranch(row(), snapshot, data).category).toBe('B')
    data.pulls[0].draft = true
    expect(classifyBranch(row(), snapshot, data).category).toBe('C')
    data.pulls[0] = pull({ head: { repo: { full_name: snapshot.repository }, ref: 'fix/one', sha: 'b'.repeat(40) } })
    expect(classifyBranch(row(), snapshot, data).category).toBe('C')
    expect(classifyBranch(row({ mergeState: 'conflict' }), snapshot, data).category).toBe('C')
  })
  it('does not mistake successful reported checks for completed code and policy review', () => {
    const data = known()
    data.pulls.push(pull({ evidence: { complete: true, green: true } }))
    expect(classifyBranch(row(), snapshot, data)).toMatchObject({ category: 'B', reason: expect.stringContaining('审核') })
  })
})

describe('GitHub evidence handles partial reads honestly', () => {
  it('keeps PR metadata if checks cannot be read', async () => {
    const api = async endpoint => {
      if (endpoint.startsWith('/pulls?')) return [pull()]
      if (endpoint.startsWith('/branches?')) return []
      if (endpoint === '/pulls/1') return pull()
      throw new Error('HTTP 403')
    }
    const evidence = await readGitHubEvidence(api)
    expect(evidence).toMatchObject({ pullsKnown: true, branchesKnown: true, pulls: [{ number: 1, evidence: { complete: false, green: false } }] })
    expect(evidence.pulls[0].evidence.errors).toEqual(['HTTP 403'])
  })
  it('does not report zero PRs or mark contained branches cleanable when enumeration fails', async () => {
    const evidence = await readGitHubEvidence(async () => { throw new Error('rate limited') })
    expect(evidence.pullsKnown).toBe(false)
    const markdown = renderReport({ ...snapshot, capturedAt: '2026-11-19', baseRef: 'origin/main', baseSha: 'a', localCount: 1, remoteCount: 1, rows: [] }, evidence)
    expect(markdown).toContain('未知（读取不完整）')
    expect(markdown).not.toContain('开放 PR：0')
  })
  it('reads all check pages and refuses to certify a failed check on a later page', async () => {
    const api = async endpoint => {
      if (endpoint.startsWith('/pulls?')) return [pull()]
      if (endpoint.startsWith('/branches?')) return []
      if (endpoint === '/pulls/1') return pull()
      if (endpoint.includes('/check-runs?')) return { total_count: 2, check_runs: [{ name: endpoint, status: 'completed', conclusion: endpoint.endsWith('page=1') ? 'success' : 'failure' }] }
      if (endpoint.endsWith('/status')) return { state: 'pending', total_count: 0 }
      throw new Error(`unexpected ${endpoint}`)
    }
    const evidence = await readGitHubEvidence(api)
    expect(evidence.pulls[0].evidence).toMatchObject({ complete: true, green: false, checks: [{ conclusion: 'success' }, { conclusion: 'failure' }] })
  })
  it('uses a fixed trusted API origin and handles dotted repository names', async () => {
    expect(repositorySlug('git@github.com:example/test.repo.git')).toBe('example/test.repo')
    expect(repositorySlug('https://github.com/example/test.repo.git')).toBe('example/test.repo')
    expect(repositorySlug('https://other.invalid/example/repo.git')).toBeUndefined()
    let requested
    const reader = createGitHubReader({ repository: 'example/test.repo', fetchImpl: async url => { requested = url; return { ok: true, json: async () => [] } } })
    await reader('/pulls?state=open')
    expect(requested).toBe('https://api.github.com/repos/example/test.repo/pulls?state=open')
  })
  it('requires values for report output flags', async () => {
    await expect(main(['--output'])).rejects.toThrow('Missing value')
  })
})
