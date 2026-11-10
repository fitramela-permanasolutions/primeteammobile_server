import { Router } from 'express';
import { settingsController } from '../controllers/settingsController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
const router = Router();
// Public endpoint so Login screen & app bootstrap can load logo, title, and theme colors
router.get('/platform', (req, res) => settingsController.getPlatformSettings(req, res));
// Protected endpoint to update platform theme/title settings in DB
router.put('/platform', authMiddleware, (req, res) => settingsController.updatePlatformSettings(req, res));
export default router;
