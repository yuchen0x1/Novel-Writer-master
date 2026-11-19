import { localize, resolveLocale, translate, type MessageKey, type MessageParams } from '../src/i18n/core'
import type { Locale } from '../src/i18n/types'
import type { GlobalConfig } from '../src/shared/ipc-channels'
import { DEFAULT_GLOBAL_CONFIG, GLOBAL_CONFIG_PATH, readJsonFile } from './utils/config-utils'

export function resolveStoredOrSystemLocale(
  storedLocale: Locale | undefined,
  systemLocale: string | undefined,
): Locale {
  // 磁盘上的值不可信：只认本应用支持的语言，其余按系统语言归一化，
  // 免得主进程的文案查询拿到一个不存在的目录。
  const stored = typeof storedLocale === 'string' ? storedLocale.toLowerCase() : ''
  if (stored.startsWith('zh')) return 'zh-CN'
  if (stored.startsWith('en')) return 'en-US'
  return resolveLocale(systemLocale)
}

export function getMainLocale(systemLocale: string | undefined): Locale {
  const config = readJsonFile<GlobalConfig>(GLOBAL_CONFIG_PATH, DEFAULT_GLOBAL_CONFIG)
  return resolveStoredOrSystemLocale(config.locale, systemLocale)
}

export function mainT(
  systemLocale: string | undefined,
  key: MessageKey,
  params?: MessageParams,
): string {
  return translate(getMainLocale(systemLocale), key, params)
}

export function mainText(
  systemLocale: string | undefined,
  zhCNText: string,
  enUSText: string,
  params?: MessageParams,
): string {
  return localize(getMainLocale(systemLocale), zhCNText, enUSText, params)
}
