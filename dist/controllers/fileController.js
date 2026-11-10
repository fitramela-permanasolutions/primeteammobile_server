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
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 20;
            const isAdmin = Boolean(req.user.is_admin);
            const files = await fileService.getFiles(req.user.id, isAdmin, projectId, page, limit);
            sendSuccess(res, files, 'Files retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve files', 500);
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
            const projectId = req.body.project_id ? parseInt(req.body.project_id, 10) : undefined;
            const description = req.body.description;
            const saved = await fileService.saveUploadedFile(req.file, req.user.id, projectId, description);
            sendSuccess(res, saved, 'File uploaded successfully', 201);
        }
        catch (error) {
            sendError(res, error.message || 'File upload failed', 500);
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
            const { filePath, fileName } = await fileService.getFilePath(fileId, type);
            if (!fs.existsSync(filePath)) {
                sendError(res, 'File does not exist on disk', 404);
                return;
            }
            res.download(filePath, fileName);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to download file', 404);
        }
    }
}
export const fileController = new FileController();
