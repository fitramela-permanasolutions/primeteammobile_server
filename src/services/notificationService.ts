import { pool, table } from '../config/database.js';
import { RowDataPacket } from 'mysql2';

export class NotificationService {
  async getNotifications(userId: number, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT n.id, n.user_id, n.description, n.created_at, n.notify_to,
              n.read_by, n.event, n.project_id, n.task_id,
              FIND_IN_SET(?, n.read_by) != 0 AS is_read,
              CONCAT(u.first_name, ' ', u.last_name) AS creator_name,
              u.image AS creator_avatar,
              p.title AS project_title,
              t.title AS task_title
       FROM ${table('notifications')} n
       LEFT JOIN ${table('users')} u ON u.id = n.user_id
       LEFT JOIN ${table('projects')} p ON p.id = n.project_id
       LEFT JOIN ${table('tasks')} t ON t.id = n.task_id
       WHERE n.deleted = 0 AND FIND_IN_SET(?, n.notify_to) != 0
       ORDER BY n.id DESC
       LIMIT ? OFFSET ?`,
      [userId, userId, limit, offset]
    );

    // Count unread
    const [unreadRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as unread_count
       FROM ${table('notifications')}
       WHERE deleted = 0
         AND FIND_IN_SET(?, notify_to) != 0
         AND (FIND_IN_SET(?, read_by) = 0 OR read_by IS NULL OR read_by = '')`,
      [userId, userId]
    );

    return {
      notifications: rows.map((r) => ({
        id: r.id,
        event: r.event,
        description: r.description.replace(/<[^>]*>?/gm, ''), // Strip HTML tags
        rawDescription: r.description,
        created_at: r.created_at,
        is_read: Boolean(r.is_read),
        project_id: r.project_id || null,
        project_title: r.project_title || null,
        task_id: r.task_id || null,
        task_title: r.task_title || null,
        creator: {
          id: r.user_id,
          name: r.creator_name || 'System',
          avatar: r.creator_avatar,
        },
      })),
      unread_count: unreadRows[0].unread_count || 0,
      page,
      limit,
    };
  }

  async markAsRead(notificationId: number, userId: number) {
    await pool.query(
      `UPDATE ${table('notifications')}
       SET read_by = CASE
         WHEN read_by IS NULL OR read_by = '' THEN ?
         ELSE CONCAT(read_by, ',', ?)
       END
       WHERE id = ? AND FIND_IN_SET(?, IFNULL(read_by, '')) = 0`,
      [String(userId), String(userId), notificationId, String(userId)]
    );

    return { message: 'Notification marked as read' };
  }

  async markAllAsRead(userId: number) {
    await pool.query(
      `UPDATE ${table('notifications')}
       SET read_by = CASE
         WHEN read_by IS NULL OR read_by = '' THEN ?
         ELSE CONCAT(read_by, ',', ?)
       END
       WHERE deleted = 0
         AND FIND_IN_SET(?, notify_to) != 0
         AND FIND_IN_SET(?, IFNULL(read_by, '')) = 0`,
      [String(userId), String(userId), String(userId), String(userId)]
    );

    return { message: 'All notifications marked as read' };
  }
}

export const notificationService = new NotificationService();
