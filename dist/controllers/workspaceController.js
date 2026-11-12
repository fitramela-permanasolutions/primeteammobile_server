import { workspaceService } from '../services/workspaceService.js';
import { sendSuccess, sendError } from '../utils/response.js';
export class WorkspaceController {
    async getBannersAndAnnouncements(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const data = await workspaceService.getBannersAndAnnouncements(req.user.id, Boolean(req.user.is_admin));
            sendSuccess(res, data, 'Banners and announcements retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve announcements', 500);
        }
    }
    async getLeaveTypes(req, res) {
        try {
            const types = await workspaceService.getLeaveTypes();
            sendSuccess(res, types, 'Leave types retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve leave types', 500);
        }
    }
    async getLeaves(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const leaves = await workspaceService.getLeaves(req.user.id, Boolean(req.user.is_admin));
            sendSuccess(res, leaves, 'Leave applications retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve leaves', 500);
        }
    }
    async createLeave(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { leave_type_id, start_date, end_date, reason } = req.body;
            if (!leave_type_id || !start_date || !reason) {
                sendError(res, 'Tipe cuti, tanggal mulai, dan alasan wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createLeaveApplication(req.user.id, {
                leave_type_id: Number(leave_type_id),
                start_date: String(start_date),
                end_date: String(end_date || start_date),
                reason: String(reason),
            });
            sendSuccess(res, created, 'Pengajuan cuti berhasil dikirim', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to submit leave application', 500);
        }
    }
    async getEvents(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const events = await workspaceService.getEvents(req.user.id, Boolean(req.user.is_admin));
            sendSuccess(res, events, 'Events retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve events', 500);
        }
    }
    async createEvent(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { title, description, start_date, end_date, start_time, end_time, location, color, type } = req.body;
            if (!title || !start_date) {
                sendError(res, 'Judul dan tanggal acara wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createEvent(req.user.id, {
                title: String(title),
                description,
                start_date: String(start_date),
                end_date,
                start_time,
                end_time,
                location,
                color,
                type,
            });
            sendSuccess(res, created, 'Event created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create event', 500);
        }
    }
    async getNotes(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const projectId = req.query.projectId ? parseInt(req.query.projectId, 10) : undefined;
            const notes = await workspaceService.getNotes(req.user.id, Boolean(req.user.is_admin), projectId);
            sendSuccess(res, notes, 'Notes retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve notes', 500);
        }
    }
    async createNote(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { title, description, project_id, color, is_public } = req.body;
            if (!title || !String(title).trim()) {
                sendError(res, 'Judul catatan wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createNote(req.user.id, {
                title: String(title),
                description,
                project_id: project_id ? Number(project_id) : 0,
                color,
                is_public: Boolean(is_public),
            });
            sendSuccess(res, created, 'Note created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create note', 500);
        }
    }
    async deleteNote(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const noteId = parseInt(req.params.id, 10);
            const deleted = await workspaceService.deleteNote(noteId, req.user.id, Boolean(req.user.is_admin));
            sendSuccess(res, deleted, 'Note deleted');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to delete note', 500);
        }
    }
    async getTodos(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const todos = await workspaceService.getTodos(req.user.id);
            sendSuccess(res, todos, 'To-do items retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve todos', 500);
        }
    }
    async createTodo(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { title, description, start_date } = req.body;
            if (!title || !String(title).trim()) {
                sendError(res, 'Judul to-do wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createTodo(req.user.id, {
                title: String(title),
                description,
                start_date,
            });
            sendSuccess(res, created, 'To-do created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create todo', 500);
        }
    }
    async toggleTodo(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const todoId = parseInt(req.params.id, 10);
            const toggled = await workspaceService.toggleTodo(todoId, req.user.id);
            sendSuccess(res, toggled, 'To-do toggled');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to toggle todo', 500);
        }
    }
    async getTickets(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const tickets = await workspaceService.getTickets(req.user.id, Boolean(req.user.is_admin));
            sendSuccess(res, tickets, 'Tickets retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve tickets', 500);
        }
    }
    async getTicketById(req, res) {
        try {
            const ticketId = parseInt(req.params.id, 10);
            const ticket = await workspaceService.getTicketById(ticketId);
            sendSuccess(res, ticket, 'Ticket detail retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve ticket detail', 404);
        }
    }
    async createTicket(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { title, description, ticket_type_id, project_id } = req.body;
            if (!title || !description) {
                sendError(res, 'Judul dan deskripsi tiket wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createTicket(req.user.id, {
                title: String(title),
                description: String(description),
                ticket_type_id: ticket_type_id ? Number(ticket_type_id) : 1,
                project_id: project_id ? Number(project_id) : 0,
            });
            sendSuccess(res, created, 'Ticket created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create ticket', 500);
        }
    }
}
export const workspaceController = new WorkspaceController();
