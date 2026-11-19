import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authMiddleware, adminMiddleware } from '../middlewares/authMiddleware.js';
const router = Router();
router.post('/login', (req, res) => authController.login(req, res));
router.post('/google', (req, res) => authController.googleLogin(req, res));
router.get('/google/callback', (req, res) => authController.googleOAuthCallback(req, res));
router.get('/me', authMiddleware, (req, res) => authController.me(req, res));
router.post('/change-password', authMiddleware, (req, res) => authController.changePassword(req, res));
router.post('/logout', authMiddleware, (req, res) => authController.logout(req, res));
// Admin Mobile Session & Device Management
router.get('/sessions', authMiddleware, adminMiddleware, (req, res) => authController.getSessions(req, res));
router.delete('/sessions/:sessionId', authMiddleware, adminMiddleware, (req, res) => authController.revokeSession(req, res));
export default router;
