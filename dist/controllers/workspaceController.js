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
            const rawLeaveType = req.body.leave_type_id ?? req.body.leaveTypeId ?? req.body.leave_type ?? 0;
            const leaveTypeId = typeof rawLeaveType === 'object' && rawLeaveType !== null
                ? Number(rawLeaveType.id ?? rawLeaveType.value ?? 0)
                : Number(rawLeaveType || 0);
            const startDate = req.body.start_date ?? req.body.startDate;
            const endDate = req.body.end_date ?? req.body.endDate ?? startDate;
            const reason = req.body.reason ?? req.body.description;
            if (!leaveTypeId || !startDate || !String(reason || '').trim()) {
                sendError(res, 'Tipe cuti, tanggal mulai, dan alasan wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createLeaveApplication(req.user.id, {
                leave_type_id: leaveTypeId,
                start_date: String(startDate),
                end_date: String(endDate || startDate),
                reason: String(reason).trim(),
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
            const title = req.body.title;
            const description = req.body.description;
            const startDate = req.body.start_date ?? req.body.startDate;
            const endDate = req.body.end_date ?? req.body.endDate ?? startDate;
            const startTime = req.body.start_time ?? req.body.startTime;
            const endTime = req.body.end_time ?? req.body.endTime;
            const { location, color, type } = req.body;
            if (!String(title || '').trim() || !startDate) {
                sendError(res, 'Judul dan tanggal acara wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createEvent(req.user.id, {
                title: String(title).trim(),
                description,
                start_date: String(startDate),
                end_date: endDate ? String(endDate) : undefined,
                start_time: startTime,
                end_time: endTime,
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
            const title = req.body.title;
            const description = req.body.description;
            const projectId = req.body.project_id ?? req.body.projectId;
            const color = req.body.color;
            const isPublic = req.body.is_public ?? req.body.isPublic;
            if (!title || !String(title).trim()) {
                sendError(res, 'Judul catatan wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createNote(req.user.id, {
                title: String(title).trim(),
                description,
                project_id: projectId ? Number(projectId) : 0,
                color,
                is_public: Boolean(isPublic),
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
            const title = req.body.title;
            const description = req.body.description;
            const startDate = req.body.start_date ?? req.body.startDate;
            if (!title || !String(title).trim()) {
                sendError(res, 'Judul to-do wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createTodo(req.user.id, {
                title: String(title).trim(),
                description,
                start_date: startDate ? String(startDate) : undefined,
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
            const title = req.body.title;
            const description = req.body.description;
            const rawTicketType = req.body.ticket_type_id ?? req.body.ticketTypeId ?? 1;
            const ticketTypeId = typeof rawTicketType === 'object' && rawTicketType !== null
                ? Number(rawTicketType.id ?? rawTicketType.value ?? 1)
                : Number(rawTicketType || 1);
            const projectId = req.body.project_id ?? req.body.projectId;
            if (!String(title || '').trim() || !String(description || '').trim()) {
                sendError(res, 'Judul dan deskripsi tiket wajib diisi', 400);
                return;
            }
            const created = await workspaceService.createTicket(req.user.id, {
                title: String(title).trim(),
                description: String(description).trim(),
                ticket_type_id: ticketTypeId,
                project_id: projectId ? Number(projectId) : 0,
            });
            sendSuccess(res, created, 'Ticket created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create ticket', 500);
        }
    }
}
export const workspaceController = new WorkspaceController();
