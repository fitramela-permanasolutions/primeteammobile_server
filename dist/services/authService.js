import { pool, table } from '../config/database.js';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { generateToken } from '../config/jwt.js';
import { resolveCiFile, toIsoUtc } from '../utils/ciHelpers.js';
export class AuthService {
    async login(email, plainPassword) {
        const cleanEmail = email.trim().toLowerCase();
        const [rows] = await pool.query(`SELECT id, first_name, last_name, user_type, is_admin, role_id, email, password,
              image, status, client_id, job_title, disable_login, phone, address
       FROM ${table('users')}
       WHERE email = ? AND deleted = 0 AND disable_login = 0 AND status = 'active'
       LIMIT 1`, [cleanEmail]);
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
        await pool.query(`UPDATE ${table('users')} SET last_online = UTC_TIMESTAMP(), is_logged_in = 1 WHERE id = ?`, [user.id]);
        // Check Auto_Attendance plugin: auto_clock_in_on_signin
        if (user.user_type === 'staff') {
            try {
                const [aaRows] = await pool.query(`SELECT setting_value FROM ${table('auto_attendance_settings')}
           WHERE setting_name = 'auto_clock_in_on_signin' AND deleted = 0 LIMIT 1`);
                if (aaRows.length > 0 && aaRows[0].setting_value === '1') {
                    const [activeAtt] = await pool.query(`SELECT id FROM ${table('attendance')}
             WHERE user_id = ? AND status = 'incomplete' AND deleted = 0 LIMIT 1`, [user.id]);
                    if (activeAtt.length === 0) {
                        await pool.query(`INSERT INTO ${table('attendance')} (status, user_id, in_time, note, deleted)
               VALUES ('incomplete', ?, UTC_TIMESTAMP(), 'Auto Clock-In on Sign In (Mobile)', 0)`, [user.id]);
                    }
                }
            }
            catch {
                // Ignore if auto_attendance_settings table is absent
            }
        }
        const tokenPayload = {
            id: user.id,
            email: user.email,
            user_type: user.user_type,
            is_admin: user.is_admin,
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
                is_admin: Boolean(user.is_admin),
                job_title: user.job_title,
                image: resolvedAvatar?.thumbnailUrl || null,
                phone: user.phone,
                address: user.address,
            },
        };
    }
    async getMe(userId) {
        const [rows] = await pool.query(`SELECT u.id, u.first_name, u.last_name, u.user_type, u.is_admin, u.role_id,
              u.email, u.image, u.status, u.client_id, u.job_title, u.phone, u.address,
              u.dob, u.gender, u.language, u.created_at, u.last_online,
              r.title as role_title
       FROM ${table('users')} u
       LEFT JOIN ${table('roles')} r ON r.id = u.role_id
       WHERE u.id = ? AND u.deleted = 0
       LIMIT 1`, [userId]);
        if (rows.length === 0) {
            throw new Error('User not found');
        }
        const user = rows[0];
        const resolvedAvatar = resolveCiFile(user.image, 'profile_images');
        return {
            id: user.id,
            first_name: user.first_name,
            last_name: user.last_name,
            email: user.email,
            user_type: user.user_type,
            is_admin: Boolean(user.is_admin),
            job_title: user.job_title,
            role_id: user.role_id,
            role_title: user.role_title || (user.is_admin ? 'Admin' : 'Staff Member'),
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
    async changePassword(userId, currentPass, newPass) {
        const [rows] = await pool.query(`SELECT id, password FROM ${table('users')} WHERE id = ? AND deleted = 0 LIMIT 1`, [userId]);
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
        await pool.query(`UPDATE ${table('users')} SET password = ? WHERE id = ?`, [newHash, userId]);
        return { message: 'Password updated successfully' };
    }
    async logout(userId) {
        await pool.query(`UPDATE ${table('users')} SET is_logged_in = 0 WHERE id = ?`, [userId]);
        // Check Auto_Attendance plugin: auto_clock_out_on_signout
        try {
            const [aaRows] = await pool.query(`SELECT setting_value FROM ${table('auto_attendance_settings')}
         WHERE setting_name = 'auto_clock_out_on_signout' AND deleted = 0 LIMIT 1`);
            if (aaRows.length > 0 && aaRows[0].setting_value === '1') {
                await pool.query(`UPDATE ${table('attendance')}
           SET status = 'pending', out_time = UTC_TIMESTAMP()
           WHERE user_id = ? AND status = 'incomplete' AND deleted = 0`, [userId]);
            }
        }
        catch {
            // Ignore
        }
        return { message: 'Logged out successfully' };
    }
}
export const authService = new AuthService();
