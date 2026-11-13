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
    async downloadFile(req, res) {
        try {
            const fileId = parseInt(req.params.id, 10);
            const type = req.query.type || 'project';
            if (isNaN(fileId)) {
                sendError(res, 'Invalid file ID', 400);
                return;
            }
            const target = await fileService.getFileDownloadTarget(fileId, type);
            if (target.redirectUrl) {
                res.redirect(target.redirectUrl);
                return;
            }
            if (!target.filePath || !fs.existsSync(target.filePath)) {
                sendError(res, 'File tidak ditemukan di penyimpanan server', 404);
                return;
            }
            res.download(target.filePath, target.fileName);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to download file', 404);
        }
    }
}
export const fileController = new FileController();
