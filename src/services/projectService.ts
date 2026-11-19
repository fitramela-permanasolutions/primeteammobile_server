import { pool, table } from '../config/database.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { resolveCiFile, stripHtml, toIsoUtc } from '../utils/ciHelpers.js';
import { pusherService } from './pusherService.js';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function buildPhpSerializedFilesArray(file: Express.Multer.File): string {
  const fn = file.filename;
  const size = file.size || 0;
  return `a:1:{i:0;a:4:{s:9:"file_name";s:${Buffer.byteLength(fn)}:"${fn}";s:9:"file_size";i:${size};s:7:"file_id";N;s:12:"service_type";N;}}`;
}

function parseAttachments(rawFiles: string | null | undefined, folderPath: string) {
  if (!rawFiles || rawFiles === 'a:0:{}') return [];
  const results: Array<{ file_name: string; original_name: string; url: string; is_image: boolean }> = [];
  const regex = /s:9:"file_name";s:\d+:"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawFiles)) !== null) {
    const fileName = match[1];
    const cleanName = fileName.replace(/^_file[a-f0-9]+-/i, '');
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(fileName);
    results.push({
      file_name: fileName,
      original_name: cleanName,
      url: `/files-static/${folderPath}/${encodeURIComponent(fileName)}`,
      is_image: isImage,
    });
  }
  return results;
}

export class ProjectService {
  private chatTableReady = false;

  private async ensureProjectChatTable(): Promise<void> {
    if (this.chatTableReady) return;
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${table('project_chat_messages')} (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        user_id INT NOT NULL,
        message MEDIUMTEXT NOT NULL,
        files LONGTEXT DEFAULT NULL,
        created_at DATETIME NOT NULL,
        deleted TINYINT(1) NOT NULL DEFAULT 0,
        INDEX idx_project_created (project_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    );
    this.chatTableReady = true;
  }

  async assertProjectAccess(projectId: number, userId: number, isAdmin: boolean): Promise<void> {
    if (isAdmin) return;
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT 1 AS has_access FROM ${table('projects')} p
       WHERE p.id = ? AND p.deleted = 0 AND (
         p.id IN (SELECT pm.project_id FROM ${table('project_members')} pm WHERE pm.user_id = ? AND pm.deleted = 0)
         OR p.created_by = ?
         OR (
           p.client_id > 0 AND p.client_id = (
             SELECT cu.client_id FROM ${table('users')} cu WHERE cu.id = ? AND cu.deleted = 0 LIMIT 1
           )
         )
       ) LIMIT 1`,
      [projectId, userId, userId, userId]
    );
    if (rows.length === 0) {
      throw new Error('Akses ditolak: Anda bukan anggota project ini.');
    }
  }

  private async getProjectMemberIds(projectId: number): Promise<number[]> {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT user_id FROM ${table('project_members')}
       WHERE project_id = ? AND deleted = 0`,
      [projectId]
    );
    return rows.map((r) => Number(r.user_id)).filter((id) => id > 0);
  }
  async getProjects(
    userId: number,
    isAdmin: boolean,
    status?: string,
    onlyMyProjects = true
  ) {
    let whereClause = `WHERE p.deleted = 0`;
    const params: any[] = [];

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
      } else if (status === 'completed') {
        whereClause += ` AND (p.status = 'completed' OR p.status_id = 2 OR ps.key_name = 'completed')`;
      } else if (status === 'hold') {
        whereClause += ` AND (p.status = 'hold' OR p.status_id = 3)`;
      } else if (status === 'canceled') {
        whereClause += ` AND (p.status = 'canceled' OR p.status_id = 4)`;
      }
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.title, p.description, p.project_type, p.start_date, p.deadline,
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
       ORDER BY p.id DESC`,
      params
    );

    return rows.map((p) => {
      const totalTasks = Number(p.total_tasks) || 0;
      const completedTasks = Number(p.completed_tasks) || 0;
      const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      const resolvedStatus =
        p.status_id === 2
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

  async getProjectById(projectId: number, userId: number, isAdmin: boolean) {
    const [projectRows] = await pool.query<RowDataPacket[]>(
      `SELECT p.id, p.title, p.description, p.project_type, p.start_date, p.deadline,
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
       GROUP BY p.id`,
      [projectId]
    );

    if (projectRows.length === 0) {
      throw new Error('Project tidak ditemukan');
    }

    const project = projectRows[0];

    if (!isAdmin) {
      const [accessCheck] = await pool.query<RowDataPacket[]>(
        `SELECT 1 AS has_access FROM DUAL WHERE
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
          )`,
        [projectId, userId, projectId, userId, String(userId), userId, project.client_id || 0]
      );
      if (accessCheck.length === 0 && project.created_by !== userId) {
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

    // Get milestones
    const [milestones] = await pool.query<RowDataPacket[]>(
      `SELECT id, title, due_date, description, deleted
       FROM ${table('milestones')}
       WHERE project_id = ? AND deleted = 0
       ORDER BY due_date ASC`,
      [projectId]
    );

    // Get project notes from permana_notes
    const [notes] = await pool.query<RowDataPacket[]>(
      `SELECT n.id, n.title, n.description, n.color, n.created_at, n.is_public,
              CONCAT(u.first_name, ' ', u.last_name) AS author_name
       FROM ${table('notes')} n
       LEFT JOIN ${table('users')} u ON u.id = n.created_by
       WHERE n.project_id = ? AND n.deleted = 0
       ORDER BY n.id DESC`,
      [projectId]
    );

    // Get project folders from permana_folders
    const [folders] = await pool.query<RowDataPacket[]>(
      `SELECT f.id, f.title, f.folder_id, f.parent_id, f.created_at,
              (SELECT COUNT(*) FROM ${table('project_files')} pf WHERE pf.folder_id = f.id AND pf.deleted = 0) AS file_count
       FROM ${table('folders')} f
       WHERE f.context = 'project' AND f.context_id = ? AND f.deleted = 0
       ORDER BY f.title ASC`,
      [projectId]
    );

    // Get project timesheets from permana_project_time
    const [timesheets] = await pool.query<RowDataPacket[]>(
      `SELECT pt.id, pt.user_id, pt.start_time, pt.end_time, pt.hours, pt.status, pt.note, pt.task_id,
              t.title AS task_title,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ${table('project_time')} pt
       LEFT JOIN ${table('tasks')} t ON t.id = pt.task_id
       LEFT JOIN ${table('users')} u ON u.id = pt.user_id
       WHERE pt.project_id = ? AND pt.deleted = 0
       ORDER BY pt.id DESC`,
      [projectId]
    );

    const totalTasks = Number(project.total_tasks) || 0;
    const completedTasks = Number(project.completed_tasks) || 0;
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const resolvedStatus =
      project.status_id === 2
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
      start_date:
        project.start_date && !String(project.start_date).startsWith('0000')
          ? project.start_date
          : null,
      deadline:
        project.deadline && !String(project.deadline).startsWith('0000')
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

  async getProjectComments(projectId: number, userId: number, isAdmin: boolean) {
    await this.assertProjectAccess(projectId, userId, isAdmin);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT pc.id, pc.created_by, pc.created_at, pc.description, pc.files,
              CONCAT(u.first_name, ' ', u.last_name) AS author_name,
              u.image AS author_avatar
       FROM ${table('project_comments')} pc
       LEFT JOIN ${table('users')} u ON u.id = pc.created_by
       WHERE pc.project_id = ? AND pc.task_id = 0 AND pc.deleted = 0
       ORDER BY pc.created_at DESC, pc.id DESC
       LIMIT 100`,
      [projectId]
    );

    return rows.map((c) => {
      const avatar = resolveCiFile(c.author_avatar, 'profile_images');
      return {
        id: c.id,
        project_id: projectId,
        description: stripHtml(c.description),
        created_by: c.created_by,
        author_name: String(c.author_name || '').trim() || 'User',
        author_avatar: avatar?.thumbnailUrl || null,
        created_at: toIsoUtc(c.created_at) || c.created_at,
        attachments: parseAttachments(c.files, `project_files/${projectId}`),
      };
    });
  }

  async addProjectComment(
    projectId: number,
    userId: number,
    isAdmin: boolean,
    description: string,
    file?: Express.Multer.File
  ) {
    await this.assertProjectAccess(projectId, userId, isAdmin);
    const serializedFiles = file ? buildPhpSerializedFilesArray(file) : 'a:0:{}';
    const htmlDesc = description ? `<p>${description.trim()}</p>` : `<p>Mengunggah lampiran</p>`;

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${table('project_comments')}
       (created_by, created_at, description, project_id, comment_id, task_id, file_id, customer_feedback_id, files, deleted)
       VALUES (?, UTC_TIMESTAMP(), ?, ?, 0, 0, 0, 0, ?, 0)`,
      [userId, htmlDesc, projectId, serializedFiles]
    );

    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT CONCAT(first_name, ' ', last_name) AS name, image FROM ${table('users')} WHERE id = ? LIMIT 1`,
      [userId]
    );
    const authorName = String(userRows[0]?.name || '').trim() || 'Team Member';
    const avatar = resolveCiFile(userRows[0]?.image, 'profile_images');

    const payload = {
      id: result.insertId,
      project_id: projectId,
      description: description.trim() || (file ? `Lampiran: ${file.originalname}` : ''),
      created_by: userId,
      author_name: authorName,
      author_avatar: avatar?.thumbnailUrl || null,
      created_at: new Date().toISOString(),
      attachments: parseAttachments(serializedFiles, `project_files/${projectId}`),
    };

    pusherService.triggerProjectComment(projectId, payload).catch(() => {});
    const memberIds = (await this.getProjectMemberIds(projectId)).filter((id) => id !== userId);
    if (memberIds.length > 0) {
      pusherService
        .notifyUsers(memberIds, {
          title: `Komentar Baru • ${authorName}`,
          message: payload.description,
          project_id: projectId,
          type: 'project_comment',
        })
        .catch(() => {});
    }

    return payload;
  }

  async getProjectFiles(projectId: number, userId: number, isAdmin: boolean) {
    await this.assertProjectAccess(projectId, userId, isAdmin);
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT pf.id, pf.file_name, pf.file_id, pf.service_type, pf.description,
              pf.file_size, pf.created_at, pf.project_id, pf.uploaded_by,
              CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM ${table('project_files')} pf
       LEFT JOIN ${table('users')} u ON u.id = pf.uploaded_by
       WHERE pf.project_id = ? AND pf.deleted = 0
       ORDER BY pf.created_at DESC, pf.id DESC`,
      [projectId]
    );

    return rows.map((f) => {
      const cleanName = String(f.file_name || '').replace(/^_file[a-f0-9]+-/i, '');
      const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f.file_name || '');
      return {
        id: f.id,
        type: 'project' as const,
        file_name: f.file_name,
        original_name: cleanName,
        file_id: f.file_id || null,
        service_type: f.service_type || 'local',
        description: stripHtml(f.description),
        file_size: Number(f.file_size || 0),
        file_size_formatted: formatBytes(Number(f.file_size || 0)),
        project_id: projectId,
        uploaded_by: f.uploaded_by,
        uploaded_by_name: String(f.uploaded_by_name || '').trim() || 'User',
        created_at: toIsoUtc(f.created_at) || f.created_at,
        is_image: isImage,
        preview_url: `/files-static/project_files/${projectId}/${encodeURIComponent(f.file_name)}`,
      };
    });
  }

  async uploadProjectFile(
    projectId: number,
    userId: number,
    isAdmin: boolean,
    file: Express.Multer.File,
    description: string
  ) {
    await this.assertProjectAccess(projectId, userId, isAdmin);
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${table('project_files')}
       (file_name, file_id, service_type, description, file_size, created_at, project_id, uploaded_by, category_id, deleted, folder_id)
       VALUES (?, NULL, NULL, ?, ?, UTC_TIMESTAMP(), ?, ?, 0, 0, 0)`,
      [file.filename, description || '', file.size || 0, projectId, userId]
    );

    const cleanName = file.filename.replace(/^_file[a-f0-9]+-/i, '');
    const isImage = /\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(file.filename);
    return {
      id: result.insertId,
      type: 'project' as const,
      file_name: file.filename,
      original_name: cleanName,
      file_id: null,
      service_type: 'local',
      description,
      file_size: file.size || 0,
      file_size_formatted: formatBytes(file.size || 0),
      project_id: projectId,
      uploaded_by: userId,
      uploaded_by_name: 'Anda',
      created_at: new Date().toISOString(),
      is_image: isImage,
      preview_url: `/files-static/project_files/${projectId}/${encodeURIComponent(file.filename)}`,
    };
  }

  async getProjectChatMessages(projectId: number, userId: number, isAdmin: boolean) {
    await this.assertProjectAccess(projectId, userId, isAdmin);
    await this.ensureProjectChatTable();

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT m.id, m.project_id, m.user_id, m.message, m.files, m.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS sender_name,
              u.image AS sender_avatar
       FROM ${table('project_chat_messages')} m
       LEFT JOIN ${table('users')} u ON u.id = m.user_id
       WHERE m.project_id = ? AND m.deleted = 0
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT 150`,
      [projectId]
    );

    return rows.map((m) => {
      const avatar = resolveCiFile(m.sender_avatar, 'profile_images');
      return {
        id: m.id,
        project_id: m.project_id,
        user_id: m.user_id,
        sender_name: String(m.sender_name || '').trim() || 'Team Member',
        sender_avatar: avatar?.thumbnailUrl || null,
        message: m.message,
        attachments: parseAttachments(m.files, `project_files/${projectId}`),
        created_at: toIsoUtc(m.created_at) || m.created_at,
      };
    });
  }

  async sendProjectChatMessage(
    projectId: number,
    userId: number,
    isAdmin: boolean,
    message: string,
    file?: Express.Multer.File
  ) {
    await this.assertProjectAccess(projectId, userId, isAdmin);
    await this.ensureProjectChatTable();

    const serializedFiles = file ? buildPhpSerializedFilesArray(file) : null;
    const finalMsg = message.trim() || (file ? `Mengirim lampiran: ${file.originalname}` : '');

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${table('project_chat_messages')}
       (project_id, user_id, message, files, created_at, deleted)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), 0)`,
      [projectId, userId, finalMsg, serializedFiles]
    );

    const [userRows] = await pool.query<RowDataPacket[]>(
      `SELECT CONCAT(first_name, ' ', last_name) AS name, image FROM ${table('users')} WHERE id = ? LIMIT 1`,
      [userId]
    );
    const [projRows] = await pool.query<RowDataPacket[]>(
      `SELECT title FROM ${table('projects')} WHERE id = ? LIMIT 1`,
      [projectId]
    );
    const senderName = String(userRows[0]?.name || '').trim() || 'Team Member';
    const projectTitle = String(projRows[0]?.title || 'Project').trim();
    const avatar = resolveCiFile(userRows[0]?.image, 'profile_images');

    const chatPayload = {
      id: result.insertId,
      project_id: projectId,
      user_id: userId,
      sender_name: senderName,
      sender_avatar: avatar?.thumbnailUrl || null,
      message: finalMsg,
      attachments: parseAttachments(serializedFiles, `project_files/${projectId}`),
      created_at: new Date().toISOString(),
    };

    // 1. Broadcast realtime to project chat channel
    pusherService.triggerProjectChat(projectId, chatPayload).catch(() => {});

    // 2. Notify all other project members via Pusher + permana_notifications so they get OS push/local notifications
    const otherMembers = (await this.getProjectMemberIds(projectId)).filter((id) => id !== userId);
    if (otherMembers.length > 0) {
      pusherService
        .notifyUsers(otherMembers, {
          title: `${projectTitle} • ${senderName}`,
          message: finalMsg,
          project_id: projectId,
          type: 'project_chat',
        })
        .catch(() => {});

      try {
        await pool.query(
          `INSERT INTO ${table('notifications')}
           (user_id, description, created_at, notify_to, read_by, event, project_id, deleted)
           VALUES (?, ?, UTC_TIMESTAMP(), ?, '', 'project_chat_message', ?, 0)`,
          [userId, `${senderName} (${projectTitle}): ${finalMsg}`, otherMembers.join(','), projectId]
        );
      } catch {
        // Ignore if optional notification columns differ
      }
    }

    return chatPayload;
  }

  async deleteProjectFile(projectId: number, fileId: number, userId: number, isAdmin: boolean) {
    await this.assertProjectAccess(projectId, userId, isAdmin);
    await pool.query(
      `UPDATE ${table('project_files')} SET deleted = 1 WHERE id = ? AND project_id = ?`,
      [fileId, projectId]
    );
    return { id: fileId, deleted: true };
  }

  async deleteProjectComment(projectId: number, commentId: number, userId: number, isAdmin: boolean) {
    await this.assertProjectAccess(projectId, userId, isAdmin);
    await pool.query(
      `UPDATE ${table('project_comments')} SET deleted = 1 WHERE id = ? AND project_id = ? AND task_id = 0`,
      [commentId, projectId]
    );
    return { id: commentId, deleted: true };
  }
}

export const projectService = new ProjectService();
