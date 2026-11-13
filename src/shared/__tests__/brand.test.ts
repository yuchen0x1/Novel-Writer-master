import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_BRAND } from '../brand'

const visibleBrandSurfaces = [
  'index.html',
  'src/components/panels/agent/AgentHeader.tsx',
  'src/services/agent/context-builder.ts',
  'src/services/agent/tools/open-editor.tool.ts',
  'src/services/agent/tools/start-workflow.tool.ts',
  'src/stores/agent-store.ts',
  'src/services/safe-call-diagnostic.ts',
  'src/i18n/messages/zh-CN.ts',
  'src/i18n/messages/en-US.ts',
]

const legacyNamePattern = new RegExp('\\bVe' + 'la\\b')
const legacyHiddenDirPattern = new RegExp('\\.' + 've' + 'la(?!API)', 'i')
const legacyPrefixPattern = new RegExp('ve' + 'la-', 'i')
const formerNamePattern = /AI ?小说作家|AI Novel Writer/

describe('APP_BRAND', () => {
  it('uses the requested Novel-Writer-master product name in every locale', () => {
    expect(APP_BRAND.zhName).toBe('Novel-Writer-master')
    expect(APP_BRAND.enName).toBe('Novel-Writer-master')
    expect(APP_BRAND.shortName).toBe('Novel-Writer-master')
    expect(Object.values(APP_BRAND).join(' ')).not.toMatch(legacyNamePattern)
  })

  it('原名与旧版实际发布的产品名逐字一致', () => {
    // 安装包升级仍兼容曾经发布过的旧 executable 名称。
    const productIdentity = readFileSync(resolve(process.cwd(), 'scripts/product-identity.mjs'), 'utf8')

    expect(APP_BRAND.formerZhName).toBe('书童 Pagekin')
    expect(APP_BRAND.formerEnName).toBe('Pagekin')
    expect(productIdentity).toContain("PRODUCT_NAMES = [PRODUCT_NAME, 'Novel Writer master', '书童', 'AI小说作家']")
  })

  it('does not expose legacy product naming in visible brand surfaces', () => {
    for (const file of visibleBrandSurfaces) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')

      expect(source, file).not.toMatch(legacyNamePattern)
      expect(source, file).not.toMatch(legacyHiddenDirPattern)
      expect(source, file).not.toMatch(legacyPrefixPattern)
      expect(source, file).not.toMatch(formerNamePattern)
    }
  })
})
