import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { settingsService } from '../services/settingsService.js';
import { sendError } from '../utils/response.js';
function ensureDirWithPermissions(baseDir, subSegments) {
    let current = baseDir;
    if (!fs.existsSync(current)) {
        fs.mkdirSync(current, { recursive: true, mode: 0o775 });
    }
    try {
        fs.chmodSync(current, 0o775);
    }
    catch {
        // ignore chmod error
    }
    for (const seg of subSegments) {
        current = path.join(current, seg);
        if (!fs.existsSync(current)) {
            fs.mkdirSync(current, { recursive: true, mode: 0o775 });
        }
        try {
            fs.chmodSync(current, 0o775);
        }
        catch {
            // ignore chmod error
        }
    }
    return current;
}
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const baseUploadDir = await settingsService.getResolvedUploadBaseDir();
            const projectId = req.body.project_id ||
                req.body.projectId ||
                req.params.projectId ||
                (req.originalUrl?.includes('/projects/') ? req.params.id : undefined) ||
                req.query.projectId ||
                req.query.project_id;
            const isSystemUpload = req.originalUrl?.includes('/settings/upload-logo') ||
                req.originalUrl?.includes('/settings/upload-background');
            // In PAAS (CodeIgniter 4), ALL project_comments & task_comments attachments live in files/timeline_files/
            const isCommentUpload = (req.originalUrl?.includes('/tasks/') && req.originalUrl?.includes('/comments')) ||
                (req.originalUrl?.includes('/projects/') && req.originalUrl?.includes('/comments'));
            let subSegments = ['general', 'global_files', 'all'];
            if (isSystemUpload) {
                subSegments = ['system'];
            }
            else if (isCommentUpload) {
                subSegments = ['timeline_files'];
            }
            else if (projectId) {
                subSegments = ['project_files', String(projectId)];
            }
            const targetDir = ensureDirWithPermissions(baseUploadDir, subSegments);
            cb(null, targetDir);
        }
        catch (err) {
            cb(err, '');
        }
    },
    filename: (req, file, cb) => {
        // Generate filename matching CodeIgniter 4 move_temp_file() convention: _file<hex>-<sanitized_name>
        const uniqHex = Date.now().toString(16) + Math.floor(Math.random() * 0xfff).toString(16);
        const sanitizedName = file.originalname
            .replace(/\s+/g, '-')
            .replace(/['’()]/g, '-')
            .replace(/[^a-zA-Z0-9._-]/g, '');
        cb(null, `_file${uniqHex}-${sanitizedName}`);
    },
});
export const upload = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024, // Hard cap 500 MB; dynamic admin max_upload_size enforced by validateUploadSize
    },
});
export async function validateUploadSize(req, res, next) {
    try {
        if (!req.file) {
            next();
            return;
        }
        const maxBytes = await settingsService.getMaxUploadSizeBytes();
        if (req.file.size > maxBytes) {
            const maxMb = Math.round(maxBytes / (1024 * 1024));
            try {
                if (req.file.path && fs.existsSync(req.file.path)) {
                    fs.unlinkSync(req.file.path);
                }
            }
            catch {
                // ignore cleanup error
            }
            sendError(res, `Ukuran berkas melebihi batas maksimal ${maxMb} MB yang ditetapkan oleh Admin.`, 400);
            return;
        }
        // Ensure uploaded file is world/group-readable (0664) so PAAS (Apache www-data) can always preview it
        try {
            if (req.file.path && fs.existsSync(req.file.path)) {
                fs.chmodSync(req.file.path, 0o664);
            }
        }
        catch {
            // ignore chmod errors on Windows
        }
        next();
    }
    catch {
        next();
    }
}
