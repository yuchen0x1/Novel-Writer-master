import * as electron from 'electron'

export type SafeStorageLike = {
  isEncryptionAvailable?: () => boolean
  encryptString?: (plainText: string) => Buffer
  decryptString?: (cipherText: Buffer) => string
}

export const ENCRYPTED_KEY_PREFIX = 'enc:v1:'

function resolveStorage(explicit?: SafeStorageLike | null): SafeStorageLike | null {
  if (explicit !== undefined) return explicit
  try {
    const raw = (electron as unknown as { safeStorage?: SafeStorageLike }).safeStorage
    if (raw && typeof raw.isEncryptionAvailable === 'function') return raw
  } catch {
    // electron safeStorage not accessible in test environment without mock
  }
  return null
}

/**
 * Encrypt an API key using Electron safeStorage when available.
 * Returns the original key if encryption is unavailable or if already encrypted.
 */
export function protectModelApiKey(apiKey: string | undefined, storage?: SafeStorageLike | null): string {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.startsWith(ENCRYPTED_KEY_PREFIX)) {
    return apiKey ?? ''
  }
  const resolved = resolveStorage(storage)
  try {
    if (resolved && typeof resolved.isEncryptionAvailable === 'function' && resolved.isEncryptionAvailable() && typeof resolved.encryptString === 'function') {
      const encrypted = resolved.encryptString(apiKey).toString('base64')
      return `${ENCRYPTED_KEY_PREFIX}${encrypted}`
    }
  } catch {
    // If platform encryption throws, safely fall back to the plain key
  }
  return apiKey
}

/**
 * Decrypt an API key that was protected using protectModelApiKey.
 * Returns plain keys as-is for backwards compatibility.
 */
export function unprotectModelApiKey(apiKey: string | undefined, storage?: SafeStorageLike | null): string {
  if (!apiKey || typeof apiKey !== 'string') {
    return ''
  }
  if (!apiKey.startsWith(ENCRYPTED_KEY_PREFIX)) {
    return apiKey
  }
  const resolved = resolveStorage(storage)
  try {
    if (resolved && typeof resolved.isEncryptionAvailable === 'function' && resolved.isEncryptionAvailable() && typeof resolved.decryptString === 'function') {
      const payloadBase64 = apiKey.slice(ENCRYPTED_KEY_PREFIX.length)
      const decrypted = resolved.decryptString(Buffer.from(payloadBase64, 'base64'))
      return decrypted
    }
  } catch {
    return ''
  }
  return ''
}
