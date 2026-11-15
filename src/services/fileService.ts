import { pool, table } from '../config/database.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  cleanCiFileName,
  isImageFileName,
  resolveCiFile,
  stripHtml,
  toIsoUtc,
} from '../utils/ciHelpers.js';
import { googleDriveService } from './googleDriveService.js';
import { settingsService } from './settingsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fallbackUploadDir = path.resolve(__dirname, '../../../paas/files');

export class FileService {
  private formatFileRecord(r: any, type: 'project' | 'general') {
    const folderPath =
      type === 'project'
        ? r.project_id
          ? `project_files/${r.project_id}`
          : 'project_files'
        : 'general/global_files/all';

    const resolved = resolveCiFile(
      {
        file_name: r.file_name,
        file_id: r.file_id,
        service_type: r.service_type,
      },
      folderPath,
      false
    );

    const sizeBytes = Number(r.file_size) || 0;
    const sizeFormatted =
      sizeBytes >= 1024 * 1024
        ? `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
        : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;

    return {
      id: r.id,
      file_name: r.file_name,
      original_name: cleanCiFileName(r.file_name),
      file_id: r.file_id || null,
      service_type: r.service_type === 'google' ? 'google' : 'local',
      is_image: isImageFileName(r.file_name),
      preview_url: resolved?.thumbnailUrl || null,
      download_url:
        r.service_type === 'google' && r.file_id
          ? `https://drive.google.com/uc?export=download&id=${r.file_id}`
          : `/api/v1/files/${r.id}/download?type=${type}`,
      description: stripHtml(r.description),
      file_size: sizeBytes,
      file_size_formatted: sizeFormatted,
      created_at: toIsoUtc(r.created_at) || r.created_at,
      project_id: r.project_id || null,
      project_title: r.project_title || (type === 'general' ? 'Dokumen Umum' : null),
      folder_id: r.folder_id || 0,
      folder_title: r.folder_title || null,
      category_id: r.category_id || 0,
      category_name: r.category_name || null,
      uploaded_by: r.uploaded_by,
      uploaded_by_name: r.uploaded_by_name?.trim() || 'System',
      type,
    };
  }

  /**
   * Lists file categories from permana_file_category (e.g. Marketing, Operational, Finance, Kick Off)
   */
  async getFileCategories(type = 'project') {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, name, type FROM ${table('file_category')}
       WHERE deleted = 0 AND (type = ? OR ? = 'all')
       ORDER BY id ASC`,
      [type, type]
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
    }));
  }

  /**
   * Lists folders from permana_folders matching PAAS App_folders trait
   */
  async getFolders(
    userId: number,
    options: {
      parentId?: number;
      context?: 'file_manager' | 'project' | 'all';
      projectId?: number;
    } = {}
  ) {
    const conditions: string[] = ['f.deleted = 0'];
    const params: any[] = [];

    if (options.parentId !== undefined) {
      conditions.push('f.parent_id = ?');
      params.push(options.parentId);
    }

    if (options.projectId) {
      conditions.push("f.context = 'project' AND f.context_id = ?");
      params.push(options.projectId);
    } else if (options.context && options.context !== 'all') {
      conditions.push('f.context = ?');
      params.push(options.context);
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT f.id, f.title, f.folder_id, f.parent_id, f.level, f.created_by,
              f.created_at, f.permissions, f.context, f.context_id, f.starred_by,
              p.title AS project_title,
              CONCAT(u.first_name, ' ', u.last_name) AS creator_name,
              (SELECT COUNT(*) FROM ${table('folders')} sf WHERE sf.parent_id = f.id AND sf.deleted = 0) AS subfolder_count,
              (SELECT COUNT(*) FROM ${table('general_files')} gf WHERE gf.folder_id = f.id AND gf.deleted = 0) +
              (SELECT COUNT(*) FROM ${table('project_files')} pf WHERE pf.folder_id = f.id AND pf.deleted = 0) AS file_count
       FROM ${table('folders')} f
       LEFT JOIN ${table('projects')} p ON f.context = 'project' AND p.id = f.context_id
       LEFT JOIN ${table('users')} u ON u.id = f.created_by
       WHERE ${conditions.join(' AND ')}
       ORDER BY f.title ASC`,
      params
    );

    return rows.map((r) => {
      const starredIds = String(r.starred_by || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        id: r.id,
        title: r.title,
        folder_id: r.folder_id,
        parent_id: r.parent_id || 0,
        level: r.level || '',
        context: r.context,
        context_id: r.context_id || 0,
        project_title: r.project_title || (r.context === 'file_manager' ? 'Global File Manager' : null),
        created_by: r.created_by,
        creator_name: r.creator_name || 'Admin',
        created_at: toIsoUtc(r.created_at) || r.created_at,
        permissions: r.permissions || '',
        is_starred: starredIds.includes(String(userId)),
        subfolder_count: Number(r.subfolder_count || 0),
        file_count: Number(r.file_count || 0),
      };
    });
  }

  /**
   * Creates a folder in permana_folders using the exact CI4 folder_id hash format
   */
  async createFolder(
    userId: number,
    input: {
      title: string;
      parentId?: number;
      context?: 'file_manager' | 'project';
      projectId?: number;
      permissions?: string;
    }
  ) {
    const parentId = input.parentId || 0;
    const context = input.projectId ? 'project' : input.context || 'file_manager';
    const contextId = input.projectId || 0;

    let level = '';
    if (parentId > 0) {
      const [parentRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, level FROM ${table('folders')} WHERE id = ? LIMIT 1`,
        [parentId]
      );
      if (parentRows.length > 0) {
        const p = parentRows[0];
        level = p.level ? `${p.level}${p.id},` : `,${p.id},`;
      }
    }

    const md5 = (v: string) => crypto.createHash('md5').update(v).digest('hex');
    const randStr = crypto.randomBytes(8).toString('base64url').slice(0, 11);
    const folderHash = `${md5(context).slice(-7)}-${md5(String(contextId)).slice(-5)}-${md5(
      String(userId)
    ).slice(-4)}-${md5(parentId ? String(parentId) : 'root').slice(-5)}-${randStr}`;

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${table('folders')}
       (title, folder_id, parent_id, level, created_by, created_at, permissions, context, context_id, starred_by, deleted)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, '', 0)`,
      [
        input.title.trim(),
        folderHash,
        parentId,
        level,
        userId,
        input.permissions || '',
        context,
        contextId,
      ]
    );

    return {
      id: result.insertId,
      title: input.title.trim(),
      folder_id: folderHash,
      parent_id: parentId,
      context,
      context_id: contextId,
    };
  }

  /**
   * Toggles starred status on a folder for userId
   */
  async toggleStarFolder(userId: number, folderId: number) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, starred_by FROM ${table('folders')} WHERE id = ? AND deleted = 0 LIMIT 1`,
      [folderId]
    );
    if (rows.length === 0) throw new Error('Folder tidak ditemukan');

    const currentList = String(rows[0].starred_by || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const uidStr = String(userId);
    const isStarred = currentList.includes(uidStr);
    const nextList = isStarred
      ? currentList.filter((x) => x !== uidStr)
      : [...currentList, uidStr];

    await pool.query(`UPDATE ${table('folders')} SET starred_by = ? WHERE id = ?`, [
      nextList.join(','),
      folderId,
    ]);

    return { id: folderId, is_starred: !isStarred };
  }

  /**
   * Soft-deletes a folder
   */
  async deleteFolder(folderId: number) {
    await pool.query(`UPDATE ${table('folders')} SET deleted = 1 WHERE id = ?`, [folderId]);
    return { id: folderId, deleted: true };
  }

  async getFiles(
    userId: number,
    isAdmin: boolean,
    projectId?: number,
    page = 1,
    limit = 40,
    folderId?: number,
    categoryId?: number,
    search?: string
  ) {
    const offset = (page - 1) * limit;

    if (projectId) {
      const conds = ['pf.project_id = ?', 'pf.deleted = 0'];
      const params: any[] = [projectId];

      if (folderId !== undefined) {
        conds.push('pf.folder_id = ?');
        params.push(folderId);
      }
      if (categoryId) {
        conds.push('pf.category_id = ?');
        params.push(categoryId);
      }
      if (search?.trim()) {
        conds.push('(pf.file_name LIKE ? OR pf.description LIKE ?)');
        params.push(`%${search.trim()}%`, `%${search.trim()}%`);
      }

      params.push(limit, offset);

      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT pf.id, pf.file_name, pf.file_id, pf.service_type, pf.description,
                pf.file_size, pf.created_at, pf.project_id, pf.uploaded_by,
                pf.folder_id, pf.category_id,
                f.title AS folder_title,
                fc.name AS category_name,
                p.title AS project_title,
                CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
         FROM ${table('project_files')} pf
         LEFT JOIN ${table('projects')} p ON p.id = pf.project_id
         LEFT JOIN ${table('folders')} f ON f.id = pf.folder_id
         LEFT JOIN ${table('file_category')} fc ON fc.id = pf.category_id
         LEFT JOIN ${table('users')} u ON u.id = pf.uploaded_by
         WHERE ${conds.join(' AND ')}
         ORDER BY pf.id DESC
         LIMIT ? OFFSET ?`,
        params
      );

      return rows.map((r) => this.formatFileRecord(r, 'project'));
    }

    const pfConds = ['pf.deleted = 0'];
    const pfParams: any[] = [];
    const gfConds = ['gf.deleted = 0'];
    const gfParams: any[] = [];

    if (folderId !== undefined) {
      pfConds.push('pf.folder_id = ?');
      pfParams.push(folderId);
      gfConds.push('gf.folder_id = ?');
      gfParams.push(folderId);
    }

    if (categoryId) {
      pfConds.push('pf.category_id = ?');
      pfParams.push(categoryId);
    }

    if (search?.trim()) {
      pfConds.push('(pf.file_name LIKE ? OR pf.description LIKE ?)');
      pfParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
      gfConds.push('(gf.file_name LIKE ? OR gf.description LIKE ?)');
      gfParams.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    const [projectRows] = await pool.query<RowDataPacket[]>(
      `SELECT pf.id, pf.file_name, pf.file_id, pf.service_type, pf.description,
              pf.file_size, pf.created_at, pf.project_id, pf.uploaded_by,
              pf.folder_id, pf.category_id,
              f.title AS folder_title,
              fc.name AS category_name,
              p.title AS project_title,
              CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM ${table('project_files')} pf
       LEFT JOIN ${table('projects')} p ON p.id = pf.project_id
       LEFT JOIN ${table('folders')} f ON f.id = pf.folder_id
       LEFT JOIN ${table('file_category')} fc ON fc.id = pf.category_id
       LEFT JOIN ${table('users')} u ON u.id = pf.uploaded_by
       WHERE ${pfConds.join(' AND ')}
       ORDER BY pf.id DESC
       LIMIT ?`,
      [...pfParams, limit]
    );

    const [generalRows] = await pool.query<RowDataPacket[]>(
      `SELECT gf.id, gf.file_name, gf.file_id, gf.service_type, gf.description,
              gf.file_size, gf.created_at, NULL AS project_id, NULL AS project_title,
              gf.uploaded_by, gf.folder_id, 0 AS category_id,
              f.title AS folder_title, NULL AS category_name,
              CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM ${table('general_files')} gf
       LEFT JOIN ${table('folders')} f ON f.id = gf.folder_id
       LEFT JOIN ${table('users')} u ON u.id = gf.uploaded_by
       WHERE ${gfConds.join(' AND ')}
       ORDER BY gf.id DESC
       LIMIT ? OFFSET ?`,
      [...gfParams, limit, offset]
    );

    const combined = [
      ...projectRows.map((r) => this.formatFileRecord(r, 'project')),
      ...generalRows.map((r) => this.formatFileRecord(r, 'general')),
    ].sort((a, b) => {
      const tA = new Date(a.created_at || 0).getTime();
      const tB = new Date(b.created_at || 0).getTime();
      return tB - tA;
    });

    return combined.slice(0, limit);
  }

  async saveUploadedFile(
    file: Express.Multer.File,
    userId: number,
    projectId?: number,
    description?: string,
    folderId = 0,
    categoryId = 0
  ) {
    const folderType = projectId ? 'project_files' : 'general';

    // Try uploading to Google Drive if configured in permana_settings
    const driveResult = await googleDriveService.uploadFile(
      file.path,
      file.filename,
      file.mimetype,
      folderType
    );

    const fileId = driveResult?.file_id || null;
    const serviceType = driveResult?.service_type || null;
    const uploadDocPath = await settingsService.getUploadDocPath();

    // Sync to Docker shared volume root (/var/www/html/files) if present and file wasn't written directly into it
    const sharedDockerRoot = '/var/www/html/files';
    try {
      if (
        fs.existsSync(sharedDockerRoot) &&
        !path.resolve(file.path).startsWith(path.resolve(sharedDockerRoot))
      ) {
        const subFolder = projectId
          ? path.join('project_files', String(projectId))
          : path.join('general', 'global_files', 'all');
        const syncDestDir = path.join(sharedDockerRoot, subFolder);
        if (!fs.existsSync(syncDestDir)) {
          fs.mkdirSync(syncDestDir, { recursive: true });
        }
        fs.copyFileSync(file.path, path.join(syncDestDir, file.filename));
      }
    } catch {
      // ignore cross-sync error
    }

    if (projectId) {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO ${table('project_files')}
         (file_name, file_id, service_type, file_size, description, project_id, uploaded_by, folder_id, category_id, created_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), 0)`,
        [
          file.filename,
          fileId,
          serviceType,
          file.size,
          description || '',
          projectId,
          userId,
          folderId,
          categoryId,
        ]
      );

      return {
        ...this.formatFileRecord(
          {
            id: result.insertId,
            file_name: file.filename,
            file_id: fileId,
            service_type: serviceType,
            file_size: file.size,
            description: description || '',
            project_id: projectId,
            folder_id: folderId,
            category_id: categoryId,
            uploaded_by: userId,
            created_at: new Date().toISOString(),
          },
          'project'
        ),
        upload_doc_path: uploadDocPath,
        storage_path: file.path,
      };
    } else {
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO ${table('general_files')}
         (file_name, file_id, service_type, file_size, description, context, user_id, uploaded_by, folder_id, created_at, deleted)
         VALUES (?, ?, ?, ?, ?, 'global_files', 0, ?, ?, UTC_TIMESTAMP(), 0)`,
        [file.filename, fileId, serviceType, file.size, description || '', userId, folderId]
      );

      return {
        ...this.formatFileRecord(
          {
            id: result.insertId,
            file_name: file.filename,
            file_id: fileId,
            service_type: serviceType,
            file_size: file.size,
            description: description || '',
            project_id: null,
            folder_id: folderId,
            category_id: 0,
            uploaded_by: userId,
            created_at: new Date().toISOString(),
          },
          'general'
        ),
        upload_doc_path: uploadDocPath,
        storage_path: file.path,
      };
    }
  }

  async moveFileToFolder(fileId: number, type: 'project' | 'general', folderId: number) {
    const tbl = type === 'project' ? table('project_files') : table('general_files');
    await pool.query(`UPDATE ${tbl} SET folder_id = ? WHERE id = ?`, [folderId, fileId]);
    return { id: fileId, type, folder_id: folderId };
  }

  async deleteFile(fileId: number, type: 'project' | 'general') {
    const tbl = type === 'project' ? table('project_files') : table('general_files');
    await pool.query(`UPDATE ${tbl} SET deleted = 1 WHERE id = ?`, [fileId]);
    return { id: fileId, type, deleted: true };
  }

  async getFileDownloadTarget(fileId: number, type: 'project' | 'general' = 'project') {
    const dynamicBaseDir = await settingsService.getResolvedUploadBaseDir();
    const envUploadDir = process.env.UPLOAD_DIR ? process.env.UPLOAD_DIR.trim() : '';
    const baseDirs = Array.from(
      new Set(
        [dynamicBaseDir, envUploadDir, '/var/www/html/files', fallbackUploadDir].filter(Boolean)
      )
    );

    if (type === 'project') {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, file_id, service_type, project_id
         FROM ${table('project_files')}
         WHERE id = ? AND deleted = 0`,
        [fileId]
      );
      if (rows.length === 0) throw new Error('File tidak ditemukan');

      const { file_name, file_id, service_type, project_id } = rows[0];
      if (service_type === 'google' && file_id) {
        return {
          redirectUrl: `https://drive.google.com/uc?export=download&id=${file_id}`,
          filePath: null,
          fileName: cleanCiFileName(file_name),
        };
      }

      const candidatePaths: string[] = [];
      for (const dir of baseDirs) {
        candidatePaths.push(
          path.join(dir, 'project_files', String(project_id), file_name),
          path.join(dir, 'project_files', file_name),
          path.join(dir, 'general', 'global_files', 'all', file_name),
          path.join(dir, 'general', file_name),
          path.join(dir, file_name)
        );
      }
      const existingPath = candidatePaths.find((p) => fs.existsSync(p)) || candidatePaths[0];
      return {
        redirectUrl: null,
        filePath: existingPath,
        fileName: cleanCiFileName(file_name),
      };
    } else {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT file_name, file_id, service_type, context, client_id, user_id
         FROM ${table('general_files')}
         WHERE id = ? AND deleted = 0`,
        [fileId]
      );
      if (rows.length === 0) throw new Error('File tidak ditemukan');

      const { file_name, file_id, service_type, context, client_id, user_id } = rows[0];
      if (service_type === 'google' && file_id) {
        return {
          redirectUrl: `https://drive.google.com/uc?export=download&id=${file_id}`,
          filePath: null,
          fileName: cleanCiFileName(file_name),
        };
      }

      const ctx = context || 'global_files';
      const ctxId = String(client_id || user_id || 'all');
      const candidatePaths: string[] = [];
      for (const dir of baseDirs) {
        candidatePaths.push(
          path.join(dir, 'general', 'global_files', 'all', file_name),
          path.join(dir, 'general', ctx, ctxId, file_name),
          path.join(dir, 'general', 'client', String(client_id || 0), file_name),
          path.join(dir, 'general', 'team_member', String(user_id || 0), file_name),
          path.join(dir, 'general', file_name),
          path.join(dir, 'project_files', file_name),
          path.join(dir, 'timeline_files', file_name),
          path.join(dir, 'system', file_name),
          path.join(dir, file_name)
        );
      }
      const existingPath = candidatePaths.find((p) => fs.existsSync(p)) || candidatePaths[0];
      return {
        redirectUrl: null,
        filePath: existingPath,
        fileName: cleanCiFileName(file_name),
      };
    }
  }

  /**
   * Ensures backward compatibility: if files were uploaded directly to files/general/
   * this syncs/copies them to files/general/global_files/all/ so CodeIgniter web app can find them.
   */
  async syncLegacyGeneralFiles() {
    try {
      const baseDir = await settingsService.getResolvedUploadBaseDir();
      const legacyGeneralDir = path.join(baseDir, 'general');
      const ciGeneralDir = path.join(baseDir, 'general', 'global_files', 'all');

      if (!fs.existsSync(legacyGeneralDir)) return;
      if (!fs.existsSync(ciGeneralDir)) {
        fs.mkdirSync(ciGeneralDir, { recursive: true });
      }

      const entries = fs.readdirSync(legacyGeneralDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.startsWith('_file')) {
          const srcFile = path.join(legacyGeneralDir, entry.name);
          const destFile = path.join(ciGeneralDir, entry.name);
          if (!fs.existsSync(destFile)) {
            try {
              fs.copyFileSync(srcFile, destFile);
            } catch {
              // ignore copy error
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
}

export const fileService = new FileService();
