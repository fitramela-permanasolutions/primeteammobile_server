import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Request, Response, NextFunction } from 'express';
import { settingsService } from '../services/settingsService.js';
import { sendError } from '../utils/response.js';

function ensureDirWithPermissions(baseDir: string, subSegments: string[]): string {
  let current = baseDir;
  if (!fs.existsSync(current)) {
    fs.mkdirSync(current, { recursive: true, mode: 0o775 });
  }
  try {
    fs.chmodSync(current, 0o775);
  } catch {
    // ignore chmod error
  }

  for (const seg of subSegments) {
    current = path.join(current, seg);
    if (!fs.existsSync(current)) {
      fs.mkdirSync(current, { recursive: true, mode: 0o775 });
    }
    try {
      fs.chmodSync(current, 0o775);
    } catch {
      // ignore chmod error
    }
  }
  return current;
}

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const baseUploadDir = await settingsService.getResolvedUploadBaseDir();
      const projectId =
        req.body.project_id ||
        req.body.projectId ||
        req.params.projectId ||
        (req.originalUrl?.includes('/projects/') ? req.params.id : undefined) ||
        req.query.projectId ||
        req.query.project_id;
      const isSystemUpload =
        req.originalUrl?.includes('/settings/upload-logo') ||
        req.originalUrl?.includes('/settings/upload-background');
      const isTaskCommentUpload = req.originalUrl?.includes('/tasks/') && req.originalUrl?.includes('/comments');

      let subSegments = ['general', 'global_files', 'all'];
      if (isSystemUpload) {
        subSegments = ['system'];
      } else if (projectId) {
        subSegments = ['project_files', String(projectId)];
      } else if (isTaskCommentUpload) {
        subSegments = ['timeline_files'];
      }

      const targetDir = ensureDirWithPermissions(baseUploadDir, subSegments);
      cb(null, targetDir);
    } catch (err: any) {
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

export async function validateUploadSize(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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
      } catch {
        // ignore cleanup error
      }
      sendError(
        res,
        `Ukuran berkas melebihi batas maksimal ${maxMb} MB yang ditetapkan oleh Admin.`,
        400
      );
      return;
    }
    next();
  } catch {
    next();
  }
}
