import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { settingsService } from '../services/settingsService.js';
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
                req.query.projectId ||
                req.query.project_id;
            const isSystemUpload = req.originalUrl?.includes('/settings/upload-logo') ||
                req.originalUrl?.includes('/settings/upload-background');
            let subSegments = ['general', 'global_files', 'all'];
            if (isSystemUpload) {
                subSegments = ['system'];
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
        fileSize: 25 * 1024 * 1024, // 25 MB max limit
    },
});
