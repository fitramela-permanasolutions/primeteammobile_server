import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { settingsService } from '../services/settingsService.js';
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const baseUploadDir = await settingsService.getResolvedUploadBaseDir();
            const projectId = req.body.project_id || req.body.projectId || req.params.projectId;
            const isSystemUpload = req.originalUrl?.includes('/settings/upload-logo') ||
                req.originalUrl?.includes('/settings/upload-background');
            let targetDir = path.join(baseUploadDir, 'general', 'global_files', 'all');
            if (isSystemUpload) {
                targetDir = path.join(baseUploadDir, 'system');
            }
            else if (projectId) {
                targetDir = path.join(baseUploadDir, 'project_files', String(projectId));
            }
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }
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
        fileSize: 25 * 1024 * 1024, // 25 MB max limit
    },
});
