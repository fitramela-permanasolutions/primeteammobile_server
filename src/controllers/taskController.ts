import { Response } from 'express';
import { taskService } from '../services/taskService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../types/index.js';
import { canWriteInProject, canManageChecklistItem } from '../utils/rbac.js';

export class TaskController {
  async getStatuses(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const statuses = await taskService.getStatuses();
      sendSuccess(res, statuses, 'Task statuses retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to retrieve statuses', 500);
    }
  }

  async getPriorities(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const priorities = await taskService.getPriorities();
      sendSuccess(res, priorities, 'Task priorities retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to retrieve priorities', 500);
    }
  }

  async getTasks(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }

      const projectId = req.query.projectId ? parseInt(req.query.projectId as string, 10) : undefined;
      const statusId = req.query.statusId ? parseInt(req.query.statusId as string, 10) : undefined;
      const assignedTo = req.query.assignedTo ? parseInt(req.query.assignedTo as string, 10) : undefined;
      const onlyMyTasks = req.query.onlyMyTasks === 'true' || req.query.my === '1';
      const activeOnly = req.query.activeOnly === 'true' || req.query.active === '1';

      const isAdmin = Boolean(req.user.is_admin);
      const tasks = await taskService.getTasks(req.user.id, isAdmin, {
        projectId,
        statusId,
        assignedTo,
        onlyMyTasks,
        activeOnly,
      });

      sendSuccess(res, tasks, 'Tasks retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to retrieve tasks', 500);
    }
  }

  async getTaskById(req: AuthenticatedRequest, res: Response): Promise<void> {
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
    } catch (error: any) {
      sendError(res, error.message || 'Failed to retrieve task', 404);
    }
  }

  async updateStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }
      if (!canWriteInProject(req.user)) {
        sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
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
    } catch (error: any) {
      sendError(res, error.message || 'Failed to update task status', 400);
    }
  }

  async addChecklistItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user || !canWriteInProject(req.user)) {
        sendError(res, 'Akses ditolak: Role Client tidak dapat menambahkan item checklist.', 403);
        return;
      }
      const taskId = parseInt(req.params.id, 10);
      const { title } = req.body;
      if (!title || !String(title).trim()) {
        sendError(res, 'Judul checklist wajib diisi', 400);
        return;
      }
      const created = await taskService.addChecklistItem(taskId, String(title));
      sendSuccess(res, created, 'Checklist item added', 201);
    } catch (error: any) {
      sendError(res, error.message || 'Failed to add checklist item', 500);
    }
  }

  async toggleChecklistItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user || !canWriteInProject(req.user)) {
        sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
        return;
      }
      const itemId = parseInt(req.params.itemId, 10);
      const toggled = await taskService.toggleChecklistItem(itemId);
      sendSuccess(res, toggled, 'Checklist item toggled');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to toggle checklist item', 500);
    }
  }

  async editChecklistItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user || !canManageChecklistItem(req.user)) {
        sendError(
          res,
          'Akses ditolak: Hanya role PIC atau Admin yang dapat mengedit item checklist.',
          403
        );
        return;
      }
      const itemId = parseInt(req.params.itemId, 10);
      const { title } = req.body;
      if (!title || !String(title).trim()) {
        sendError(res, 'Judul checklist wajib diisi', 400);
        return;
      }
      const updated = await taskService.editChecklistItem(itemId, String(title));
      sendSuccess(res, updated, 'Checklist item updated');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to edit checklist item', 400);
    }
  }

  async deleteChecklistItem(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user || !canManageChecklistItem(req.user)) {
        sendError(
          res,
          'Akses ditolak: Hanya role PIC atau Admin yang dapat menghapus item checklist.',
          403
        );
        return;
      }
      const itemId = parseInt(req.params.itemId, 10);
      const deleted = await taskService.deleteChecklistItem(itemId);
      sendSuccess(res, deleted, 'Checklist item deleted');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to delete checklist item', 400);
    }
  }

  async addComment(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }
      if (!canWriteInProject(req.user)) {
        sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
        return;
      }
      const taskId = parseInt(req.params.id, 10);
      const description = String(req.body?.description || '').trim();
      if (!description && !req.file) {
        sendError(res, 'Isi komentar atau lampiran wajib diisi', 400);
        return;
      }
      const comment = await taskService.addTaskComment(taskId, req.user.id, description, req.file);
      sendSuccess(res, comment, 'Comment added', 201);
    } catch (error: any) {
      sendError(res, error.message || 'Failed to add comment', 500);
    }
  }
}

export const taskController = new TaskController();
