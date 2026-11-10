import bcrypt from 'bcryptjs';
import crypto from 'crypto';

/**
 * Verifies a plain text password against a stored hash.
 * Supports:
 * 1. PHP native bcrypt ($2y$, $2a$, $2b$)
 * 2. Legacy MD5 hash fallback
 */
export async function verifyPassword(plainPassword: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !plainPassword) {
    return false;
  }

  // Check bcrypt hash ($2y$, $2a$, $2b$)
  if (storedHash.startsWith('$2y$') || storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
    try {
      // Normalize $2y$ to $2a$ for bcryptjs compatibility
      const normalizedHash = storedHash.replace(/^\$2y\$/, '$2a$');
      const isMatch = await bcrypt.compare(plainPassword, normalizedHash);
      if (isMatch) return true;
    } catch {
      // Fall through to md5 check if bcrypt compare fails
    }
  }

  // Check legacy MD5 hash (length 32 hex)
  const md5Hash = crypto.createHash('md5').update(plainPassword).digest('hex');
  if (storedHash === md5Hash) {
    return true;
  }

  return false;
}

/**
 * Hashes a plain text password using bcrypt (compatible with PHP password_hash)
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plainPassword, salt);
}
