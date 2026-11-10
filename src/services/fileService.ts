import { pool, table } from '../config/database.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseUploadDir = path.resolve(__dirname, '../../../paas/files');

export class FileService {
  async getFiles(userId: number, isAdmin: boolean, projectId?: number, page = 1, limit = 20) {
    const offset = (page - 1) * limit;

    if (projectId) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT pf.id, pf.file_name, pf.description, pf.file_size, pf.created_at,
                pf.project_id, pf.uploaded_by,
                p.title AS project_title,
                CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
         FROM ${table('project_files')} pf
         LEFT JOIN ${table('projects')} p ON p.id = pf.project_id
         LEFT JOIN ${table('users')} u ON u.id = pf.uploaded_by
         WHERE pf.project_id = ? AND pf.deleted = 0
         ORDER BY pf.id DESC
         LIMIT ? OFFSET ?`,
        [projectId, limit, offset]
      );

      return rows.map((r) => ({
        id: r.id,
        file_name: r.file_name,
        original_name: r.file_name.replace(/^\d+-\d+_/, ''),
        description: r.description,
        file_size: r.file_size,
        file_size_formatted: `${(r.file_size / (1024 * 1024)).toFixed(2)} MB`,
        created_at: r.created_at,
        project_id: r.project_id,
        project_title: r.project_title,
        uploaded_by: r.uploaded_by,
        uploaded_by_name: r.uploaded_by_name || 'System',
        type: 'project',
      }));
    }

    // General + project files union
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT gf.id, gf.file_name, gf.description, gf.file_size, gf.created_at,
              NULL as project_id, NULL as project_title, gf.uploaded_by,
              CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name,
              'general' AS type
       FROM ${table('general_files')} gf
       LEFT JOIN ${table('users')} u ON u.id = gf.uploaded_by
       WHERE gf.deleted = 0
       ORDER BY gf.id DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return rows.map((r) => ({
      id: r.id,
      file_name: r.file_name,
      original_name: r.file_name.replace(/^\d+-\d+_/, ''),
      description: r.description,
      file_size: r.file_size,
      file_size_formatted: `${(r.file_size / (1024 * 1024)).toFixed(2)} MB`,
      created_at: r.created_at,
      project_id: null,
      project_title: null,
      uploaded_by: r.uploaded_by,
      uploaded_by_name: r.uploaded_by_name || 'System',
      type: 'general',
    }));
  }

  async saveUploadedFile(file: Express.Multer.File, userId: number, projectId?: number, description?: string) {
    if (projectId) {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO ${table('project_files')}
         (file_name, file_size, description, project_id, uploaded_by, created_at, deleted)
         VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
        [file.filename, file.size, description || null, projectId, userId]
      );

      return {
        id: result.insertId,
        file_name: file.filename,
        original_name: file.originalname,
        file_size: file.size,
        project_id: projectId,
        description,
      };
    } else {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO ${table('general_files')}
         (file_name, file_size, description, context, user_id, uploaded_by, created_at, deleted)
         VALUES (?, ?, ?, 'general', ?, ?, NOW(), 0)`,
        [file.filename, file.size, description || null, userId, userId]
      );

      return {
        id: result.insertId,
        file_name: file.filename,
        original_name: file.originalname,
        file_size: file.size,
        description,
      };
    }
  }

  async getFilePath(fileId: number, type: 'project' | 'general' = 'project') {
    if (type === 'project') {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, project_id FROM ${table('project_files')} WHERE id = ? AND deleted = 0`,
        [fileId]
      );
      if (rows.length === 0) throw new Error('File not found');

      const { file_name, project_id } = rows[0];
      const filePath = path.join(baseUploadDir, 'project_files', String(project_id), file_name);
      return { filePath, fileName: file_name };
    } else {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name FROM ${table('general_files')} WHERE id = ? AND deleted = 0`,
        [fileId]
      );
      if (rows.length === 0) throw new Error('File not found');

      const { file_name } = rows[0];
      const filePath = path.join(baseUploadDir, 'general', file_name);
      return { filePath, fileName: file_name };
    }
  }
}

export const fileService = new FileService();
