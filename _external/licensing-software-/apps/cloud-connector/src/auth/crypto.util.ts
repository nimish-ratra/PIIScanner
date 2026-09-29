import * as crypto from 'node:crypto';

// Encryption master key derived from environment or fallback stable key for development
const MASTER_KEY_RAW = process.env.CLOUD_CONNECTOR_ENCRYPTION_KEY || 'claissify-o365-connector-master-key-32bytes!';
const KEY = crypto.createHash('sha256').update(MASTER_KEY_RAW).digest();

/**
 * Encrypt sensitive credentials (e.g. Azure AD client secrets) using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (hex encoded)
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt credentials encrypted with encryptSecret.
 */
export function decryptSecret(encryptedPayload: string): string {
  if (!encryptedPayload) return '';
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    // Legacy or plaintext fallback
    return encryptedPayload;
  }
  const [ivHex, tagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
