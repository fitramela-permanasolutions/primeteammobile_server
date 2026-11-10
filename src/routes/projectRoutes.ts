import { Router } from 'express';
import { projectController } from '../controllers/projectController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/', (req, res) => projectController.getProjects(req, res));
router.get('/:id', (req, res) => projectController.getProjectById(req, res));

export default router;
