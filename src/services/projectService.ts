import { pool, table } from '../config/database.js';
import { RowDataPacket } from 'mysql2';
import { resolveCiFile, stripHtml } from '../utils/ciHelpers.js';

export class ProjectService {
  async getProjects(userId: number, isAdmin: boolean, status?: string) {
    let whereClause = `WHERE p.deleted = 0`;
    const params: any[] = [];

    // Filter by membership if not admin
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

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.title, p.description, p.project_type, p.start_date, p.deadline,
              p.client_id, p.created_date, p.created_by, p.status, p.status_id,
              p.price, c.company_name AS client_name,
              COUNT(t.id) AS total_tasks,
              SUM(CASE WHEN t.status = 'done' OR t.status_id IN (3, 4) THEN 1 ELSE 0 END) AS completed_tasks
       FROM ${table('projects')} p
       LEFT JOIN ${table('clients')} c ON c.id = p.client_id
       LEFT JOIN ${table('tasks')} t ON t.project_id = p.id AND t.deleted = 0
       ${whereClause}
       GROUP BY p.id
       ORDER BY p.id DESC`,
      params
    );

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

  async getProjectById(projectId: number, userId: number, isAdmin: boolean) {
    const [projectRows] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.title, p.description, p.project_type, p.start_date, p.deadline,
              p.client_id, p.created_date, p.created_by, p.status, p.status_id,
              p.price, c.company_name AS client_name,
              COUNT(t.id) AS total_tasks,
              SUM(CASE WHEN t.status = 'done' OR t.status_id IN (3, 4) THEN 1 ELSE 0 END) AS completed_tasks
       FROM ${table('projects')} p
       LEFT JOIN ${table('clients')} c ON c.id = p.client_id
       LEFT JOIN ${table('tasks')} t ON t.project_id = p.id AND t.deleted = 0
       WHERE p.id = ? AND p.deleted = 0
       GROUP BY p.id`,
      [projectId]
    );

    if (projectRows.length === 0) {
      throw new Error('Project tidak ditemukan');
    }

    const project = projectRows[0];

    // Check authorization if not admin
    if (!isAdmin) {
      const [memberCheck] = await pool.query<RowDataPacket[]>(
        `SELECT id FROM ${table('project_members')}
         WHERE project_id = ? AND user_id = ? AND deleted = 0`,
        [projectId, userId]
      );
      if (memberCheck.length === 0 && project.created_by !== userId) {
        throw new Error('Anda tidak memiliki akses ke project ini');
      }
    }

    // Get project members
    const [members] = await pool.query<RowDataPacket[]>(
      `SELECT pm.id, pm.user_id, pm.is_leader,
              u.first_name, u.last_name, u.email, u.image, u.job_title
       FROM ${table('project_members')} pm
       INNER JOIN ${table('users')} u ON u.id = pm.user_id
       WHERE pm.project_id = ? AND pm.deleted = 0 AND u.deleted = 0`,
      [projectId]
    );

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
    };
  }
}

export const projectService = new ProjectService();
