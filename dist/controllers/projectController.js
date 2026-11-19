import { projectService } from '../services/projectService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isAdminOrSuperAdmin, canWriteInProject, isPicRole } from '../utils/rbac.js';
export class ProjectController {
    async getProjects(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const status = req.query.status;
            const isAdmin = isAdminOrSuperAdmin(req.user);
            // Admin/Superadmin sees all projects by default; Non-Admin only sees projects where they are a member
            const onlyMyProjects = isAdmin ? req.query.onlyMyProjects === 'true' : true;
            const projects = await projectService.getProjects(req.user.id, isAdmin, status, onlyMyProjects);
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
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const project = await projectService.getProjectById(projectId, req.user.id, isAdmin);
            sendSuccess(res, project, 'Project retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve project', 404);
        }
    }
    async getProjectComments(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const comments = await projectService.getProjectComments(projectId, req.user.id, isAdmin);
            sendSuccess(res, comments, 'Project comments retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal memuat komentar project', 403);
        }
    }
    async addProjectComment(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            if (!canWriteInProject(req.user)) {
                sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const description = String(req.body?.description || '').trim();
            if (!description && !req.file) {
                sendError(res, 'Komentar atau lampiran berkas wajib diisi', 400);
                return;
            }
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const created = await projectService.addProjectComment(projectId, req.user.id, isAdmin, description, req.file);
            sendSuccess(res, created, 'Komentar berhasil ditambahkan', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Gagal menambahkan komentar project', 400);
        }
    }
    async getProjectFiles(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const files = await projectService.getProjectFiles(projectId, req.user.id, isAdmin);
            sendSuccess(res, files, 'Project files retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal memuat berkas project', 403);
        }
    }
    async uploadProjectFile(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            if (!canWriteInProject(req.user)) {
                sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
                return;
            }
            if (!req.file) {
                sendError(res, 'Berkas wajib diunggah', 400);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const description = String(req.body?.description || '').trim();
            const uploaded = await projectService.uploadProjectFile(projectId, req.user.id, isAdmin, req.file, description);
            sendSuccess(res, uploaded, 'Berkas project berhasil diunggah', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Gagal mengunggah berkas project', 400);
        }
    }
    async getProjectChat(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const messages = await projectService.getProjectChatMessages(projectId, req.user.id, isAdmin);
            sendSuccess(res, messages, 'Project chat retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal memuat pesan chat project', 403);
        }
    }
    async sendProjectChat(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            if (!canWriteInProject(req.user)) {
                sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const message = String(req.body?.message || '').trim();
            if (!message && !req.file) {
                sendError(res, 'Pesan atau lampiran wajib diisi', 400);
                return;
            }
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const sent = await projectService.sendProjectChatMessage(projectId, req.user.id, isAdmin, message, req.file);
            sendSuccess(res, sent, 'Pesan terkirim', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Gagal mengirim pesan', 400);
        }
    }
    async editProjectFile(req, res) {
        try {
            if (!req.user || (!isAdminOrSuperAdmin(req.user) && !isPicRole(req.user))) {
                sendError(res, 'Akses ditolak: Hanya role PIC atau Admin yang dapat mengedit berkas project.', 403);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const fileId = parseInt(req.params.fileId, 10);
            const description = String(req.body?.description || '').trim();
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const result = await projectService.editProjectFile(projectId, fileId, req.user.id, isAdmin, description);
            sendSuccess(res, result, 'Berkas project berhasil diperbarui');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal mengedit berkas project', 400);
        }
    }
    async deleteProjectFile(req, res) {
        try {
            if (!req.user || !canWriteInProject(req.user)) {
                sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const fileId = parseInt(req.params.fileId, 10);
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const canManageAll = isAdmin || isPicRole(req.user);
            const result = await projectService.deleteProjectFile(projectId, fileId, req.user.id, isAdmin, canManageAll);
            sendSuccess(res, result, 'Berkas project berhasil dihapus');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal menghapus berkas project', 403);
        }
    }
    async editProjectComment(req, res) {
        try {
            if (!req.user || (!isAdminOrSuperAdmin(req.user) && !isPicRole(req.user))) {
                sendError(res, 'Akses ditolak: Hanya role PIC atau Admin yang dapat mengedit komentar project.', 403);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const commentId = parseInt(req.params.commentId, 10);
            const description = String(req.body?.description || '').trim();
            if (!description) {
                sendError(res, 'Isi komentar wajib diisi', 400);
                return;
            }
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const result = await projectService.editProjectComment(projectId, commentId, req.user.id, isAdmin, description);
            sendSuccess(res, result, 'Komentar project berhasil diperbarui');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal mengedit komentar project', 400);
        }
    }
    async deleteProjectComment(req, res) {
        try {
            if (!req.user || !canWriteInProject(req.user)) {
                sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const commentId = parseInt(req.params.commentId, 10);
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const canManageAll = isAdmin || isPicRole(req.user);
            const result = await projectService.deleteProjectComment(projectId, commentId, req.user.id, isAdmin, canManageAll);
            sendSuccess(res, result, 'Komentar project berhasil dihapus');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal menghapus komentar project', 403);
        }
    }
    async editProjectChat(req, res) {
        try {
            if (!req.user || (!isAdminOrSuperAdmin(req.user) && !isPicRole(req.user))) {
                sendError(res, 'Akses ditolak: Hanya role PIC atau Admin yang dapat mengedit pesan chat.', 403);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const messageId = parseInt(req.params.messageId, 10);
            const message = String(req.body?.message || '').trim();
            if (!message) {
                sendError(res, 'Isi pesan wajib diisi', 400);
                return;
            }
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const result = await projectService.editProjectChatMessage(projectId, messageId, req.user.id, isAdmin, message);
            sendSuccess(res, result, 'Pesan chat berhasil diperbarui');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal mengedit pesan chat', 400);
        }
    }
    async deleteProjectChat(req, res) {
        try {
            if (!req.user || !canWriteInProject(req.user)) {
                sendError(res, 'Akses ditolak: Role Client hanya memiliki akses baca (Read-Only).', 403);
                return;
            }
            const projectId = parseInt(req.params.id, 10);
            const messageId = parseInt(req.params.messageId, 10);
            const isAdmin = isAdminOrSuperAdmin(req.user);
            const canManageAll = isAdmin || isPicRole(req.user);
            const result = await projectService.deleteProjectChatMessage(projectId, messageId, req.user.id, isAdmin, canManageAll);
            sendSuccess(res, result, 'Pesan chat berhasil dihapus');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal menghapus pesan chat', 403);
        }
    }
}
export const projectController = new ProjectController();
