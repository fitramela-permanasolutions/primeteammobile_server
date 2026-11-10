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
        // Generate safe filename matching CI style: timestamp-random-cleaned_name
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, `${uniqueSuffix}_${sanitizedName}`);
    },
});
export const upload = multer({
    storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25 MB max limit
    },
});
