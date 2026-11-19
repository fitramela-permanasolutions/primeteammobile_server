import { pool, table } from '../config/database.js';
import { resolveCiFile, stripHtml, toIsoUtc } from '../utils/ciHelpers.js';
import { pusherService } from './pusherService.js';
import { googleDriveService } from './googleDriveService.js';
function buildTaskCommentPhpFiles(file, driveRes) {
    const fn = driveRes?.file_name || file.filename;
    const size = file.size || 0;
    if (driveRes?.file_id && driveRes?.service_type === 'google') {
        const fid = driveRes.file_id;
        return `a:1:{i:0;a:4:{s:9:"file_name";s:${Buffer.byteLength(fn)}:"${fn}";s:9:"file_size";i:${size};s:7:"file_id";s:${Buffer.byteLength(fid)}:"${fid}";s:12:"service_type";s:6:"google";}}`;
    }
    return `a:1:{i:0;a:4:{s:9:"file_name";s:${Buffer.byteLength(fn)}:"${fn}";s:9:"file_size";i:${size};s:7:"file_id";N;s:12:"service_type";N;}}`;
}
function parseTaskCommentAttachments(rawFiles) {
    if (!rawFiles || rawFiles === 'a:0:{}')
        return [];
    const results = [];
    // In PAAS (CodeIgniter 4), ALL project_comments / task_comments attachments live in files/timeline_files/
    const itemBlocks = rawFiles.match(/a:\d+:\{[^}]+\}/g) || [rawFiles];
    for (const block of itemBlocks) {
        const fnMatch = /s:9:"file_name";s:\d+:"([^"]+)"/.exec(block);
        if (!fnMatch)
            continue;
        const fileName = fnMatch[1];
        const fidMatch = /s:7:"file_id";s:\d+:"([^"]+)"/.exec(block);
        const stMatch = /s:12:"service_type";s:\d+:"([^"]+)"/.exec(block);
        const fileId = fidMatch ? fidMatch[1] : null;
        const serviceType = stMatch ? stMatch[1] : 'local';
        const cleanName = fileName.replace(/^[a-z0-9_]*_file[a-f0-9]+-/i, '');
        const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);
        let url = `/files-static/timeline_files/${encodeURIComponent(fileName)}`;
        if (serviceType === 'google' && fileId) {
            url = isImage
                ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`
                : `https://drive.google.com/file/d/${fileId}/preview`;
        }
        results.push({
            file_name: fileName,
            original_name: cleanName,
            url,
            is_image: isImage,
            file_id: fileId,
            service_type: serviceType,
        });
    }
    return results;
}
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
        let whereClause = `WHERE t.deleted = 0 AND (t.project_id = 0 OR p.deleted = 0)`;
        const params = [];
        if (filters.projectId) {
            whereClause += ` AND t.project_id = ?`;
            params.push(filters.projectId);
        }
        if (filters.statusId) {
            whereClause += ` AND t.status_id = ?`;
            params.push(filters.statusId);
        }
        if (filters.activeOnly) {
            whereClause += ` AND t.status != 'done' AND t.status_id NOT IN (3, 4)`;
        }
        if (filters.assignedTo) {
            whereClause += ` AND (t.assigned_to = ? OR FIND_IN_SET(?, REPLACE(t.collaborators, ' ', '')))`;
            params.push(filters.assignedTo, String(filters.assignedTo));
        }
        else if (filters.onlyMyTasks) {
            whereClause += ` AND (
        t.assigned_to = ?
        OR FIND_IN_SET(?, REPLACE(t.collaborators, ' ', ''))
      )`;
            params.push(userId, String(userId));
        }
        else if (!filters.projectId) {
            whereClause += ` AND (
        t.assigned_to = ?
        OR FIND_IN_SET(?, REPLACE(t.collaborators, ' ', ''))
        OR t.created_by = ?
        OR t.project_id IN (SELECT pm.project_id FROM ${table('project_members')} pm WHERE pm.user_id = ? AND pm.deleted = 0)
        OR (
          p.client_id > 0 AND p.client_id = (
            SELECT cu.client_id FROM ${table('users')} cu WHERE cu.id = ? AND cu.deleted = 0 LIMIT 1
          )
        )
      )`;
            params.push(userId, String(userId), userId, userId, userId);
        }
        const [rows] = await pool.query(`SELECT t.id, t.title, t.description, t.project_id, t.milestone_id,
              t.assigned_to, t.deadline, t.labels, t.points, t.status,
              t.status_id, t.priority_id, t.start_date, t.collaborators,
              t.parent_task_id, t.created_date, t.status_changed_at, t.created_by,
              p.title AS project_title,
              c.company_name AS client_name,
              ts.title AS status_title, ts.color AS status_color, ts.key_name AS status_key,
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
       ORDER BY
         CASE WHEN t.status = 'in_progress' OR t.status_id = 2 THEN 0
              WHEN t.status = 'to_do' OR t.status_id = 1 THEN 1
              ELSE 2
         END ASC,
         t.sort ASC,
         t.id DESC`, params);
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
                collaborators: r.collaborators || '',
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
              t.created_date, t.status_changed_at, t.created_by,
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
        const mappedChecklists = checklistRows.map((c) => ({
            id: c.id,
            title: c.title,
            is_checked: Boolean(c.is_checked),
            sort: c.sort,
        }));
        const mappedComments = commentRows.map((c) => {
            const cAvatar = resolveCiFile(c.user_avatar, 'profile_images');
            const authorName = c.user_name?.trim() || 'User';
            return {
                id: c.id,
                description: stripHtml(c.description),
                created_at: toIsoUtc(c.created_at) || c.created_at,
                created_by: c.created_by,
                author_name: authorName,
                user_name: authorName,
                author_avatar: cAvatar?.thumbnailUrl || null,
                user_avatar: cAvatar?.thumbnailUrl || null,
                attachments: parseTaskCommentAttachments(c.files),
            };
        });
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
            checklists: mappedChecklists,
            checklist_items: mappedChecklists,
            checklist_total: mappedChecklists.length,
            checklist_completed: mappedChecklists.filter((c) => c.is_checked).length,
            comments: mappedComments,
        };
    }
    async addChecklistItem(taskId, title) {
        const [result] = await pool.query(`INSERT INTO ${table('checklist_items')} (title, is_checked, task_id, sort, deleted)
       VALUES (?, 0, ?, 1000, 0)`, [title.trim(), taskId]);
        const created = {
            id: result.insertId,
            title: title.trim(),
            is_checked: false,
            task_id: taskId,
        };
        pusherService.triggerTaskChecklist(taskId, { action: 'add', item: created }).catch(() => { });
        return created;
    }
    async toggleChecklistItem(itemId) {
        const [rows] = await pool.query(`SELECT id, is_checked, task_id, title FROM ${table('checklist_items')}
       WHERE id = ? AND deleted = 0 LIMIT 1`, [itemId]);
        if (rows.length === 0)
            throw new Error('Checklist item tidak ditemukan');
        const nextChecked = rows[0].is_checked ? 0 : 1;
        await pool.query(`UPDATE ${table('checklist_items')} SET is_checked = ? WHERE id = ?`, [nextChecked, itemId]);
        const toggled = {
            id: itemId,
            title: rows[0].title,
            is_checked: Boolean(nextChecked),
            task_id: rows[0].task_id,
        };
        pusherService
            .triggerTaskChecklist(Number(rows[0].task_id), { action: 'toggle', item: toggled })
            .catch(() => { });
        return toggled;
    }
    async editChecklistItem(itemId, title) {
        const [rows] = await pool.query(`SELECT id, is_checked, task_id FROM ${table('checklist_items')}
       WHERE id = ? AND deleted = 0 LIMIT 1`, [itemId]);
        if (rows.length === 0)
            throw new Error('Checklist item tidak ditemukan');
        const cleanTitle = title.trim();
        await pool.query(`UPDATE ${table('checklist_items')} SET title = ? WHERE id = ?`, [cleanTitle, itemId]);
        const updated = {
            id: itemId,
            title: cleanTitle,
            is_checked: Boolean(rows[0].is_checked),
            task_id: rows[0].task_id,
        };
        pusherService
            .triggerTaskChecklist(Number(rows[0].task_id), { action: 'edit', item: updated })
            .catch(() => { });
        return updated;
    }
    async deleteChecklistItem(itemId) {
        const [rows] = await pool.query(`SELECT id, task_id FROM ${table('checklist_items')}
       WHERE id = ? AND deleted = 0 LIMIT 1`, [itemId]);
        if (rows.length === 0)
            throw new Error('Checklist item tidak ditemukan');
        await pool.query(`UPDATE ${table('checklist_items')} SET deleted = 1 WHERE id = ?`, [itemId]);
        pusherService
            .triggerTaskChecklist(Number(rows[0].task_id), { action: 'delete', itemId })
            .catch(() => { });
        return { id: itemId, deleted: true };
    }
    async addTaskComment(taskId, userId, description, file) {
        const [taskRows] = await pool.query(`SELECT project_id, title, assigned_to, collaborators FROM ${table('tasks')} WHERE id = ? LIMIT 1`, [taskId]);
        const projectId = taskRows.length > 0 ? Number(taskRows[0].project_id || 0) : 0;
        const taskTitle = String(taskRows[0]?.title || 'Task').trim();
        let driveRes = null;
        if (file) {
            driveRes = await googleDriveService
                .uploadFile(file.path, file.filename, file.mimetype, 'timeline_files')
                .catch(() => null);
        }
        const serializedFiles = file ? buildTaskCommentPhpFiles(file, driveRes) : 'a:0:{}';
        const cleanDesc = description.trim() || (file ? `Lampiran: ${file.originalname}` : '');
        const [result] = await pool.query(`INSERT INTO ${table('project_comments')}
       (created_by, created_at, description, project_id, comment_id, task_id, file_id, customer_feedback_id, files, deleted)
       VALUES (?, UTC_TIMESTAMP(), ?, ?, 0, ?, 0, 0, ?, 0)`, [userId, `<p>${cleanDesc}</p>`, projectId, taskId, serializedFiles]);
        const [userRows] = await pool.query(`SELECT CONCAT(first_name, ' ', last_name) AS name, image FROM ${table('users')} WHERE id = ? LIMIT 1`, [userId]);
        const authorName = String(userRows[0]?.name || '').trim() || 'User';
        const avatar = resolveCiFile(userRows[0]?.image, 'profile_images');
        const commentPayload = {
            id: result.insertId,
            task_id: taskId,
            project_id: projectId,
            description: cleanDesc,
            created_by: userId,
            author_name: authorName,
            user_name: authorName,
            author_avatar: avatar?.thumbnailUrl || null,
            user_avatar: avatar?.thumbnailUrl || null,
            created_at: new Date().toISOString(),
            attachments: parseTaskCommentAttachments(serializedFiles),
        };
        pusherService.triggerTaskComment(taskId, commentPayload).catch(() => { });
        // Notify task assignee & collaborators
        const recipients = new Set();
        if (taskRows[0]?.assigned_to)
            recipients.add(Number(taskRows[0].assigned_to));
        if (taskRows[0]?.collaborators) {
            String(taskRows[0].collaborators)
                .split(',')
                .map((x) => Number(x.trim()))
                .filter((n) => n > 0)
                .forEach((n) => recipients.add(n));
        }
        recipients.delete(userId);
        if (recipients.size > 0) {
            pusherService
                .notifyUsers(Array.from(recipients), {
                title: `Komentar Task • ${authorName}`,
                message: `${taskTitle}: ${cleanDesc}`,
                task_id: taskId,
                project_id: projectId,
                type: 'task_comment',
            })
                .catch(() => { });
        }
        return commentPayload;
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
    async updateTask(taskId, userId, input) {
        const sets = [];
        const params = [];
        if (input.title !== undefined && input.title.trim()) {
            sets.push('title = ?');
            params.push(input.title.trim());
        }
        if (input.description !== undefined) {
            sets.push('description = ?');
            params.push(input.description.trim());
        }
        if (input.deadline !== undefined) {
            sets.push('deadline = ?');
            params.push(input.deadline || null);
        }
        if (input.priority_id !== undefined && Number(input.priority_id) > 0) {
            sets.push('priority_id = ?');
            params.push(Number(input.priority_id));
        }
        if (sets.length === 0) {
            throw new Error('Tidak ada perubahan yang dikirim');
        }
        params.push(taskId);
        const [result] = await pool.query(`UPDATE ${table('tasks')} SET ${sets.join(', ')} WHERE id = ? AND deleted = 0`, params);
        if (result.affectedRows === 0) {
            throw new Error('Task tidak ditemukan');
        }
        return this.getTaskById(taskId, userId, true);
    }
    async deleteTask(taskId) {
        const [result] = await pool.query(`UPDATE ${table('tasks')} SET deleted = 1 WHERE id = ? AND deleted = 0`, [taskId]);
        if (result.affectedRows === 0) {
            throw new Error('Task tidak ditemukan');
        }
        return { id: taskId, deleted: true };
    }
    async editTaskComment(taskId, commentId, description) {
        const cleanDesc = description.trim();
        const [result] = await pool.query(`UPDATE ${table('project_comments')}
       SET description = ?
       WHERE id = ? AND task_id = ? AND deleted = 0`, [`<p>${cleanDesc}</p>`, commentId, taskId]);
        if (result.affectedRows === 0) {
            throw new Error('Komentar tidak ditemukan');
        }
        pusherService
            .triggerTaskComment(taskId, { action: 'edit', id: commentId, description: cleanDesc })
            .catch(() => { });
        return { id: commentId, task_id: taskId, description: cleanDesc };
    }
    async deleteTaskComment(taskId, commentId, userId, canManageAll) {
        const [rows] = await pool.query(`SELECT id, created_by FROM ${table('project_comments')}
       WHERE id = ? AND task_id = ? AND deleted = 0 LIMIT 1`, [commentId, taskId]);
        if (rows.length === 0) {
            throw new Error('Komentar tidak ditemukan');
        }
        if (!canManageAll && Number(rows[0].created_by) !== Number(userId)) {
            throw new Error('Akses ditolak: Anda hanya dapat menghapus komentar yang Anda buat sendiri.');
        }
        await pool.query(`UPDATE ${table('project_comments')} SET deleted = 1 WHERE id = ?`, [commentId]);
        pusherService
            .triggerTaskComment(taskId, { action: 'delete', id: commentId })
            .catch(() => { });
        return { id: commentId, deleted: true };
    }
}
export const taskService = new TaskService();
