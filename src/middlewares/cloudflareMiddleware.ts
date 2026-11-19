import { Request, Response, NextFunction } from 'express';
import { pool, table } from '../config/database.js';
import { RowDataPacket } from 'mysql2';
import { sendError } from '../utils/response.js';

interface CloudflarePolicy {
  enabled: boolean;
  proxySecret: string;
}

let cachedPolicy: CloudflarePolicy | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 15000;

export function invalidateCloudflarePolicyCache(): void {
  cachedPolicy = null;
  cachedAt = 0;
}

async function getCloudflarePolicy(): Promise<CloudflarePolicy> {
  if (cachedPolicy && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedPolicy;
  }

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT setting_name, setting_value FROM ${table('settings')}
       WHERE setting_name IN ('cloudflare_enabled', 'cloudflare_proxy_secret') AND deleted = 0`
    );
    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.setting_name] = r.setting_value;
    }

    cachedPolicy = {
      enabled: map.cloudflare_enabled === '1',
      proxySecret: (map.cloudflare_proxy_secret || '').trim(),
    };
    cachedAt = Date.now();
    return cachedPolicy;
  } catch {
    return { enabled: false, proxySecret: '' };
  }
}

/**
 * Blocks direct IP bypass requests when Admin enables Cloudflare Protection.
 * Validates Cloudflare proxy headers (`CF-Connecting-IP` / `CF-Ray`) and optional
 * `X-CF-Proxy-Secret` header configured in Cloudflare Transform Rules.
 */
export async function cloudflareMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Always allow healthcheck and local loopback in DEBUG mode
  if (req.path === '/health') {
    next();
    return;
  }

  const policy = await getCloudflarePolicy();
  if (!policy.enabled) {
    next();
    return;
  }

  const remoteIp = req.ip || req.socket.remoteAddress || '';
  const isLocalLoopback =
    remoteIp === '127.0.0.1' ||
    remoteIp === '::1' ||
    remoteIp === '::ffff:127.0.0.1';

  if (process.env.DEBUG === '1' && isLocalLoopback) {
    next();
    return;
  }

  const cfConnectingIp = req.headers['cf-connecting-ip'];
  const cfRay = req.headers['cf-ray'];

  if (!cfConnectingIp || !cfRay) {
    sendError(
      res,
      'Akses ditolak: Koneksi langsung ke server diblokir oleh Proteksi Cloudflare.',
      403
    );
    return;
  }

  if (policy.proxySecret) {
    const providedSecret = String(req.headers['x-cf-proxy-secret'] || '').trim();
    if (providedSecret !== policy.proxySecret) {
      sendError(
        res,
        'Akses ditolak: Validasi kunci proxy Cloudflare tidak valid.',
        403
      );
      return;
    }
  }

  next();
}
