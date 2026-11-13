import { pool, table } from '../config/database.js';
import { resolveCiFile, stripHtml, toIsoUtc } from '../utils/ciHelpers.js';
export class ProjectService {
    async getProjects(userId, isAdmin, status, onlyMyProjects = true) {
        let whereClause = `WHERE p.deleted = 0`;
        const params = [];
        // Filter projects related to the logged-in user (via project_members.user_id, created_by, task assignee/collaborator, or client_id)
        if (onlyMyProjects || !isAdmin) {
            whereClause += ` AND (
        p.id IN (SELECT pm.project_id FROM ${table('project_members')} pm WHERE pm.user_id = ? AND pm.deleted = 0)
        OR p.created_by = ?
        OR p.id IN (
          SELECT st.project_id FROM ${table('tasks')} st
          WHERE st.deleted = 0 AND (st.assigned_to = ? OR FIND_IN_SET(?, REPLACE(st.collaborators, ' ', '')))
        )
        OR (
          p.client_id > 0 AND p.client_id = (
            SELECT cu.client_id FROM ${table('users')} cu WHERE cu.id = ? AND cu.deleted = 0 LIMIT 1
          )
        )
      )`;
            params.push(userId, userId, userId, String(userId), userId);
        }
        if (status && ['open', 'completed', 'hold', 'canceled'].includes(status)) {
            if (status === 'open') {
                whereClause += ` AND (p.status = 'open' AND (p.status_id = 1 OR p.status_id IS NULL OR ps.key_name = 'open'))`;
            }
            else if (status === 'completed') {
                whereClause += ` AND (p.status = 'completed' OR p.status_id = 2 OR ps.key_name = 'completed')`;
            }
            else if (status === 'hold') {
                whereClause += ` AND (p.status = 'hold' OR p.status_id = 3)`;
            }
            else if (status === 'canceled') {
                whereClause += ` AND (p.status = 'canceled' OR p.status_id = 4)`;
            }
        }
        const [rows] = await pool.query(`SELECT p.id, p.title, p.description, p.project_type, p.start_date, p.deadline,
              p.client_id, p.created_date, p.created_by, p.status, p.status_id,
              p.price, p.labels, c.company_name AS client_name,
              ps.title AS status_title, ps.key_name AS status_key,
              COUNT(DISTINCT t.id) AS total_tasks,
              COUNT(DISTINCT CASE WHEN t.status = 'done' OR t.status_id IN (3, 4) THEN t.id END) AS completed_tasks
       FROM ${table('projects')} p
       LEFT JOIN ${table('clients')} c ON c.id = p.client_id
       LEFT JOIN ${table('project_status')} ps ON ps.id = p.status_id
       LEFT JOIN ${table('tasks')} t ON t.project_id = p.id AND t.deleted = 0
       ${whereClause}
       GROUP BY p.id
       ORDER BY p.id DESC`, params);
        return rows.map((p) => {
            const totalTasks = Number(p.total_tasks) || 0;
            const completedTasks = Number(p.completed_tasks) || 0;
            const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
            const resolvedStatus = p.status_id === 2
                ? 'completed'
                : p.status_id === 3
                    ? 'hold'
                    : p.status_id === 4
                        ? 'canceled'
                        : p.status || 'open';
            return {
                id: p.id,
                title: p.title,
                description: stripHtml(p.description),
                project_type: p.project_type,
                start_date: p.start_date && !String(p.start_date).startsWith('0000') ? p.start_date : null,
                deadline: p.deadline && !String(p.deadline).startsWith('0000') ? p.deadline : null,
                status: resolvedStatus,
                status_id: p.status_id,
                status_title: p.status_title || resolvedStatus,
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
              ps.title AS status_title,
              COUNT(DISTINCT t.id) AS total_tasks,
              COUNT(DISTINCT CASE WHEN t.status = 'done' OR t.status_id IN (3, 4) THEN t.id END) AS completed_tasks
       FROM ${table('projects')} p
       LEFT JOIN ${table('clients')} c ON c.id = p.client_id
       LEFT JOIN ${table('project_status')} ps ON ps.id = p.status_id
       LEFT JOIN ${table('tasks')} t ON t.project_id = p.id AND t.deleted = 0
       WHERE p.id = ? AND p.deleted = 0
       GROUP BY p.id`, [projectId]);
        if (projectRows.length === 0) {
            throw new Error('Project tidak ditemukan');
        }
        const project = projectRows[0];
        if (!isAdmin) {
            const [accessCheck] = await pool.query(`SELECT 1 AS has_access FROM DUAL WHERE
          EXISTS (
            SELECT 1 FROM ${table('project_members')} pm
            WHERE pm.project_id = ? AND pm.user_id = ? AND pm.deleted = 0
          )
          OR EXISTS (
            SELECT 1 FROM ${table('tasks')} t
            WHERE t.project_id = ? AND t.deleted = 0
              AND (t.assigned_to = ? OR FIND_IN_SET(?, REPLACE(t.collaborators, ' ', '')))
          )
          OR EXISTS (
            SELECT 1 FROM ${table('users')} u
            WHERE u.id = ? AND u.deleted = 0 AND u.client_id > 0 AND u.client_id = ?
          )`, [projectId, userId, projectId, userId, String(userId), userId, project.client_id || 0]);
            if (accessCheck.length === 0 && project.created_by !== userId) {
                throw new Error('Anda tidak memiliki akses ke project ini');
            }
        }
        // Get project members
        const [members] = await pool.query(`SELECT pm.id, pm.user_id, pm.is_leader,
              u.first_name, u.last_name, u.email, u.image, u.job_title
       FROM ${table('project_members')} pm
       INNER JOIN ${table('users')} u ON u.id = pm.user_id
       WHERE pm.project_id = ? AND pm.deleted = 0 AND u.deleted = 0`, [projectId]);
        // Get milestones
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
        const resolvedStatus = project.status_id === 2
            ? 'completed'
            : project.status_id === 3
                ? 'hold'
                : project.status_id === 4
                    ? 'canceled'
                    : project.status || 'open';
        return {
            id: project.id,
            title: project.title,
            description: stripHtml(project.description),
            project_type: project.project_type,
            start_date: project.start_date && !String(project.start_date).startsWith('0000')
                ? project.start_date
                : null,
            deadline: project.deadline && !String(project.deadline).startsWith('0000')
                ? project.deadline
                : null,
            status: resolvedStatus,
            status_id: project.status_id,
            status_title: project.status_title || resolvedStatus,
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
