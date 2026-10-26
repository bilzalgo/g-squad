import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export const permissions = [
  'investors:read',
  'investors:manage',
  'dashboard:read',
  'payments:read',
  'payments:review',
  'payments:execute',
  'support:read',
  'support:respond',
  'trading:read',
  'trading:manage',
  'audit:read',
  'settings:manage',
];

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = (value) => createHash('sha256').update(value).digest('hex');

export function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => {
      const separator = part.indexOf('=');
      if (separator < 0) return ['', ''];
      return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
    }).filter(([key]) => key),
  );
}

export function requireEncryptionKey() {
  const encoded = process.env.TOTP_ENCRYPTION_KEY;
  if (!encoded) throw new Error('TOTP_ENCRYPTION_KEY is not configured.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('TOTP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export function encryptSecret(secret) {
  const key = requireEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(value) {
  const [ivText, tagText, ciphertextText] = value.split('.');
  if (!ivText || !tagText || !ciphertextText) throw new Error('Invalid encrypted authenticator secret.');
  const decipher = createDecipheriv('aes-256-gcm', requireEncryptionKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
