import { Response } from 'express';
import { projectService } from '../services/projectService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../types/index.js';
import { isAdminOrSuperAdmin } from '../utils/rbac.js';

export class ProjectController {
  async getProjects(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }

      const status = req.query.status as string | undefined;
      const isAdmin = isAdminOrSuperAdmin(req.user);
      const onlyMyProjects =
        req.query.allProjects === 'true' && isAdmin ? false : true;

      const projects = await projectService.getProjects(
        req.user.id,
        isAdmin,
        status,
        onlyMyProjects
      );
      sendSuccess(res, projects, 'Projects retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to retrieve projects', 500);
    }
  }

  async getProjectById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }

      const projectId = parseInt(req.params.id, 10);
      if (isNaN(projectId)) {
        sendError(res, 'Invalid project ID', 400);
        return;
      }

      const isAdmin = isAdminOrSuperAdmin(req.user);
      const project = await projectService.getProjectById(projectId, req.user.id, isAdmin);
      sendSuccess(res, project, 'Project retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to retrieve project', 404);
    }
  }
}

export const projectController = new ProjectController();
