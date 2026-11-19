import { Router } from 'express';
import { taskController } from '../controllers/taskController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { upload, validateUploadSize } from '../middlewares/uploadMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/statuses', (req, res) => taskController.getStatuses(req, res));
router.get('/priorities', (req, res) => taskController.getPriorities(req, res));
router.get('/', (req, res) => taskController.getTasks(req, res));
router.get('/:id', (req, res) => taskController.getTaskById(req, res));
router.put('/:id', (req, res) => taskController.updateTask(req, res));
router.delete('/:id', (req, res) => taskController.deleteTask(req, res));
router.patch('/:id/status', (req, res) => taskController.updateStatus(req, res));
router.post('/:id/checklist', (req, res) => taskController.addChecklistItem(req, res));
router.post('/:id/checklists', (req, res) => taskController.addChecklistItem(req, res));
router.patch('/checklist/:itemId/toggle', (req, res) => taskController.toggleChecklistItem(req, res));
router.patch('/checklists/:itemId/toggle', (req, res) => taskController.toggleChecklistItem(req, res));
router.put('/checklist/:itemId', (req, res) => taskController.editChecklistItem(req, res));
router.put('/checklists/:itemId', (req, res) => taskController.editChecklistItem(req, res));
router.delete('/checklist/:itemId', (req, res) => taskController.deleteChecklistItem(req, res));
router.delete('/checklists/:itemId', (req, res) => taskController.deleteChecklistItem(req, res));
router.post('/:id/comments', upload.single('file'), validateUploadSize, (req, res) =>
  taskController.addComment(req, res)
);
router.put('/:id/comments/:commentId', (req, res) => taskController.editComment(req, res));
router.delete('/:id/comments/:commentId', (req, res) => taskController.deleteComment(req, res));

export default router;
