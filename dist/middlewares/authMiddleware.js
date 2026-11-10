import { verifyToken } from '../config/jwt.js';
import { pool, table } from '../config/database.js';
import { sendError } from '../utils/response.js';
export async function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            sendError(res, 'Authentication token missing or invalid', 401);
            return;
        }
        const token = authHeader.split(' ')[1];
        if (!token) {
            sendError(res, 'Authentication token missing', 401);
            return;
        }
        const payload = verifyToken(token);
        // Verify user in database is active and not deleted
        const [rows] = await pool.query(`SELECT id, email, user_type, is_admin, first_name, last_name, status, disable_login, deleted
       FROM ${table('users')}
       WHERE id = ? AND deleted = 0 AND disable_login = 0 AND status = 'active'
       LIMIT 1`, [payload.id]);
        if (rows.length === 0) {
            sendError(res, 'User account is inactive or disabled', 401);
            return;
        }
        req.user = {
            id: rows[0].id,
            email: rows[0].email,
            user_type: rows[0].user_type,
            is_admin: rows[0].is_admin,
            first_name: rows[0].first_name,
            last_name: rows[0].last_name,
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
