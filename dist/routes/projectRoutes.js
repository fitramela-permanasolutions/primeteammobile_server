import { Router } from 'express';
import { projectController } from '../controllers/projectController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { upload, validateUploadSize } from '../middlewares/uploadMiddleware.js';
const router = Router();
router.use(authMiddleware);
router.get('/', (req, res) => projectController.getProjects(req, res));
router.get('/:id', (req, res) => projectController.getProjectById(req, res));
// Isolated Project Comments & File Uploads
router.get('/:id/comments', (req, res) => projectController.getProjectComments(req, res));
router.post('/:id/comments', upload.single('file'), validateUploadSize, (req, res) => projectController.addProjectComment(req, res));
router.delete('/:id/comments/:commentId', (req, res) => projectController.deleteProjectComment(req, res));
router.get('/:id/files', (req, res) => projectController.getProjectFiles(req, res));
router.post('/:id/files', upload.single('file'), validateUploadSize, (req, res) => projectController.uploadProjectFile(req, res));
router.delete('/:id/files/:fileId', (req, res) => projectController.deleteProjectFile(req, res));
// Realtime Group Chat per Project
router.get('/:id/chat', (req, res) => projectController.getProjectChat(req, res));
router.post('/:id/chat', upload.single('file'), validateUploadSize, (req, res) => projectController.sendProjectChat(req, res));
export default router;
