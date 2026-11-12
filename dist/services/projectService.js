import { pool, table } from '../config/database.js';
import { resolveCiFile, stripHtml, toIsoUtc } from '../utils/ciHelpers.js';
export class ProjectService {
    async getProjects(userId, isAdmin, status) {
        let whereClause = `WHERE p.deleted = 0`;
        const params = [];
        if (!isAdmin) {
            whereClause += ` AND (
        p.id IN (SELECT project_id FROM ${table('project_members')} WHERE user_id = ? AND deleted = 0)
        OR p.created_by = ?
      )`;
            params.push(userId, userId);
        }
        if (status && ['open', 'completed', 'hold', 'canceled'].includes(status)) {
            whereClause += ` AND p.status = ?`;
            params.push(status);
        }
        const [rows] = await pool.query(`SELECT p.id, p.title, p.description, p.project_type, p.start_date, p.deadline,
              p.client_id, p.created_date, p.created_by, p.status, p.status_id,
              p.price, p.labels, c.company_name AS client_name,
              COUNT(t.id) AS total_tasks,
              SUM(CASE WHEN t.status = 'done' OR t.status_id IN (3, 4) THEN 1 ELSE 0 END) AS completed_tasks
       FROM ${table('projects')} p
       LEFT JOIN ${table('clients')} c ON c.id = p.client_id
       LEFT JOIN ${table('tasks')} t ON t.project_id = p.id AND t.deleted = 0
       ${whereClause}
       GROUP BY p.id
       ORDER BY p.id DESC`, params);
        return rows.map((p) => {
            const totalTasks = Number(p.total_tasks) || 0;
            const completedTasks = Number(p.completed_tasks) || 0;
            const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            return {
                id: p.id,
                title: p.title,
                description: stripHtml(p.description),
                project_type: p.project_type,
                start_date: p.start_date,
                deadline: p.deadline,
                status: p.status,
                status_id: p.status_id,
                price: p.price,
                client_name: p.client_name || 'Internal',
                total_tasks: totalTasks,
                completed_tasks: completedTasks,
                progress,
            };
        });
    }
    async getProjectById(projectId, userId, isAdmin) {
        const [projectRows] = await pool.query(`SELECT p.id, p.title, p.description, p.project_type, p.start_date, p.deadline,
              p.client_id, p.created_date, p.created_by, p.status, p.status_id,
              p.price, c.company_name AS client_name,
              COUNT(t.id) AS total_tasks,
              SUM(CASE WHEN t.status = 'done' OR t.status_id IN (3, 4) THEN 1 ELSE 0 END) AS completed_tasks
       FROM ${table('projects')} p
       LEFT JOIN ${table('clients')} c ON c.id = p.client_id
       LEFT JOIN ${table('tasks')} t ON t.project_id = p.id AND t.deleted = 0
       WHERE p.id = ? AND p.deleted = 0
       GROUP BY p.id`, [projectId]);
        if (projectRows.length === 0) {
            throw new Error('Project tidak ditemukan');
        }
        const project = projectRows[0];
        if (!isAdmin) {
            const [memberCheck] = await pool.query(`SELECT id FROM ${table('project_members')}
         WHERE project_id = ? AND user_id = ? AND deleted = 0`, [projectId, userId]);
            if (memberCheck.length === 0 && project.created_by !== userId) {
                throw new Error('Anda tidak memiliki akses ke project ini');
            }
        }
        // Get project members
        const [members] = await pool.query(`SELECT pm.id, pm.user_id, pm.is_leader,
              u.first_name, u.last_name, u.email, u.image, u.job_title
       FROM ${table('project_members')} pm
       INNER JOIN ${table('users')} u ON u.id = pm.user_id
       WHERE pm.project_id = ? AND pm.deleted = 0 AND u.deleted = 0`, [projectId]);
        // Get milestones (include active or historical milestones for visibility)
        const [milestones] = await pool.query(`SELECT id, title, due_date, description, deleted
       FROM ${table('milestones')}
       WHERE project_id = ? AND deleted = 0
       ORDER BY due_date ASC`, [projectId]);
        // Get project notes from permana_notes
        const [notes] = await pool.query(`SELECT n.id, n.title, n.description, n.color, n.created_at, n.is_public,
              CONCAT(u.first_name, ' ', u.last_name) AS author_name
       FROM ${table('notes')} n
       LEFT JOIN ${table('users')} u ON u.id = n.created_by
       WHERE n.project_id = ? AND n.deleted = 0
       ORDER BY n.id DESC`, [projectId]);
        // Get project folders from permana_folders
        const [folders] = await pool.query(`SELECT f.id, f.title, f.folder_id, f.parent_id, f.created_at,
              (SELECT COUNT(*) FROM ${table('project_files')} pf WHERE pf.folder_id = f.id AND pf.deleted = 0) AS file_count
       FROM ${table('folders')} f
       WHERE f.context = 'project' AND f.context_id = ? AND f.deleted = 0
       ORDER BY f.title ASC`, [projectId]);
        // Get project timesheets from permana_project_time
        const [timesheets] = await pool.query(`SELECT pt.id, pt.user_id, pt.start_time, pt.end_time, pt.hours, pt.status, pt.note, pt.task_id,
              t.title AS task_title,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ${table('project_time')} pt
       LEFT JOIN ${table('tasks')} t ON t.id = pt.task_id
       LEFT JOIN ${table('users')} u ON u.id = pt.user_id
       WHERE pt.project_id = ? AND pt.deleted = 0
       ORDER BY pt.id DESC`, [projectId]);
        const totalTasks = Number(project.total_tasks) || 0;
        const completedTasks = Number(project.completed_tasks) || 0;
        const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
        return {
            id: project.id,
            title: project.title,
            description: stripHtml(project.description),
            project_type: project.project_type,
            start_date: project.start_date,
            deadline: project.deadline,
            status: project.status,
            price: project.price,
            client_name: project.client_name || 'Internal',
            total_tasks: totalTasks,
            completed_tasks: completedTasks,
            progress,
            members: members.map((m) => {
                const avatarResolved = resolveCiFile(m.image, 'profile_images');
                return {
                    id: m.id,
                    user_id: m.user_id,
                    is_leader: Boolean(m.is_leader),
                    name: `${m.first_name || ''} ${m.last_name || ''}`.trim(),
                    email: m.email,
                    job_title: m.job_title,
                    avatar: avatarResolved?.thumbnailUrl || null,
                };
            }),
            milestones: milestones.map((ms) => ({
                id: ms.id,
                title: ms.title,
                due_date: ms.due_date,
                description: stripHtml(ms.description),
            })),
            notes: notes.map((n) => ({
                id: n.id,
                title: n.title,
                description: stripHtml(n.description),
                color: n.color || '#4a8af4',
                author_name: n.author_name?.trim() || 'Team Member',
                created_at: toIsoUtc(n.created_at) || n.created_at,
            })),
            folders: folders.map((f) => ({
                id: f.id,
                title: f.title,
                folder_id: f.folder_id,
                parent_id: f.parent_id,
                file_count: Number(f.file_count || 0),
                created_at: toIsoUtc(f.created_at) || f.created_at,
            })),
            timesheets: timesheets.map((ts) => ({
                id: ts.id,
                user_id: ts.user_id,
                user_name: ts.user_name?.trim() || 'Staff',
                task_id: ts.task_id,
                task_title: ts.task_title || null,
                start_time: toIsoUtc(ts.start_time) || ts.start_time,
                end_time: toIsoUtc(ts.end_time) || ts.end_time,
                hours: Number(ts.hours || 0),
                note: stripHtml(ts.note),
                status: ts.status,
            })),
        };
    }
}
export const projectService = new ProjectService();
