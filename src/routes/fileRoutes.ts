import { Router } from 'express';
import { fileController } from '../controllers/fileController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { upload } from '../middlewares/uploadMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', (req, res) => fileController.getFiles(req, res));
router.post('/upload', upload.single('file'), (req, res) => fileController.uploadFile(req, res));
router.get('/:id/download', (req, res) => fileController.downloadFile(req, res));

export default router;
