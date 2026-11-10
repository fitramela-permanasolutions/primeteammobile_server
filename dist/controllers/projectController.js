import { projectService } from '../services/projectService.js';
import { sendSuccess, sendError } from '../utils/response.js';
export class ProjectController {
    async getProjects(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const status = req.query.status;
            const isAdmin = Boolean(req.user.is_admin);
            const projects = await projectService.getProjects(req.user.id, isAdmin, status);
            sendSuccess(res, projects, 'Projects retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve projects', 500);
        }
    }
    async getProjectById(req, res) {
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
            const isAdmin = Boolean(req.user.is_admin);
            const project = await projectService.getProjectById(projectId, req.user.id, isAdmin);
            sendSuccess(res, project, 'Project retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve project', 404);
        }
    }
}
export const projectController = new ProjectController();
