import { Router } from 'express';
import { fileController } from '../controllers/fileController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { upload } from '../middlewares/uploadMiddleware.js';
const router = Router();
// Direct download & inline preview endpoint (placed before authMiddleware so browsers & image viewers never hit 401 JSON)
router.get('/:id/download', (req, res) => fileController.downloadFile(req, res));
router.use(authMiddleware);
router.get('/', (req, res) => fileController.getFiles(req, res));
router.get('/folders', (req, res) => fileController.getFolders(req, res));
router.post('/folders', (req, res) => fileController.createFolder(req, res));
router.post('/folders/:id/star', (req, res) => fileController.toggleStarFolder(req, res));
router.delete('/folders/:id', (req, res) => fileController.deleteFolder(req, res));
router.get('/categories', (req, res) => fileController.getCategories(req, res));
router.post('/upload', upload.single('file'), (req, res) => fileController.uploadFile(req, res));
router.patch('/:id/move', (req, res) => fileController.moveFile(req, res));
router.delete('/:id', (req, res) => fileController.deleteFile(req, res));
export default router;
