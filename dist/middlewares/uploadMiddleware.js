import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Base upload directory defaults to ../paas/files/
const baseUploadDir = path.resolve(__dirname, '../../../paas/files');
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const projectId = req.body.project_id || req.params.projectId;
        let targetDir = path.join(baseUploadDir, 'general');
        if (projectId) {
            targetDir = path.join(baseUploadDir, 'project_files', String(projectId));
        }
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }
        cb(null, targetDir);
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
