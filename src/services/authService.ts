import crypto from 'crypto';
import { pool, table } from '../config/database.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { generateToken } from '../config/jwt.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { UserTokenPayload } from '../types/index.js';
import { resolveCiFile, toIsoUtc } from '../utils/ciHelpers.js';
import { isAdminOrSuperAdmin, resolveUserRoleTitle } from '../utils/rbac.js';
import { settingsService } from './settingsService.js';

export interface DeviceMetadata {
  ip_address?: string;
  device_id?: string;
  device_brand?: string;
  device_model?: string;
  os_name?: string;
  os_version?: string;
  app_version?: string;
}

export class AuthService {
  private sessionsTableReady = false;

  async ensureSessionsTable(): Promise<void> {
    if (this.sessionsTableReady) return;
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${table('mobile_sessions')} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_token_id VARCHAR(64) NOT NULL UNIQUE,
        user_id INT NOT NULL,
        ip_address VARCHAR(64) DEFAULT '',
        device_id VARCHAR(128) DEFAULT '',
        device_brand VARCHAR(64) DEFAULT '',
        device_model VARCHAR(128) DEFAULT '',
        os_name VARCHAR(32) DEFAULT '',
        os_version VARCHAR(64) DEFAULT '',
        app_version VARCHAR(32) DEFAULT '',
        is_revoked TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        last_active_at DATETIME NOT NULL,
        expires_at DATETIME NOT NULL,
        INDEX idx_user_id (user_id),
        INDEX idx_session_token_id (session_token_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    this.sessionsTableReady = true;
  }

  private async issueSessionForUser(user: RowDataPacket, deviceMeta?: DeviceMetadata) {
    // Update last_online timestamp
    await pool.query(
      `UPDATE ${table('users')} SET last_online = UTC_TIMESTAMP(), is_logged_in = 1 WHERE id = ?`,
      [user.id]
    );

    // Check Auto_Attendance plugin: auto_clock_in_on_signin
    if (user.user_type === 'staff') {
      try {
        const [aaRows] = await pool.query<RowDataPacket[]>(
          `SELECT setting_value FROM ${table('auto_attendance_settings')}
           WHERE setting_name = 'auto_clock_in_on_signin' AND deleted = 0 LIMIT 1`
        );
        if (aaRows.length > 0 && aaRows[0].setting_value === '1') {
          const [activeAtt] = await pool.query<RowDataPacket[]>(
            `SELECT id FROM ${table('attendance')}
             WHERE user_id = ? AND status = 'incomplete' AND deleted = 0 LIMIT 1`,
            [user.id]
          );
          if (activeAtt.length === 0) {
            await pool.query(
              `INSERT INTO ${table('attendance')} (status, user_id, in_time, note, deleted)
               VALUES ('incomplete', ?, UTC_TIMESTAMP(), 'Auto Clock-In on Sign In (Mobile)', 0)`,
              [user.id]
            );
          }
        }
      } catch {
        // Ignore if auto_attendance_settings table is absent
      }
    }

    const roleTitle = resolveUserRoleTitle(user);
    const hasAdminAccess = isAdminOrSuperAdmin({
      is_admin: user.is_admin,
      role_id: user.role_id,
      role_title: roleTitle,
      user_type: user.user_type,
      job_title: user.job_title,
    });

    const timeoutHours = await settingsService.getMobileSessionTimeoutHours();
    const sid = crypto.randomUUID();

    try {
      await this.ensureSessionsTable();
      await pool.query(
        `INSERT INTO ${table('mobile_sessions')}
          (session_token_id, user_id, ip_address, device_id, device_brand, device_model, os_name, os_version, app_version, is_revoked, created_at, last_active_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR))`,
        [
          sid,
          user.id,
          (deviceMeta?.ip_address || '').slice(0, 64),
          (deviceMeta?.device_id || '').slice(0, 128),
          (deviceMeta?.device_brand || '').slice(0, 64),
          (deviceMeta?.device_model || '').slice(0, 128),
          (deviceMeta?.os_name || '').slice(0, 32),
          (deviceMeta?.os_version || '').slice(0, 64),
          (deviceMeta?.app_version || '').slice(0, 32),
          timeoutHours,
        ]
      );
    } catch {
      // Do not block login if session tracking fails
    }

    const tokenPayload: UserTokenPayload = {
      id: user.id,
      email: user.email,
      user_type: user.user_type,
      is_admin: hasAdminAccess ? 1 : 0,
      role_id: user.role_id,
      role_title: roleTitle,
      role: roleTitle,
      job_title: user.job_title,
      client_id: user.client_id,
      first_name: user.first_name,
      last_name: user.last_name,
      sid,
    };

    const token = generateToken(tokenPayload, `${timeoutHours}h`);
    const resolvedAvatar = resolveCiFile(user.image, 'profile_images');

    return {
      token,
      session_timeout_hours: timeoutHours,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        user_type: user.user_type,
        is_admin: hasAdminAccess,
        role_id: user.role_id,
        role_title: roleTitle,
        role: roleTitle,
        client_id: user.client_id,
        job_title: user.job_title,
        image: resolvedAvatar?.thumbnailUrl || null,
        phone: user.phone,
        address: user.address,
      },
    };
  }

  async login(email: string, plainPassword: string, deviceMeta?: DeviceMetadata) {
    const cleanEmail = email.trim().toLowerCase();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.first_name, u.last_name, u.user_type, u.is_admin, u.role_id, u.email, u.password,
              u.image, u.status, u.client_id, u.job_title, u.disable_login, u.phone, u.address,
              r.title AS role_title
       FROM ${table('users')} u
       LEFT JOIN ${table('roles')} r ON r.id = u.role_id AND r.deleted = 0
       WHERE u.email = ? AND u.deleted = 0 AND u.disable_login = 0 AND u.status = 'active'
       LIMIT 1`,
      [cleanEmail]
    );

    if (rows.length === 0) {
      throw new Error('Email atau kata sandi salah');
    }

    const user = rows[0];

    if (!user.password) {
      throw new Error('Kata sandi akun belum diatur');
    }

    const isValid = await verifyPassword(plainPassword, user.password);
    if (!isValid) {
      throw new Error('Email atau kata sandi salah');
    }

    return this.issueSessionForUser(user, deviceMeta);
  }

  async googleLogin(
    input: { accessToken?: string; idToken?: string },
    deviceMeta?: DeviceMetadata
  ) {
    let googleEmail = '';
    if (input.accessToken) {
      const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });
      if (!resp.ok) {
        throw new Error('Token Google tidak valid atau sudah kedaluwarsa');
      }
      const profile: any = await resp.json();
      googleEmail = String(profile?.email || '').trim().toLowerCase();
    } else if (input.idToken) {
      const resp = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(input.idToken)}`
      );
      if (!resp.ok) {
        throw new Error('ID Token Google tidak valid atau sudah kedaluwarsa');
      }
      const profile: any = await resp.json();
      googleEmail = String(profile?.email || '').trim().toLowerCase();
    } else {
      throw new Error('Token autentikasi Google wajib disertakan');
    }

    if (!googleEmail) {
      throw new Error('Akun Google tidak menyertakan alamat email');
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.first_name, u.last_name, u.user_type, u.is_admin, u.role_id, u.email, u.password,
              u.image, u.status, u.client_id, u.job_title, u.disable_login, u.phone, u.address,
              r.title AS role_title
       FROM ${table('users')} u
       LEFT JOIN ${table('roles')} r ON r.id = u.role_id AND r.deleted = 0
       WHERE LOWER(u.email) = ? AND u.deleted = 0 AND u.disable_login = 0 AND u.status = 'active'
       LIMIT 1`,
      [googleEmail]
    );

    if (rows.length === 0) {
      throw new Error(
        `Email Google (${googleEmail}) belum terdaftar atau tidak aktif di sistem.`
      );
    }

    return this.issueSessionForUser(rows[0], deviceMeta);
  }

  async verifyActiveSession(sid: string): Promise<boolean> {
    try {
      await this.ensureSessionsTable();
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT id, is_revoked, expires_at
         FROM ${table('mobile_sessions')}
         WHERE session_token_id = ? LIMIT 1`,
        [sid]
      );
      if (rows.length === 0) return true;
      const row = rows[0];
      if (Number(row.is_revoked) === 1) return false;
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return false;

      pool
        .query(
          `UPDATE ${table('mobile_sessions')} SET last_active_at = UTC_TIMESTAMP() WHERE id = ?`,
          [row.id]
        )
        .catch(() => {});
      return true;
    } catch {
      return true;
    }
  }

  async getActiveSessions() {
    await this.ensureSessionsTable();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.session_token_id, s.user_id, s.ip_address, s.device_id,
              s.device_brand, s.device_model, s.os_name, s.os_version, s.app_version,
              s.is_revoked, s.created_at, s.last_active_at, s.expires_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              u.email AS user_email, u.user_type, u.is_admin, r.title AS role_title
       FROM ${table('mobile_sessions')} s
       INNER JOIN ${table('users')} u ON u.id = s.user_id AND u.deleted = 0
       LEFT JOIN ${table('roles')} r ON r.id = u.role_id AND r.deleted = 0
       WHERE s.is_revoked = 0 AND s.expires_at > UTC_TIMESTAMP()
       ORDER BY s.last_active_at DESC
       LIMIT 200`
    );

    return rows.map((r) => ({
      id: r.id,
      session_token_id: r.session_token_id,
      user_id: r.user_id,
      user_name: String(r.user_name || '').trim() || r.user_email,
      user_email: r.user_email,
      role_title: resolveUserRoleTitle(r),
      ip_address: r.ip_address || '-',
      device_id: r.device_id || '-',
      device_brand: r.device_brand || 'Unknown',
      device_model: r.device_model || 'Unknown Device',
      os_name: r.os_name || 'Mobile',
      os_version: r.os_version || '-',
      app_version: r.app_version || '1.0.0',
      created_at: toIsoUtc(r.created_at),
      last_active_at: toIsoUtc(r.last_active_at),
      expires_at: toIsoUtc(r.expires_at),
    }));
  }

  async revokeSession(sessionIdOrToken: string | number) {
    await this.ensureSessionsTable();
    const isNumeric = /^\d+$/.test(String(sessionIdOrToken));
    await pool.query(
      `UPDATE ${table('mobile_sessions')}
       SET is_revoked = 1
       WHERE ${isNumeric ? 'id = ?' : 'session_token_id = ?'}`,
      [isNumeric ? Number(sessionIdOrToken) : String(sessionIdOrToken)]
    );
    return { revoked: true };
  }

  async getMe(userId: number) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT u.id, u.first_name, u.last_name, u.user_type, u.is_admin, u.role_id,
              u.email, u.image, u.status, u.client_id, u.job_title, u.phone, u.address,
              u.dob, u.gender, u.language, u.created_at, u.last_online,
              r.title AS role_title
       FROM ${table('users')} u
       LEFT JOIN ${table('roles')} r ON r.id = u.role_id AND r.deleted = 0
       WHERE u.id = ? AND u.deleted = 0
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error('User not found');
    }

    const user = rows[0];
    const resolvedAvatar = resolveCiFile(user.image, 'profile_images');
    const roleTitle = resolveUserRoleTitle(user);
    const hasAdminAccess = isAdminOrSuperAdmin({
      is_admin: user.is_admin,
      role_id: user.role_id,
      role_title: roleTitle,
      user_type: user.user_type,
      job_title: user.job_title,
    });

    return {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      user_type: user.user_type,
      is_admin: hasAdminAccess,
      job_title: user.job_title,
      role_id: user.role_id,
      role_title: roleTitle,
      role: roleTitle,
      client_id: user.client_id,
      image: resolvedAvatar?.thumbnailUrl || null,
      phone: user.phone,
      address: user.address,
      dob: user.dob,
      gender: user.gender,
      language: user.language || 'english',
      created_at: toIsoUtc(user.created_at) || user.created_at,
      last_online: toIsoUtc(user.last_online) || user.last_online,
    };
  }

  async changePassword(userId: number, currentPass: string, newPass: string) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, password FROM ${table('users')} WHERE id = ? AND deleted = 0 LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error('User not found');
    }

    const currentHash = rows[0].password;
    const isValid = await verifyPassword(currentPass, currentHash);
    if (!isValid) {
      throw new Error('Current password does not match');
    }

    if (newPass.length < 6) {
      throw new Error('New password must be at least 6 characters long');
    }

    const newHash = await hashPassword(newPass);

    await pool.query<ResultSetHeader>(
      `UPDATE ${table('users')} SET password = ? WHERE id = ?`,
      [newHash, userId]
    );

    return { message: 'Password updated successfully' };
  }

  async logout(userId: number, sid?: string) {
    if (sid) {
      await this.revokeSession(sid).catch(() => {});
    }
    await pool.query(
      `UPDATE ${table('users')} SET is_logged_in = 0 WHERE id = ?`,
      [userId]
    );

    // Check Auto_Attendance plugin: auto_clock_out_on_signout
    try {
      const [aaRows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_value FROM ${table('auto_attendance_settings')}
         WHERE setting_name = 'auto_clock_out_on_signout' AND deleted = 0 LIMIT 1`
      );
      if (aaRows.length > 0 && aaRows[0].setting_value === '1') {
        await pool.query(
          `UPDATE ${table('attendance')}
           SET status = 'pending', out_time = UTC_TIMESTAMP()
           WHERE user_id = ? AND status = 'incomplete' AND deleted = 0`,
          [userId]
        );
      }
    } catch {
      // Ignore
    }

    return { message: 'Logged out successfully' };
  }
}

export const authService = new AuthService();
