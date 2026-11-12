import { pool, table } from '../config/database.js';
import { resolveCiFile, stripHtml, toIsoUtc } from '../utils/ciHelpers.js';
export class TaskService {
    async getStatuses() {
        const [rows] = await pool.query(`SELECT id, title, key_name, color, sort
       FROM ${table('task_status')}
       WHERE deleted = 0
       ORDER BY sort ASC`);
        return rows;
    }
    async getPriorities() {
        const [rows] = await pool.query(`SELECT id, title, icon, color
       FROM ${table('task_priority')}
       WHERE deleted = 0
       ORDER BY id ASC`);
        return rows.map((r) => ({
            id: r.id,
            title: String(r.title || '').trim(),
            icon: r.icon,
            color: r.color,
        }));
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
              t.parent_task_id, t.created_date, t.status_changed_at,
              p.title AS project_title,
              c.company_name AS client_name,
              ts.title AS status_title, ts.color AS status_color,
              tp.title AS priority_title, tp.color AS priority_color, tp.icon AS priority_icon,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              u.image AS assigned_to_avatar,
              (SELECT COUNT(*) FROM ${table('checklist_items')} ci WHERE ci.task_id = t.id AND ci.deleted = 0) AS checklist_total,
              (SELECT COUNT(*) FROM ${table('checklist_items')} ci WHERE ci.task_id = t.id AND ci.is_checked = 1 AND ci.deleted = 0) AS checklist_completed,
              (SELECT COUNT(*) FROM ${table('project_comments')} pc WHERE pc.task_id = t.id AND pc.deleted = 0) AS comments_count
       FROM ${table('tasks')} t
       LEFT JOIN ${table('projects')} p ON p.id = t.project_id
       LEFT JOIN ${table('clients')} c ON c.id = p.client_id
       LEFT JOIN ${table('task_status')} ts ON ts.id = t.status_id
       LEFT JOIN ${table('task_priority')} tp ON tp.id = t.priority_id
       LEFT JOIN ${table('users')} u ON u.id = t.assigned_to
       ${whereClause}
       ORDER BY t.sort ASC, t.id DESC`, params);
        return rows.map((r) => {
            const avatarResolved = resolveCiFile(r.assigned_to_avatar, 'profile_images');
            return {
                id: r.id,
                title: r.title,
                description: stripHtml(r.description),
                project_id: r.project_id,
                project_title: r.project_title || 'General',
                client_name: r.client_name || null,
                parent_task_id: r.parent_task_id || 0,
                assigned_to: r.assigned_to,
                assigned_to_name: r.assigned_to_name?.trim() || 'Unassigned',
                assigned_to_avatar: avatarResolved?.thumbnailUrl || null,
                deadline: r.deadline && !String(r.deadline).startsWith('0000') ? r.deadline : null,
                start_date: r.start_date && !String(r.start_date).startsWith('0000') ? r.start_date : null,
                points: r.points,
                status: r.status,
                status_id: r.status_id,
                status_title: r.status_title || r.status,
                status_color: r.status_color || '#3b82f6',
                priority_id: r.priority_id,
                priority_title: String(r.priority_title || 'Normal').trim(),
                priority_color: r.priority_color || '#64748b',
                priority_icon: r.priority_icon || null,
                labels: r.labels,
                checklist_total: Number(r.checklist_total || 0),
                checklist_completed: Number(r.checklist_completed || 0),
                comments_count: Number(r.comments_count || 0),
                status_changed_at: toIsoUtc(r.status_changed_at) || r.status_changed_at,
            };
        });
    }
    async getTaskById(taskId, userId, isAdmin) {
        const [rows] = await pool.query(`SELECT t.id, t.title, t.description, t.project_id, t.milestone_id,
              t.assigned_to, t.deadline, t.labels, t.points, t.status,
              t.status_id, t.priority_id, t.start_date, t.collaborators,
              t.created_date, t.status_changed_at,
              p.title AS project_title,
              c.company_name AS client_name,
              m.title AS milestone_title,
              ts.title AS status_title, ts.color AS status_color,
              tp.title AS priority_title, tp.color AS priority_color, tp.icon AS priority_icon,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              u.image AS assigned_to_avatar, u.email AS assigned_to_email
       FROM ${table('tasks')} t
       LEFT JOIN ${table('projects')} p ON p.id = t.project_id
       LEFT JOIN ${table('clients')} c ON c.id = p.client_id
       LEFT JOIN ${table('milestones')} m ON m.id = t.milestone_id
       LEFT JOIN ${table('task_status')} ts ON ts.id = t.status_id
       LEFT JOIN ${table('task_priority')} tp ON tp.id = t.priority_id
       LEFT JOIN ${table('users')} u ON u.id = t.assigned_to
       WHERE t.id = ? AND t.deleted = 0
       LIMIT 1`, [taskId]);
        if (rows.length === 0) {
            throw new Error('Task tidak ditemukan');
        }
        const r = rows[0];
        const avatarResolved = resolveCiFile(r.assigned_to_avatar, 'profile_images');
        // Fetch checklist items from permana_checklist_items
        const [checklistRows] = await pool.query(`SELECT id, title, is_checked, sort
       FROM ${table('checklist_items')}
       WHERE task_id = ? AND deleted = 0
       ORDER BY sort ASC, id ASC`, [taskId]);
        // Fetch task comments from permana_project_comments
        const [commentRows] = await pool.query(`SELECT pc.id, pc.description, pc.created_at, pc.created_by, pc.files,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              u.image AS user_avatar
       FROM ${table('project_comments')} pc
       LEFT JOIN ${table('users')} u ON u.id = pc.created_by
       WHERE pc.task_id = ? AND pc.deleted = 0
       ORDER BY pc.created_at DESC, pc.id DESC`, [taskId]);
        return {
            id: r.id,
            title: r.title,
            description: stripHtml(r.description),
            project_id: r.project_id,
            project_title: r.project_title || 'General',
            client_name: r.client_name || null,
            milestone_id: r.milestone_id || 0,
            milestone_title: r.milestone_title || null,
            assigned_to: r.assigned_to,
            assigned_to_name: r.assigned_to_name?.trim() || 'Unassigned',
            assigned_to_avatar: avatarResolved?.thumbnailUrl || null,
            assigned_to_email: r.assigned_to_email,
            deadline: r.deadline && !String(r.deadline).startsWith('0000') ? r.deadline : null,
            start_date: r.start_date && !String(r.start_date).startsWith('0000') ? r.start_date : null,
            points: r.points,
            status: r.status,
            status_id: r.status_id,
            status_title: r.status_title || r.status,
            status_color: r.status_color || '#3b82f6',
            priority_id: r.priority_id,
            priority_title: String(r.priority_title || 'Normal').trim(),
            priority_color: r.priority_color || '#64748b',
            priority_icon: r.priority_icon || null,
            labels: r.labels,
            collaborators: r.collaborators,
            created_date: r.created_date,
            status_changed_at: toIsoUtc(r.status_changed_at) || r.status_changed_at,
            checklist_items: checklistRows.map((c) => ({
                id: c.id,
                title: c.title,
                is_checked: Boolean(c.is_checked),
                sort: c.sort,
            })),
            comments: commentRows.map((c) => {
                const cAvatar = resolveCiFile(c.user_avatar, 'profile_images');
                return {
                    id: c.id,
                    description: stripHtml(c.description),
                    created_at: toIsoUtc(c.created_at) || c.created_at,
                    created_by: c.created_by,
                    user_name: c.user_name?.trim() || 'User',
                    user_avatar: cAvatar?.thumbnailUrl || null,
                };
            }),
        };
    }
    async addChecklistItem(taskId, title) {
        const [result] = await pool.query(`INSERT INTO ${table('checklist_items')} (title, is_checked, task_id, sort, deleted)
       VALUES (?, 0, ?, 1000, 0)`, [title.trim(), taskId]);
        return {
            id: result.insertId,
            title: title.trim(),
            is_checked: false,
            task_id: taskId,
        };
    }
    async toggleChecklistItem(itemId) {
        const [rows] = await pool.query(`SELECT id, is_checked, task_id, title FROM ${table('checklist_items')}
       WHERE id = ? AND deleted = 0 LIMIT 1`, [itemId]);
        if (rows.length === 0)
            throw new Error('Checklist item tidak ditemukan');
        const nextChecked = rows[0].is_checked ? 0 : 1;
        await pool.query(`UPDATE ${table('checklist_items')} SET is_checked = ? WHERE id = ?`, [nextChecked, itemId]);
        return {
            id: itemId,
            title: rows[0].title,
            is_checked: Boolean(nextChecked),
            task_id: rows[0].task_id,
        };
    }
    async addTaskComment(taskId, userId, description) {
        const [taskRows] = await pool.query(`SELECT project_id FROM ${table('tasks')} WHERE id = ? LIMIT 1`, [taskId]);
        const projectId = taskRows.length > 0 ? taskRows[0].project_id : 0;
        const [result] = await pool.query(`INSERT INTO ${table('project_comments')}
       (created_by, created_at, description, project_id, comment_id, task_id, file_id, customer_feedback_id, files, deleted)
       VALUES (?, UTC_TIMESTAMP(), ?, ?, 0, ?, 0, 0, 'a:0:{}', 0)`, [userId, `<p>${description.trim()}</p>`, projectId, taskId]);
        return {
            id: result.insertId,
            task_id: taskId,
            project_id: projectId,
            description: description.trim(),
            created_by: userId,
            created_at: new Date().toISOString(),
        };
    }
    async updateTaskStatus(taskId, statusId, userId) {
        const [statusRows] = await pool.query(`SELECT id, title, key_name FROM ${table('task_status')} WHERE id = ? AND deleted = 0`, [statusId]);
        if (statusRows.length === 0) {
            throw new Error('Status ID task tidak valid');
        }
        const taskStatus = statusRows[0];
        let enumStatus = 'in_progress';
        const titleLower = String(taskStatus.title || '').toLowerCase();
        if (taskStatus.key_name === 'to_do' || taskStatus.id === 1 || titleLower.includes('to do')) {
            enumStatus = 'to_do';
        }
        else if (taskStatus.key_name === 'done' ||
            taskStatus.id === 3 ||
            taskStatus.id === 4 ||
            titleLower.includes('done') ||
            titleLower.includes('complete')) {
            enumStatus = 'done';
        }
        const [result] = await pool.query(`UPDATE ${table('tasks')}
       SET status_id = ?, status = ?, status_changed_at = UTC_TIMESTAMP()
       WHERE id = ? AND deleted = 0`, [statusId, enumStatus, taskId]);
        if (result.affectedRows === 0) {
            throw new Error('Task tidak ditemukan atau gagal diperbarui');
        }
        return this.getTaskById(taskId, userId, true);
    }
}
export const taskService = new TaskService();
