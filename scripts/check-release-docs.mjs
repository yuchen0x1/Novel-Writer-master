import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const read = relativePath => readFileSync(resolve(root, relativePath), 'utf8')
const pkg = JSON.parse(read('package.json'))
const version = typeof pkg.version === 'string' ? pkg.version : ''
const releaseTag = `v${version}`
const releaseUrl = `https://github.com/yuchen0x1/Novel-Writer-master/releases/tag/${releaseTag}`

const checks = [
  {
    name: 'package version',
    ok: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u.test(version),
  },
  {
    name: 'current release notes file',
    ok: read(`.release/notes/${releaseTag}.md`).startsWith(`# ${version}\n`),
  },
  {
    name: 'Chinese README current release link',
    ok: read('README.md').includes(releaseUrl),
  },
  {
    name: 'English README current release link',
    ok: read('README_en.md').includes(releaseUrl),
  },
  {
    name: 'docs navigation current version',
    ok: read('docs/README.md').includes(`当前桌面版本为 \`${version}\``),
  },
  {
    name: 'update guide current stable heading',
    ok: read('docs/AUTO_UPDATE.md').includes(`## ${version} 当前稳定版本`),
  },
  {
    name: 'release notes current heading',
    ok: read('docs/releases/release-notes.md').includes(`## ${version} —`),
  },
  {
    name: 'changelog current heading',
    ok: read('CHANGELOG.md').includes(`## [${version}] -`),
  },
]

const failures = checks.filter(check => !check.ok)
if (failures.length > 0) {
  for (const failure of failures) console.error(`release-docs: missing ${failure.name}`)
  process.exitCode = 1
} else {
  console.log(`release-docs: ${releaseTag} documentation is synchronized`)
}
