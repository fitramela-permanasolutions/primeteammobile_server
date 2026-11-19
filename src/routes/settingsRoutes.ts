import { Router } from 'express';
import { settingsController } from '../controllers/settingsController.js';
import { authMiddleware, adminMiddleware } from '../middlewares/authMiddleware.js';
import { upload } from '../middlewares/uploadMiddleware.js';

const router = Router();

// Public endpoint so Login screen & app bootstrap can load logo, title, and theme colors
router.get('/platform', (req, res) => settingsController.getPlatformSettings(req, res));

// Admin/Superadmin protected endpoints to update technical platform settings in DB
router.get('/admin-secrets', authMiddleware, adminMiddleware, (req, res) =>
  settingsController.getAdminSecrets(req, res)
);

router.put('/platform', authMiddleware, adminMiddleware, (req, res) =>
  settingsController.updatePlatformSettings(req, res)
);

router.put('/upload-path', authMiddleware, adminMiddleware, (req, res) =>
  settingsController.updateUploadDocPath(req, res)
);

router.post(
  '/upload-logo',
  authMiddleware,
  adminMiddleware,
  upload.single('file'),
  (req, res) => settingsController.uploadLogo(req, res)
);

router.post(
  '/upload-background',
  authMiddleware,
  adminMiddleware,
  upload.single('file'),
  (req, res) => settingsController.uploadSigninBackground(req, res)
);

export default router;
