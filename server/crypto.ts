import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const DEFAULT_SECRET = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'local-paas-default-secure-key-32-chars-ok!';

// Ensure exactly 32 bytes for aes-256-gcm
function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(DEFAULT_SECRET).digest();
}

/**
 * Encrypt a plain text string using AES-256-GCM
 */
export function encryptValue(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an AES-256-GCM encrypted string
 */
export function decryptValue(cipherText: string): string {
  if (!cipherText) return '';
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) {
      // In case unencrypted or legacy
      return cipherText;
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Failed to decrypt value:', err);
    return '********';
  }
}

/**
 * Mask an environment variable value for UI display
 */
export function maskValue(value: string): string {
  if (!value) return '********';

  const visibleSuffix = value.length > 4 ? value.slice(-4) : '';
  const maskedLength = Math.min(Math.max(value.length - visibleSuffix.length, 8), 16);

  return '*'.repeat(maskedLength) + visibleSuffix;
}

/**
 * Validates GitHub Webhook HMAC-SHA256 signature
 */
export function verifyGitHubSignature(payload: string | Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }
  
  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return false;
  }
  
  const expectedSignature = parts[1];
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = hmac.digest('hex');
  
  // Timing safe equality comparison
  try {
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const digestBuffer = Buffer.from(digest, 'hex');
    if (expectedBuffer.length !== digestBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuffer, digestBuffer);
  } catch {
    return false;
  }
}

/**
 * Generates a clean DNS-compatible slug from a project name
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'app';
}
