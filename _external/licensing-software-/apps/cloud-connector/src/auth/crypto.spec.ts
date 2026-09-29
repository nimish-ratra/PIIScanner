import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from './crypto.util.js';

describe('AES-256-GCM Secret Encryption', () => {
  it('encrypts and decrypts client secrets losslessly', () => {
    const rawSecret = 'Azure_Secret_Value_12345!@#$%^&*()_+';
    const encrypted = encryptSecret(rawSecret);

    expect(encrypted).not.toBe(rawSecret);
    expect(encrypted.split(':').length).toBe(3); // iv:tag:ciphertext

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(rawSecret);
  });

  it('handles empty strings gracefully', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });
});
