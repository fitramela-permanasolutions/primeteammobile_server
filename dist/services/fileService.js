import { pool, table } from '../config/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { cleanCiFileName, isImageFileName, resolveCiFile, stripHtml, toIsoUtc, } from '../utils/ciHelpers.js';
import { googleDriveService } from './googleDriveService.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseUploadDir = path.resolve(__dirname, '../../../paas/files');
export class FileService {
    formatFileRecord(r, type) {
        const folderPath = type === 'project'
            ? r.project_id
                ? `project_files/${r.project_id}`
                : 'project_files'
            : 'general';
        const resolved = resolveCiFile({
            file_name: r.file_name,
            file_id: r.file_id,
            service_type: r.service_type,
        }, folderPath, false);
        const sizeBytes = Number(r.file_size) || 0;
        const sizeFormatted = sizeBytes >= 1024 * 1024
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
            download_url: r.service_type === 'google' && r.file_id
                ? `https://drive.google.com/uc?export=download&id=${r.file_id}`
                : `/api/v1/files/${r.id}/download?type=${type}`,
            description: stripHtml(r.description),
            file_size: sizeBytes,
            file_size_formatted: sizeFormatted,
            created_at: toIsoUtc(r.created_at) || r.created_at,
            project_id: r.project_id || null,
            project_title: r.project_title || (type === 'general' ? 'Dokumen Umum' : null),
            uploaded_by: r.uploaded_by,
            uploaded_by_name: r.uploaded_by_name?.trim() || 'System',
            type,
        };
    }
    async getFiles(userId, isAdmin, projectId, page = 1, limit = 30) {
        const offset = (page - 1) * limit;
        if (projectId) {
            const [rows] = await pool.query(`SELECT pf.id, pf.file_name, pf.file_id, pf.service_type, pf.description,
                pf.file_size, pf.created_at, pf.project_id, pf.uploaded_by,
                p.title AS project_title,
                CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
         FROM ${table('project_files')} pf
         LEFT JOIN ${table('projects')} p ON p.id = pf.project_id
         LEFT JOIN ${table('users')} u ON u.id = pf.uploaded_by
         WHERE pf.project_id = ? AND pf.deleted = 0
         ORDER BY pf.id DESC
         LIMIT ? OFFSET ?`, [projectId, limit, offset]);
            return rows.map((r) => this.formatFileRecord(r, 'project'));
        }
        // Fetch both project_files and general_files
        const [projectRows] = await pool.query(`SELECT pf.id, pf.file_name, pf.file_id, pf.service_type, pf.description,
              pf.file_size, pf.created_at, pf.project_id, pf.uploaded_by,
              p.title AS project_title,
              CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM ${table('project_files')} pf
       LEFT JOIN ${table('projects')} p ON p.id = pf.project_id
       LEFT JOIN ${table('users')} u ON u.id = pf.uploaded_by
       WHERE pf.deleted = 0
       ORDER BY pf.id DESC
       LIMIT ?`, [limit]);
        const [generalRows] = await pool.query(`SELECT gf.id, gf.file_name, gf.file_id, gf.service_type, gf.description,
              gf.file_size, gf.created_at, NULL AS project_id, NULL AS project_title,
              gf.uploaded_by,
              CONCAT(u.first_name, ' ', u.last_name) AS uploaded_by_name
       FROM ${table('general_files')} gf
       LEFT JOIN ${table('users')} u ON u.id = gf.uploaded_by
       WHERE gf.deleted = 0
       ORDER BY gf.id DESC
       LIMIT ? OFFSET ?`, [limit, offset]);
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
    async saveUploadedFile(file, userId, projectId, description) {
        const folderType = projectId ? 'project_files' : 'general';
        // Try uploading to Google Drive if configured in permana_settings
        const driveResult = await googleDriveService.uploadFile(file.path, file.filename, file.mimetype, folderType);
        const fileId = driveResult?.file_id || null;
        const serviceType = driveResult?.service_type || null;
        if (projectId) {
            const [result] = await pool.query(`INSERT INTO ${table('project_files')}
         (file_name, file_id, service_type, file_size, description, project_id, uploaded_by, created_at, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), 0)`, [file.filename, fileId, serviceType, file.size, description || '', projectId, userId]);
            return this.formatFileRecord({
                id: result.insertId,
                file_name: file.filename,
                file_id: fileId,
                service_type: serviceType,
                file_size: file.size,
                description: description || '',
                project_id: projectId,
                uploaded_by: userId,
                created_at: new Date().toISOString(),
            }, 'project');
        }
        else {
            const [result] = await pool.query(`INSERT INTO ${table('general_files')}
         (file_name, file_id, service_type, file_size, description, context, user_id, uploaded_by, created_at, deleted)
         VALUES (?, ?, ?, ?, ?, 'global_files', 0, ?, UTC_TIMESTAMP(), 0)`, [file.filename, fileId, serviceType, file.size, description || '', userId]);
            return this.formatFileRecord({
                id: result.insertId,
                file_name: file.filename,
                file_id: fileId,
                service_type: serviceType,
                file_size: file.size,
                description: description || '',
                project_id: null,
                uploaded_by: userId,
                created_at: new Date().toISOString(),
            }, 'general');
        }
    }
    async getFileDownloadTarget(fileId, type = 'project') {
        if (type === 'project') {
            const [rows] = await pool.query(`SELECT file_name, file_id, service_type, project_id
         FROM ${table('project_files')}
         WHERE id = ? AND deleted = 0`, [fileId]);
            if (rows.length === 0)
                throw new Error('File tidak ditemukan');
            const { file_name, file_id, service_type, project_id } = rows[0];
            if (service_type === 'google' && file_id) {
                return {
                    redirectUrl: `https://drive.google.com/uc?export=download&id=${file_id}`,
                    filePath: null,
                    fileName: cleanCiFileName(file_name),
                };
            }
            const candidatePaths = [
                path.join(baseUploadDir, 'project_files', String(project_id), file_name),
                path.join(baseUploadDir, 'project_files', file_name),
                path.join(baseUploadDir, 'general', file_name),
            ];
            const existingPath = candidatePaths.find((p) => fs.existsSync(p)) || candidatePaths[0];
            return {
                redirectUrl: null,
                filePath: existingPath,
                fileName: cleanCiFileName(file_name),
            };
        }
        else {
            const [rows] = await pool.query(`SELECT file_name, file_id, service_type
         FROM ${table('general_files')}
         WHERE id = ? AND deleted = 0`, [fileId]);
            if (rows.length === 0)
                throw new Error('File tidak ditemukan');
            const { file_name, file_id, service_type } = rows[0];
            if (service_type === 'google' && file_id) {
                return {
                    redirectUrl: `https://drive.google.com/uc?export=download&id=${file_id}`,
                    filePath: null,
                    fileName: cleanCiFileName(file_name),
                };
            }
            const candidatePaths = [
                path.join(baseUploadDir, 'general', file_name),
                path.join(baseUploadDir, 'timeline_files', file_name),
                path.join(baseUploadDir, 'system', file_name),
            ];
            const existingPath = candidatePaths.find((p) => fs.existsSync(p)) || candidatePaths[0];
            return {
                redirectUrl: null,
                filePath: existingPath,
                fileName: cleanCiFileName(file_name),
            };
        }
    }
}
export const fileService = new FileService();
