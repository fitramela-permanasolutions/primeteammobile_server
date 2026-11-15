import { fileService } from '../services/fileService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import fs from 'fs';
export class FileController {
    async getFiles(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : undefined;
            const folderId = req.query.folderId !== undefined ? parseInt(req.query.folderId, 10) : undefined;
            const categoryId = req.query.categoryId ? parseInt(req.query.categoryId, 10) : undefined;
            const search = req.query.search;
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 40;
            const isAdmin = Boolean(req.user.is_admin);
            const files = await fileService.getFiles(req.user.id, isAdmin, projectId, page, limit, folderId, categoryId, search);
            sendSuccess(res, files, 'Files retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve files', 500);
        }
    }
    async getFolders(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const parentId = req.query.parentId !== undefined ? parseInt(req.query.parentId, 10) : undefined;
            const context = req.query.context || 'all';
            const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : undefined;
            const folders = await fileService.getFolders(req.user.id, {
                parentId,
                context,
                projectId,
            });
            sendSuccess(res, folders, 'Folders retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve folders', 500);
        }
    }
    async createFolder(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { title, parent_id, context, project_id, permissions } = req.body;
            if (!title || !String(title).trim()) {
                sendError(res, 'Nama folder wajib diisi', 400);
                return;
            }
            const created = await fileService.createFolder(req.user.id, {
                title: String(title),
                parentId: parent_id ? Number(parent_id) : 0,
                context: context || (project_id ? 'project' : 'file_manager'),
                projectId: project_id ? Number(project_id) : undefined,
                permissions,
            });
            sendSuccess(res, created, 'Folder created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create folder', 500);
        }
    }
    async toggleStarFolder(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const folderId = parseInt(req.params.id, 10);
            const updated = await fileService.toggleStarFolder(req.user.id, folderId);
            sendSuccess(res, updated, 'Folder star updated');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to update folder star', 500);
        }
    }
    async deleteFolder(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const folderId = parseInt(req.params.id, 10);
            const deleted = await fileService.deleteFolder(folderId);
            sendSuccess(res, deleted, 'Folder deleted');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to delete folder', 500);
        }
    }
    async getCategories(req, res) {
        try {
            const type = req.query.type || 'all';
            const categories = await fileService.getFileCategories(type);
            sendSuccess(res, categories, 'File categories retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve file categories', 500);
        }
    }
    async uploadFile(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            if (!req.file) {
                sendError(res, 'No file uploaded', 400);
                return;
            }
            const rawProjectId = req.body.project_id ?? req.body.projectId;
            const rawFolderId = req.body.folder_id ?? req.body.folderId;
            const rawCategoryId = req.body.category_id ?? req.body.categoryId;
            const projectId = rawProjectId ? parseInt(String(rawProjectId), 10) : undefined;
            const folderId = rawFolderId ? parseInt(String(rawFolderId), 10) : 0;
            const categoryId = rawCategoryId ? parseInt(String(rawCategoryId), 10) : 0;
            const description = req.body.description;
            const saved = await fileService.saveUploadedFile(req.file, req.user.id, projectId, description, folderId, categoryId);
            sendSuccess(res, saved, 'File uploaded successfully', 201);
        }
        catch (error) {
            sendError(res, error.message || 'File upload failed', 500);
        }
    }
    async moveFile(req, res) {
        try {
            const fileId = parseInt(req.params.id, 10);
            const { type = 'general', folder_id = 0 } = req.body;
            const moved = await fileService.moveFileToFolder(fileId, type, Number(folder_id));
            sendSuccess(res, moved, 'File moved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to move file', 500);
        }
    }
    async deleteFile(req, res) {
        try {
            const fileId = parseInt(req.params.id, 10);
            const type = (req.query.type || 'general');
            const deleted = await fileService.deleteFile(fileId, type);
            sendSuccess(res, deleted, 'File deleted');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to delete file', 500);
        }
    }
    renderDownloadErrorHtml(res, message, status = 404) {
        const safeMsg = String(message || 'Berkas tidak ditemukan di penyimpanan server')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        res.status(status).type('html').send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Berkas Tidak Ditemukan</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; box-sizing: border-box; }
    .card { max-width: 420px; width: 100%; background: #ffffff; border-radius: 16px; padding: 28px 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); text-align: center; border: 1px solid #e2e8f0; }
    .icon { width: 56px; height: 56px; border-radius: 16px; background: #fef2f2; color: #ef4444; display: inline-flex; align-items: center; justify-content: center; font-size: 28px; margin-bottom: 16px; }
    h1 { font-size: 18px; margin: 0 0 8px; color: #0f172a; }
    p { font-size: 14px; color: #64748b; line-height: 1.5; margin: 0 0 22px; }
    button { background: #00628d; color: #ffffff; border: none; border-radius: 10px; padding: 12px 20px; font-size: 14px; font-weight: 600; cursor: pointer; width: 100%; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#128196;</div>
    <h1>Berkas Tidak Tersedia</h1>
    <p>${safeMsg}</p>
    <button onclick="window.close(); history.back();">Kembali ke Aplikasi</button>
  </div>
</body>
</html>`);
    }
    async downloadFile(req, res) {
        const isCheck = req.query.check === '1' || req.query.check === 'true';
        const isInline = req.query.inline === '1' || req.query.inline === 'true';
        try {
            const fileId = parseInt(req.params.id, 10);
            const type = req.query.type || 'general';
            if (isNaN(fileId)) {
                if (isCheck)
                    sendError(res, 'ID berkas tidak valid', 400);
                else
                    this.renderDownloadErrorHtml(res, 'ID berkas tidak valid.', 400);
                return;
            }
            const target = await fileService.getFileDownloadTarget(fileId, type);
            if (isCheck) {
                if (target.redirectUrl) {
                    sendSuccess(res, { exists: true, fileName: target.fileName, redirectUrl: target.redirectUrl }, 'File ready');
                    return;
                }
                if (target.filePath && fs.existsSync(target.filePath)) {
                    sendSuccess(res, { exists: true, fileName: target.fileName }, 'File ready');
                    return;
                }
                sendError(res, 'Berkas fisik tidak ditemukan di penyimpanan server', 404);
                return;
            }
            if (target.redirectUrl) {
                res.redirect(target.redirectUrl);
                return;
            }
            if (!target.filePath || !fs.existsSync(target.filePath)) {
                this.renderDownloadErrorHtml(res, 'Berkas fisik tidak ditemukan di penyimpanan server. Pastikan volume/direktori penyimpanan server & web tersinkronisasi.', 404);
                return;
            }
            if (isInline) {
                res.sendFile(target.filePath);
                return;
            }
            res.download(target.filePath, target.fileName);
        }
        catch (error) {
            if (isCheck) {
                sendError(res, error.message || 'Berkas tidak ditemukan', 404);
            }
            else {
                this.renderDownloadErrorHtml(res, error.message || 'Gagal mengunduh berkas dari server.', 404);
            }
        }
    }
}
export const fileController = new FileController();
