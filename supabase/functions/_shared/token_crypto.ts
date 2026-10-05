const encoder = new TextEncoder()
const decoder = new TextDecoder()
let keyPromise: Promise<CryptoKey> | null = null

function decodeSecret(value: string) {
  const encoded = value.trim()
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('Encryption key is not valid base64.')
  }
  const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
  if (bytes.byteLength !== 32) throw new Error('Encryption key must decode to 32 bytes.')
  return bytes
}

function encryptionKey() {
  if (!keyPromise) {
    const configured = Deno.env.get('TOKEN_ENCRYPTION_KEY')
    if (!configured) throw new Error('Encryption key is not configured.')
    keyPromise = crypto.subtle.importKey('raw', decodeSecret(configured), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  }
  return keyPromise
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Ciphertext encoding is invalid.')
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

export async function validateTokenEncryptionKey() {
  await encryptionKey()
}

export async function encryptAniListToken(userId: string, token: string) {
  if (!userId || !token) throw new Error('Missing token encryption input.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(userId), tagLength: 128 }, await encryptionKey(), encoder.encode(token))
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`
}

export async function decryptAniListToken(userId: string, ciphertext: string) {
  const parts = ciphertext.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Encrypted token format is unsupported.')
  const iv = decodeBase64Url(parts[1])
  const encrypted = decodeBase64Url(parts[2])
  if (iv.byteLength !== 12 || encrypted.byteLength < 17 || encrypted.byteLength > 8192) throw new Error('Encrypted token format is invalid.')
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(userId), tagLength: 128 }, await encryptionKey(), encrypted)
  return decoder.decode(plaintext)
}
