import { Router } from 'express';
import { taskController } from '../controllers/taskController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/statuses', (req, res) => taskController.getStatuses(req, res));
router.get('/priorities', (req, res) => taskController.getPriorities(req, res));
router.get('/', (req, res) => taskController.getTasks(req, res));
router.get('/:id', (req, res) => taskController.getTaskById(req, res));
router.patch('/:id/status', (req, res) => taskController.updateStatus(req, res));
router.post('/:id/checklist', (req, res) => taskController.addChecklistItem(req, res));
router.patch('/checklist/:itemId/toggle', (req, res) => taskController.toggleChecklistItem(req, res));
router.post('/:id/comments', (req, res) => taskController.addComment(req, res));

export default router;
