import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(path.resolve(import.meta.dirname, '../../.github/workflows/initial-brand-release.yml'), 'utf8')

describe('initial release source trust boundary', () => {
  it('checks the default branch and exact dispatch commit before any build', () => {
    const source = workflow.slice(workflow.indexOf('  source:'), workflow.indexOf('  build:'))
    expect(source).toContain('test "$GITHUB_REF" = "refs/heads/$DEFAULT_BRANCH"')
    expect(source).toContain('test "$EXPECTED_SHA" = "$TRUSTED_SHA"')
    expect(source).not.toContain('uses: actions/checkout@')
    expect(workflow).toContain('  build:\n    needs: source')
  })

  it('never checks out dispatch-controlled code in a cache-writing or publishing job', () => {
    expect(workflow).not.toContain('ref: ${{ inputs.expected_sha }}')
    expect(workflow.match(/ref: \$\{\{ github\.sha \}\}/g)).toHaveLength(2)
    expect(workflow).toContain('needs: [source, build]')
    expect(workflow).toContain("needs.source.result == 'success'")
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2)
  })

  it('does not restore or save dependency caches in the release builder', () => {
    expect(workflow).not.toMatch(/^\s*cache\s*:/m)
    expect(workflow).not.toContain('actions/cache@')
  })
})
