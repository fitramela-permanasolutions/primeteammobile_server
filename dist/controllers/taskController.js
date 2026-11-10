import { taskService } from '../services/taskService.js';
import { sendSuccess, sendError } from '../utils/response.js';
export class TaskController {
    async getStatuses(req, res) {
        try {
            const statuses = await taskService.getStatuses();
            sendSuccess(res, statuses, 'Task statuses retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve statuses', 500);
        }
    }
    async getTasks(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : undefined;
            const statusId = req.query.statusId ? parseInt(req.query.statusId, 10) : undefined;
            const assignedTo = req.query.assignedTo ? parseInt(req.query.assignedTo, 10) : undefined;
            const onlyMyTasks = req.query.onlyMyTasks === 'true' || req.query.my === '1';
            const isAdmin = Boolean(req.user.is_admin);
            const tasks = await taskService.getTasks(req.user.id, isAdmin, {
                projectId,
                statusId,
                assignedTo,
                onlyMyTasks,
            });
            sendSuccess(res, tasks, 'Tasks retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve tasks', 500);
        }
    }
    async getTaskById(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const taskId = parseInt(req.params.id, 10);
            if (isNaN(taskId)) {
                sendError(res, 'Invalid task ID', 400);
                return;
            }
            const isAdmin = Boolean(req.user.is_admin);
            const task = await taskService.getTaskById(taskId, req.user.id, isAdmin);
            sendSuccess(res, task, 'Task retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve task', 404);
        }
    }
    async updateStatus(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const taskId = parseInt(req.params.id, 10);
            const { statusId } = req.body;
            if (isNaN(taskId) || !statusId) {
                sendError(res, 'Task ID and statusId are required', 400);
                return;
            }
            const updated = await taskService.updateTaskStatus(taskId, parseInt(statusId, 10), req.user.id);
            sendSuccess(res, updated, 'Task status updated');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to update task status', 400);
        }
    }
}
export const taskController = new TaskController();
