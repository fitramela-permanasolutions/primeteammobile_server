import { pool, table } from '../config/database.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { generateToken } from '../config/jwt.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { UserTokenPayload } from '../types/index.js';
import { resolveCiFile, toIsoUtc } from '../utils/ciHelpers.js';
import { isAdminOrSuperAdmin, resolveUserRoleTitle } from '../utils/rbac.js';

export class AuthService {
  async login(email: string, plainPassword: string) {
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
      throw new Error('Invalid email or password');
    }

    const user = rows[0];

    if (!user.password) {
      throw new Error('Account password not set');
    }

    const isValid = await verifyPassword(plainPassword, user.password);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

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
    };

    const token = generateToken(tokenPayload);
    const resolvedAvatar = resolveCiFile(user.image, 'profile_images');

    return {
      token,
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

  async logout(userId: number) {
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
