import { describe, expect, it } from 'vitest'
import {
  ENCRYPTED_KEY_PREFIX,
  protectModelApiKey,
  unprotectModelApiKey,
  type SafeStorageLike,
} from '../model-credential-security'

describe('model-credential-security', () => {
  it('protects plain api key when safeStorage is available and decrypts back', () => {
    const memory = new Map<string, string>()
    const mockStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (text: string) => {
        const id = `token-${text}`
        memory.set(id, text)
        return Buffer.from(id, 'utf8')
      },
      decryptString: (buf: Buffer) => {
        const id = buf.toString('utf8')
        return memory.get(id) ?? ''
      },
    }

    const plainKey = 'sk-proj-1234567890abcdef'
    const protectedKey = protectModelApiKey(plainKey, mockStorage)
    expect(protectedKey).not.toBe(plainKey)
    expect(protectedKey.startsWith(ENCRYPTED_KEY_PREFIX)).toBe(true)

    // Does not re-encrypt already protected key
    const reProtected = protectModelApiKey(protectedKey, mockStorage)
    expect(reProtected).toBe(protectedKey)

    // Decrypts accurately
    const restored = unprotectModelApiKey(protectedKey, mockStorage)
    expect(restored).toBe(plainKey)
  })

  it('preserves plain key without changes when safeStorage is unavailable', () => {
    const mockStorage: SafeStorageLike = {
      isEncryptionAvailable: () => false,
    }

    const plainKey = 'sk-local-test-key'
    expect(protectModelApiKey(plainKey, mockStorage)).toBe(plainKey)
    expect(unprotectModelApiKey(plainKey, mockStorage)).toBe(plainKey)
  })

  it('handles empty or non-string keys gracefully', () => {
    expect(protectModelApiKey('')).toBe('')
    expect(protectModelApiKey(undefined)).toBe('')
    expect(unprotectModelApiKey('')).toBe('')
    expect(unprotectModelApiKey(undefined)).toBe('')
  })
})
