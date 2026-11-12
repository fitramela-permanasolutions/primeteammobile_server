import { Router } from 'express';
import { workspaceController } from '../controllers/workspaceController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/banners-announcements', (req, res) =>
  workspaceController.getBannersAndAnnouncements(req, res)
);
router.get('/leave-types', (req, res) => workspaceController.getLeaveTypes(req, res));
router.get('/leaves', (req, res) => workspaceController.getLeaves(req, res));
router.post('/leaves', (req, res) => workspaceController.createLeave(req, res));
router.get('/events', (req, res) => workspaceController.getEvents(req, res));
router.post('/events', (req, res) => workspaceController.createEvent(req, res));
router.get('/notes', (req, res) => workspaceController.getNotes(req, res));
router.post('/notes', (req, res) => workspaceController.createNote(req, res));
router.delete('/notes/:id', (req, res) => workspaceController.deleteNote(req, res));
router.get('/todos', (req, res) => workspaceController.getTodos(req, res));
router.post('/todos', (req, res) => workspaceController.createTodo(req, res));
router.patch('/todos/:id/toggle', (req, res) => workspaceController.toggleTodo(req, res));
router.get('/tickets', (req, res) => workspaceController.getTickets(req, res));
router.get('/tickets/:id', (req, res) => workspaceController.getTicketById(req, res));
router.post('/tickets', (req, res) => workspaceController.createTicket(req, res));

export default router;
