import * as electron from 'electron'

export type SafeStorageLike = {
  isEncryptionAvailable?: () => boolean
  encryptString?: (plainText: string) => Buffer
  decryptString?: (cipherText: Buffer) => string
  getSelectedStorageBackend?: () => string
  platform?: NodeJS.Platform
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

function storageProvidesOSProtection(storage: SafeStorageLike): boolean {
  try {
    if (!storage.isEncryptionAvailable?.()) return false
    if ((storage.platform ?? process.platform) !== 'linux') return true
    const backend = storage.getSelectedStorageBackend?.()
    return backend === 'gnome_libsecret' || backend === 'kwallet' || backend === 'kwallet5' || backend === 'kwallet6'
  } catch {
    return false
  }
}

export class ModelCredentialProtectionUnavailableError extends Error {
  constructor() {
    super('MODEL_CREDENTIAL_PROTECTION_UNAVAILABLE')
    this.name = 'ModelCredentialProtectionUnavailableError'
  }
}

/** Encrypt API keys with OS-backed storage. Plaintext is preserved for legacy keys, never as a new fallback. */
export function protectModelApiKey(apiKey: string | undefined, storage?: SafeStorageLike | null): string {
  if (!apiKey || typeof apiKey !== 'string') return apiKey ?? ''
  if (apiKey.startsWith(ENCRYPTED_KEY_PREFIX)) return apiKey
  const resolved = resolveStorage(storage)
  if (!resolved || !storageProvidesOSProtection(resolved) || typeof resolved.encryptString !== 'function') {
    throw new ModelCredentialProtectionUnavailableError()
  }
  const encrypted = resolved.encryptString(apiKey).toString('base64')
  return `${ENCRYPTED_KEY_PREFIX}${encrypted}`
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
    if (resolved && typeof resolved.isEncryptionAvailable === 'function' && resolved.isEncryptionAvailable()
      && ((resolved.platform ?? process.platform) !== 'linux' || storageProvidesOSProtection(resolved))
      && typeof resolved.decryptString === 'function') {
      const payloadBase64 = apiKey.slice(ENCRYPTED_KEY_PREFIX.length)
      return resolved.decryptString(Buffer.from(payloadBase64, 'base64'))
    }
  } catch {
    return ''
  }
  return ''
}
