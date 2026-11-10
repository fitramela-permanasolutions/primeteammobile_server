import { pool, table } from '../config/database.js';
export class TaskService {
    async getStatuses() {
        const [rows] = await pool.query(`SELECT id, title, key_name, color, sort
       FROM ${table('task_status')}
       WHERE deleted = 0
       ORDER BY sort ASC`);
        return rows;
    }
    async getTasks(userId, isAdmin, filters) {
        let whereClause = `WHERE t.deleted = 0`;
        const params = [];
        if (filters.projectId) {
            whereClause += ` AND t.project_id = ?`;
            params.push(filters.projectId);
        }
        if (filters.statusId) {
            whereClause += ` AND t.status_id = ?`;
            params.push(filters.statusId);
        }
        if (filters.assignedTo) {
            whereClause += ` AND t.assigned_to = ?`;
            params.push(filters.assignedTo);
        }
        else if (filters.onlyMyTasks) {
            whereClause += ` AND (t.assigned_to = ? OR FIND_IN_SET(?, t.collaborators))`;
            params.push(userId, userId);
        }
        else if (!isAdmin && !filters.projectId) {
            // Default non-admin filter: tasks in user's projects or assigned to user
            whereClause += ` AND (
        t.assigned_to = ?
        OR FIND_IN_SET(?, t.collaborators)
        OR t.project_id IN (SELECT project_id FROM ${table('project_members')} WHERE user_id = ? AND deleted = 0)
      )`;
            params.push(userId, userId, userId);
        }
        const [rows] = await pool.query(`SELECT t.id, t.title, t.description, t.project_id, t.milestone_id,
              t.assigned_to, t.deadline, t.labels, t.points, t.status,
              t.status_id, t.priority_id, t.start_date, t.collaborators,
              t.created_date, t.status_changed_at,
              p.title AS project_title,
              ts.title AS status_title, ts.color AS status_color,
              tp.title AS priority_title, tp.color AS priority_color,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              u.image AS assigned_to_avatar
       FROM ${table('tasks')} t
       LEFT JOIN ${table('projects')} p ON p.id = t.project_id
       LEFT JOIN ${table('task_status')} ts ON ts.id = t.status_id
       LEFT JOIN ${table('task_priority')} tp ON tp.id = t.priority_id
       LEFT JOIN ${table('users')} u ON u.id = t.assigned_to
       ${whereClause}
       ORDER BY t.sort ASC, t.id DESC`, params);
        return rows.map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description,
            project_id: r.project_id,
            project_title: r.project_title || 'General',
            assigned_to: r.assigned_to,
            assigned_to_name: r.assigned_to_name || 'Unassigned',
            assigned_to_avatar: r.assigned_to_avatar,
            deadline: r.deadline,
            start_date: r.start_date,
            points: r.points,
            status: r.status,
            status_id: r.status_id,
            status_title: r.status_title || r.status,
            status_color: r.status_color || '#3b82f6',
            priority_id: r.priority_id,
            priority_title: r.priority_title || 'Normal',
            priority_color: r.priority_color || '#64748b',
            labels: r.labels,
            status_changed_at: r.status_changed_at,
        }));
    }
    async getTaskById(taskId, userId, isAdmin) {
        const [rows] = await pool.query(`SELECT t.id, t.title, t.description, t.project_id, t.milestone_id,
              t.assigned_to, t.deadline, t.labels, t.points, t.status,
              t.status_id, t.priority_id, t.start_date, t.collaborators,
              t.created_date, t.status_changed_at,
              p.title AS project_title,
              ts.title AS status_title, ts.color AS status_color,
              tp.title AS priority_title, tp.color AS priority_color,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              u.image AS assigned_to_avatar, u.email AS assigned_to_email
       FROM ${table('tasks')} t
       LEFT JOIN ${table('projects')} p ON p.id = t.project_id
       LEFT JOIN ${table('task_status')} ts ON ts.id = t.status_id
       LEFT JOIN ${table('task_priority')} tp ON tp.id = t.priority_id
       LEFT JOIN ${table('users')} u ON u.id = t.assigned_to
       WHERE t.id = ? AND t.deleted = 0
       LIMIT 1`, [taskId]);
        if (rows.length === 0) {
            throw new Error('Task not found');
        }
        const r = rows[0];
        return {
            id: r.id,
            title: r.title,
            description: r.description,
            project_id: r.project_id,
            project_title: r.project_title || 'General',
            assigned_to: r.assigned_to,
            assigned_to_name: r.assigned_to_name || 'Unassigned',
            assigned_to_avatar: r.assigned_to_avatar,
            assigned_to_email: r.assigned_to_email,
            deadline: r.deadline,
            start_date: r.start_date,
            points: r.points,
            status: r.status,
            status_id: r.status_id,
            status_title: r.status_title || r.status,
            status_color: r.status_color || '#3b82f6',
            priority_id: r.priority_id,
            priority_title: r.priority_title || 'Normal',
            priority_color: r.priority_color || '#64748b',
            labels: r.labels,
            collaborators: r.collaborators,
            created_date: r.created_date,
            status_changed_at: r.status_changed_at,
        };
    }
    async updateTaskStatus(taskId, statusId, userId) {
        // Verify status exists
        const [statusRows] = await pool.query(`SELECT id, title, key_name FROM ${table('task_status')} WHERE id = ? AND deleted = 0`, [statusId]);
        if (statusRows.length === 0) {
            throw new Error('Invalid task status ID');
        }
        const taskStatus = statusRows[0];
        // Map status key to enum ('to_do', 'in_progress', 'done')
        let enumStatus = 'in_progress';
        if (taskStatus.key_name === 'to_do' || taskStatus.id === 1) {
            enumStatus = 'to_do';
        }
        else if (taskStatus.key_name === 'done' || taskStatus.id === 3 || taskStatus.id === 4) {
            enumStatus = 'done';
        }
        const [result] = await pool.query(`UPDATE ${table('tasks')}
       SET status_id = ?, status = ?, status_changed_at = NOW()
       WHERE id = ? AND deleted = 0`, [statusId, enumStatus, taskId]);
        if (result.affectedRows === 0) {
            throw new Error('Task not found or update failed');
        }
        return this.getTaskById(taskId, userId, true);
    }
}
export const taskService = new TaskService();
