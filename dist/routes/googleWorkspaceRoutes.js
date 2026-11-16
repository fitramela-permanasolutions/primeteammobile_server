import { Router } from 'express';
import { googleWorkspaceController } from '../controllers/googleWorkspaceController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
const router = Router();
// Public OAuth browser redirect & callback routes
router.get('/oauth/url', (req, res) => googleWorkspaceController.getOAuthUrl(req, res));
router.get('/oauth/callback', (req, res) => googleWorkspaceController.handleOAuthCallback(req, res));
// Protected Google Workspace routes
router.use(authMiddleware);
router.get('/status', (req, res) => googleWorkspaceController.getStatus(req, res));
router.get('/docs', (req, res) => googleWorkspaceController.getDocs(req, res));
router.post('/docs', (req, res) => googleWorkspaceController.createDoc(req, res));
router.patch('/docs/:id', (req, res) => googleWorkspaceController.updateDoc(req, res));
router.get('/sheets', (req, res) => googleWorkspaceController.getSheets(req, res));
router.post('/sheets', (req, res) => googleWorkspaceController.createSheet(req, res));
router.patch('/sheets/:id', (req, res) => googleWorkspaceController.updateSheet(req, res));
router.get('/meets', (req, res) => googleWorkspaceController.getMeets(req, res));
router.post('/meets', (req, res) => googleWorkspaceController.createMeet(req, res));
export default router;
