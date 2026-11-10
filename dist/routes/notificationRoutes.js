import { Router } from 'express';
import { notificationController } from '../controllers/notificationController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
const router = Router();
router.use(authMiddleware);
router.get('/', (req, res) => notificationController.getNotifications(req, res));
router.patch('/:id/read', (req, res) => notificationController.markAsRead(req, res));
router.post('/mark-all-read', (req, res) => notificationController.markAllAsRead(req, res));
export default router;
