import crypto from 'crypto';

// CodeIgniter 4 encryption_key from paas/app/Config/App.php
const ENCRYPTION_KEY = process.env.CI_ENCRYPTION_KEY || 'a2b293408f04a65';

/**
 * Decrypts a value encrypted by CodeIgniter 4's encode_id($val, $salt)
 * (Uses OpenSSL AES-256-CTR + HKDF-SHA512 + HMAC-SHA512)
 */
export function decodeCiId(encodedId: string, salt: string): string {
  if (!encodedId) return '';
  try {
    const hexStr = encodedId
      .replace(/_/g, '+')
      .replace(/~/g, '=')
      .replace(/-/g, '/');

    const rawBuffer = Buffer.from(hexStr, 'hex');
    if (rawBuffer.length <= 80) return '';

    const authKey = Buffer.from(
      crypto.hkdfSync('sha512', ENCRYPTION_KEY, Buffer.alloc(0), Buffer.alloc(0), 64)
    );

    const hmacLength = 64;
    const hmacKey = rawBuffer.subarray(0, hmacLength);
    const data = rawBuffer.subarray(hmacLength);

    const hmacCalc = crypto.createHmac('sha512', authKey).update(data).digest();
    if (!crypto.timingSafeEqual(hmacKey, hmacCalc)) {
      return '';
    }

    const iv = data.subarray(0, 16);
    const ciphertext = data.subarray(16);

    const encryptKey = Buffer.from(
      crypto.hkdfSync('sha512', ENCRYPTION_KEY, Buffer.alloc(0), Buffer.alloc(0), 64)
    ).subarray(0, 32);

    const decipher = crypto.createDecipheriv('aes-256-ctr', encryptKey, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');

    if (decrypted && decrypted.includes(salt)) {
      return decrypted.replace(salt, '');
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Encrypts a value compatible with CodeIgniter 4's encode_id($val, $salt)
 */
export function encodeCiId(plainText: string, salt: string): string {
  const payload = plainText + salt;
  const encryptKey = Buffer.from(
    crypto.hkdfSync('sha512', ENCRYPTION_KEY, Buffer.alloc(0), Buffer.alloc(0), 64)
  ).subarray(0, 32);
  const authKey = Buffer.from(
    crypto.hkdfSync('sha512', ENCRYPTION_KEY, Buffer.alloc(0), Buffer.alloc(0), 64)
  );

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', encryptKey, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const result = Buffer.concat([iv, encrypted]);

  const hmac = crypto.createHmac('sha512', authKey).update(result).digest();
  const fullHex = Buffer.concat([hmac, result]).toString('hex');

  return fullHex
    .replace(/=/g, '~')
    .replace(/\+/g, '_')
    .replace(/\//g, '-');
}

/**
 * Parses a simple PHP serialized associative array string such as:
 * a:3:{s:9:"file_name";s:32:"_file6ae0456ac0f65-site-logo.png";s:7:"file_id";s:33:"1O7y...";s:12:"service_type";s:6:"google";}
 */
export function parsePhpSerializedArray(serialized: string | null | undefined): Record<string, any> | null {
  if (!serialized || typeof serialized !== 'string') return null;
  const trimmed = serialized.trim();
  if (!trimmed.startsWith('a:')) return null;

  const result: Record<string, any> = {};
  // Match key-value pairs in PHP serialized format: s:len:"key";(s:len:"val";|i:num;|N;)
  const pairRegex = /s:\d+:"([^"]+)";(?:s:\d+:"([^"]*)";|i:(\d+);|N;)/g;
  let match: RegExpExecArray | null;
  while ((match = pairRegex.exec(trimmed)) !== null) {
    const key = match[1];
    if (match[2] !== undefined) {
      result[key] = match[2];
    } else if (match[3] !== undefined) {
      result[key] = Number(match[3]);
    } else {
      result[key] = null;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

export interface ResolvedCiFile {
  fileName: string;
  originalName: string;
  fileId: string | null;
  serviceType: 'google' | 'local';
  isImage: boolean;
  url: string;
  thumbnailUrl: string;
  downloadUrl: string;
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']);

export function isImageFileName(fileName: string): boolean {
  if (!fileName) return false;
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Removes CodeIgniter's uniqid prefix like `_file6ae0456ac0f65-` or `system_file6ae02c-` or `179429769-`
 */
export function cleanCiFileName(fileName: string): string {
  if (!fileName) return '';
  return fileName
    .replace(/^[a-zA-Z]*_?file[0-9a-f]+-/i, '')
    .replace(/^\d+-\d+_/, '');
}

/**
 * Resolves a CodeIgniter file reference (either serialized PHP array, DB columns, or plain filename)
 * into usable URLs (Google Drive thumbnail/raw URLs or local static URLs).
 */
export function resolveCiFile(
  input:
    | string
    | null
    | undefined
    | { file_name?: string; file_id?: string | null; service_type?: string | null },
  folderPath = 'system',
  fullSizeThumbnail = false
): ResolvedCiFile | null {
  if (!input) return null;

  let fileName = '';
  let fileId: string | null = null;
  let serviceType: string | null = null;

  if (typeof input === 'string') {
    const parsed = parsePhpSerializedArray(input);
    if (parsed) {
      fileName = parsed.file_name || '';
      fileId = parsed.file_id || null;
      serviceType = parsed.service_type || null;
    } else {
      fileName = input;
    }
  } else if (typeof input === 'object') {
    fileName = input.file_name || '';
    fileId = input.file_id || null;
    serviceType = input.service_type || null;
  }

  if (!fileName && !fileId) return null;

  const isImg = isImageFileName(fileName);
  const originalName = cleanCiFileName(fileName);

  if (serviceType === 'google' && fileId) {
    const sz = fullSizeThumbnail ? 's0' : 's700';
    const thumbnailUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=${sz}`;
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const viewUrl = isImg ? thumbnailUrl : `https://drive.google.com/file/d/${fileId}/view`;

    return {
      fileName,
      originalName,
      fileId,
      serviceType: 'google',
      isImage: isImg,
      url: viewUrl,
      thumbnailUrl,
      downloadUrl,
    };
  }

  // Local file in paas/files/<folderPath>/<fileName>
  const cleanFolder = folderPath.replace(/^\/+|\/+$/g, '');
  const staticPath = cleanFolder ? `/files-static/${cleanFolder}/${fileName}` : `/files-static/${fileName}`;

  return {
    fileName,
    originalName,
    fileId: null,
    serviceType: 'local',
    isImage: isImg,
    url: staticPath,
    thumbnailUrl: staticPath,
    downloadUrl: staticPath,
  };
}

/**
 * Strips HTML tags and decodes HTML entities from TinyMCE content stored by PAAS web app
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]*>?/gm, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .trim();
}

/**
 * Converts a MySQL UTC datetime string ('YYYY-MM-DD HH:mm:ss') to ISO 8601 UTC ('YYYY-MM-DDTHH:mm:ss.000Z')
 */
export function toIsoUtc(mysqlDateStr: string | null | undefined): string | null {
  if (!mysqlDateStr) return null;
  if (mysqlDateStr.includes('T') && mysqlDateStr.endsWith('Z')) return mysqlDateStr;
  return mysqlDateStr.trim().replace(' ', 'T') + 'Z';
}
