import { verifyToken } from '../config/jwt.js';
import { pool, table } from '../config/database.js';
import { sendError } from '../utils/response.js';
import { isAdminOrSuperAdmin, resolveUserRoleTitle } from '../utils/rbac.js';
export async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        let token = '';
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
        else if (req.query.token && typeof req.query.token === 'string') {
            token = req.query.token;
        }
        else if (req.query.auth_token && typeof req.query.auth_token === 'string') {
            token = req.query.auth_token;
        }
        if (!token) {
            sendError(res, 'Authentication token missing or invalid', 401);
            return;
        }
        const payload = verifyToken(token);
        // Verify user in database is active and not deleted, and join role from permana_roles
        const [rows] = await pool.query(`SELECT u.id, u.email, u.user_type, u.is_admin, u.role_id, u.client_id, u.job_title,
              u.first_name, u.last_name, u.status, u.disable_login, u.deleted,
              r.title AS role_title
       FROM ${table('users')} u
       LEFT JOIN ${table('roles')} r ON r.id = u.role_id AND r.deleted = 0
       WHERE u.id = ? AND u.deleted = 0 AND u.disable_login = 0 AND u.status = 'active'
       LIMIT 1`, [payload.id]);
        if (rows.length === 0) {
            sendError(res, 'User account is inactive or disabled', 401);
            return;
        }
        const row = rows[0];
        const roleTitle = resolveUserRoleTitle(row);
        const hasAdminAccess = isAdminOrSuperAdmin({
            is_admin: row.is_admin,
            role_id: row.role_id,
            role_title: roleTitle,
            user_type: row.user_type,
            job_title: row.job_title,
        });
        req.user = {
            id: row.id,
            email: row.email,
            user_type: row.user_type,
            is_admin: hasAdminAccess ? 1 : 0,
            role_id: row.role_id,
            role_title: roleTitle,
            role: roleTitle,
            job_title: row.job_title,
            client_id: row.client_id,
            first_name: row.first_name,
            last_name: row.last_name,
        };
        next();
    }
    catch (error) {
        if (error.name === 'TokenExpiredError') {
            sendError(res, 'Authentication token has expired', 401);
            return;
        }
        sendError(res, 'Invalid authentication token', 401);
    }
}
/**
 * Case-insensitive RBAC middleware restricting access to Admin / Superadmin roles only.
 */
export function adminMiddleware(req, res, next) {
    if (!req.user || !isAdminOrSuperAdmin(req.user)) {
        sendError(res, 'Akses ditolak: Hanya role Admin / Superadmin yang memiliki izin untuk mengakses pengaturan teknis ini.', 403);
        return;
    }
    next();
}
