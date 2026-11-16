import { pool, table } from '../config/database.js';
import { resolveCiFile, stripHtml, toIsoUtc } from '../utils/ciHelpers.js';
export class WorkspaceService {
    /**
     * Announcements & Banners from permana_announcements and permana_banner_manager
     */
    async getBannersAndAnnouncements(userId, isAdmin) {
        const [announcements] = await pool.query(`SELECT a.id, a.title, a.description, a.start_date, a.end_date, a.created_by,
              a.share_with, a.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS author_name
       FROM ${table('announcements')} a
       LEFT JOIN ${table('users')} u ON u.id = a.created_by
       WHERE a.deleted = 0
       ORDER BY a.id DESC
       LIMIT 10`);
        let banners = [];
        try {
            const [bRows] = await pool.query(`SELECT id, title, start_date, end_date, created_by, share_with_team_members, banner, created_at
         FROM ${table('banner_manager')}
         WHERE deleted = 0
         ORDER BY id DESC
         LIMIT 5`);
            banners = bRows;
        }
        catch {
            // Ignore if banner_manager table not present
        }
        return {
            announcements: announcements.map((a) => ({
                id: a.id,
                title: a.title,
                description: stripHtml(a.description),
                start_date: a.start_date,
                end_date: a.end_date,
                author_name: a.author_name?.trim() || 'Admin',
                created_at: toIsoUtc(a.created_at) || a.created_at,
            })),
            banners: banners.map((b) => {
                const resolved = resolveCiFile(b.banner, 'timeline_files', true);
                return {
                    id: b.id,
                    title: b.title,
                    start_date: b.start_date,
                    end_date: b.end_date,
                    image_url: resolved?.thumbnailUrl || null,
                };
            }),
        };
    }
    /**
     * Leave Types & Leave Applications (permana_leave_types, permana_leave_applications)
     */
    async getLeaveTypes() {
        const [rows] = await pool.query(`SELECT id, title, status, color, description
       FROM ${table('leave_types')}
       WHERE deleted = 0 AND status = 'active'
       ORDER BY id ASC`);
        return rows;
    }
    async getLeaves(userId, isAdmin) {
        const whereClause = isAdmin ? 'WHERE la.deleted = 0' : 'WHERE la.deleted = 0 AND la.applicant_id = ?';
        const params = isAdmin ? [] : [userId];
        const [rows] = await pool.query(`SELECT la.id, la.leave_type_id, la.start_date, la.end_date, la.total_hours, la.total_days,
              la.applicant_id, la.reason, la.status, la.created_at, la.checked_at, la.checked_by, la.files,
              lt.title AS leave_type_title, lt.color AS leave_type_color,
              CONCAT(u.first_name, ' ', u.last_name) AS applicant_name,
              u.image AS applicant_avatar,
              CONCAT(cu.first_name, ' ', cu.last_name) AS checker_name
       FROM ${table('leave_applications')} la
       LEFT JOIN ${table('leave_types')} lt ON lt.id = la.leave_type_id
       LEFT JOIN ${table('users')} u ON u.id = la.applicant_id
       LEFT JOIN ${table('users')} cu ON cu.id = la.checked_by
       ${whereClause}
       ORDER BY la.id DESC
       LIMIT 40`, params);
        return rows.map((r) => {
            const avatar = resolveCiFile(r.applicant_avatar, 'profile_images');
            const attachment = resolveCiFile(r.files, 'timeline_files');
            return {
                id: r.id,
                leave_type_id: r.leave_type_id,
                leave_type_title: r.leave_type_title || 'Leave',
                leave_type_color: r.leave_type_color || '#83c340',
                start_date: r.start_date,
                end_date: r.end_date,
                total_days: Number(r.total_days || 1),
                total_hours: Number(r.total_hours || 8),
                applicant_id: r.applicant_id,
                applicant_name: r.applicant_name?.trim() || 'Staff',
                applicant_avatar: avatar?.thumbnailUrl || null,
                reason: stripHtml(r.reason),
                status: r.status,
                checker_name: r.checker_name?.trim() || null,
                attachment_url: attachment?.downloadUrl || null,
                attachment_name: attachment?.originalName || null,
                created_at: toIsoUtc(r.created_at) || r.created_at,
            };
        });
    }
    async createLeaveApplication(userId, input) {
        const start = new Date(input.start_date);
        const end = new Date(input.end_date || input.start_date);
        const diffDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const totalHours = diffDays * 8;
        const [result] = await pool.query(`INSERT INTO ${table('leave_applications')}
       (leave_type_id, start_date, end_date, total_hours, total_days, applicant_id, reason, status, created_at, created_by, checked_at, checked_by, files, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', UTC_TIMESTAMP(), ?, '0000-00-00 00:00:00', 0, 'a:0:{}', 0)`, [
            input.leave_type_id,
            input.start_date,
            input.end_date || input.start_date,
            totalHours,
            diffDays,
            userId,
            input.reason.trim(),
            userId,
        ]);
        return {
            id: result.insertId,
            leave_type_id: input.leave_type_id,
            start_date: input.start_date,
            end_date: input.end_date || input.start_date,
            total_days: diffDays,
            total_hours: totalHours,
            reason: input.reason.trim(),
            status: 'pending',
        };
    }
    /**
     * Calendar Events & Reminders (permana_events)
     */
    async getEvents(userId, isAdmin) {
        const [rows] = await pool.query(`SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.start_time, e.end_time,
              e.created_by, e.location, e.client_id, e.project_id, e.share_with,
              e.google_event_id, e.type, e.color,
              c.company_name AS client_name,
              p.title AS project_title,
              CONCAT(u.first_name, ' ', u.last_name) AS creator_name
       FROM ${table('events')} e
       LEFT JOIN ${table('clients')} c ON c.id = e.client_id
       LEFT JOIN ${table('projects')} p ON p.id = e.project_id
       LEFT JOIN ${table('users')} u ON u.id = e.created_by
       WHERE e.deleted = 0
       ORDER BY e.start_date DESC, e.id DESC
       LIMIT 40`);
        return rows
            .filter((r) => {
            if (isAdmin || r.created_by === userId)
                return true;
            const share = String(r.share_with || '');
            return !share || share === 'all' || share.split(',').includes(`member:${userId}`);
        })
            .map((r) => ({
            id: r.id,
            title: r.title,
            description: stripHtml(r.description),
            start_date: r.start_date,
            end_date: r.end_date && !String(r.end_date).startsWith('0000') ? r.end_date : r.start_date,
            start_time: r.start_time && r.start_time !== '00:00:00' ? r.start_time : null,
            end_time: r.end_time && r.end_time !== '00:00:00' ? r.end_time : null,
            location: r.location || null,
            type: r.type || 'event',
            color: r.color || '#4a8af4',
            google_event_id: r.google_event_id || null,
            client_name: r.client_name || null,
            project_title: r.project_title || null,
            creator_name: r.creator_name?.trim() || 'Team Member',
        }));
    }
    async createEvent(userId, input) {
        const [result] = await pool.query(`INSERT INTO ${table('events')}
       (title, description, start_date, end_date, start_time, end_time, created_by, location,
        client_id, labels, share_with, editable_google_event, google_event_id, deleted,
        lead_id, ticket_id, project_id, task_id, proposal_id, contract_id, subscription_id,
        invoice_id, order_id, estimate_id, related_user_id, no_of_cycles_completed,
        reminder_status, type, color, recurring, repeat_every, repeat_type, no_of_cycles,
        last_start_date, recurring_dates, confirmed_by, rejected_by, files)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', 'all', 0, '', 0,
               0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
               'new', ?, ?, 0, 1, 'months', 0, '0000-00-00', '', '0', '0', 'a:0:{}')`, [
            input.title.trim(),
            input.description ? `<p>${input.description.trim()}</p>` : '',
            input.start_date,
            input.end_date || input.start_date,
            input.start_time || '09:00:00',
            input.end_time || '10:00:00',
            userId,
            input.location || '',
            input.type || 'event',
            input.color || '#4a8af4',
        ]);
        return {
            id: result.insertId,
            title: input.title.trim(),
            description: input.description || '',
            start_date: input.start_date,
            end_date: input.end_date || input.start_date,
            location: input.location || '',
            color: input.color || '#4a8af4',
        };
    }
    /**
     * Notes (permana_notes)
     */
    async getNotes(userId, isAdmin, projectId) {
        let whereClause = 'WHERE n.deleted = 0';
        const params = [];
        if (projectId) {
            whereClause += ' AND n.project_id = ?';
            params.push(projectId);
        }
        else if (!isAdmin) {
            whereClause += ' AND (n.created_by = ? OR n.is_public = 1)';
            params.push(userId);
        }
        const [rows] = await pool.query(`SELECT n.id, n.created_by, n.created_at, n.title, n.description, n.project_id,
              n.client_id, n.is_public, n.color,
              p.title AS project_title,
              CONCAT(u.first_name, ' ', u.last_name) AS author_name
       FROM ${table('notes')} n
       LEFT JOIN ${table('projects')} p ON p.id = n.project_id
       LEFT JOIN ${table('users')} u ON u.id = n.created_by
       ${whereClause}
       ORDER BY n.id DESC
       LIMIT 50`, params);
        return rows.map((r) => ({
            id: r.id,
            title: r.title,
            description: stripHtml(r.description),
            project_id: r.project_id || 0,
            project_title: r.project_title || null,
            is_public: Boolean(r.is_public),
            color: r.color || '#4a8af4',
            author_name: r.author_name?.trim() || 'User',
            created_at: toIsoUtc(r.created_at) || r.created_at,
        }));
    }
    async createNote(userId, input) {
        const [result] = await pool.query(`INSERT INTO ${table('notes')}
       (created_by, created_at, title, description, project_id, client_id, user_id, labels, files, is_public, deleted, category_id, color)
       VALUES (?, UTC_TIMESTAMP(), ?, ?, ?, 0, 0, '', 'a:0:{}', ?, 0, 0, ?)`, [
            userId,
            input.title.trim(),
            input.description ? `<p>${input.description.trim()}</p>` : '',
            input.project_id || 0,
            input.is_public ? 1 : 0,
            input.color || '#4a8af4',
        ]);
        return {
            id: result.insertId,
            title: input.title.trim(),
            description: input.description || '',
            color: input.color || '#4a8af4',
            created_at: new Date().toISOString(),
        };
    }
    async deleteNote(noteId, userId, isAdmin) {
        if (isAdmin) {
            await pool.query(`UPDATE ${table('notes')} SET deleted = 1 WHERE id = ?`, [noteId]);
        }
        else {
            await pool.query(`UPDATE ${table('notes')} SET deleted = 1 WHERE id = ? AND created_by = ?`, [
                noteId,
                userId,
            ]);
        }
        return { id: noteId, deleted: true };
    }
    /**
     * Personal To-Do List (permana_to_do)
     */
    async getTodos(userId) {
        const [rows] = await pool.query(`SELECT id, created_by, created_at, title, description, labels, status, start_date, sort
       FROM ${table('to_do')}
       WHERE deleted = 0 AND created_by = ?
       ORDER BY status ASC, id DESC`, [userId]);
        return rows.map((r) => ({
            id: r.id,
            title: r.title,
            description: stripHtml(r.description),
            status: r.status,
            start_date: r.start_date,
            created_at: toIsoUtc(r.created_at) || r.created_at,
        }));
    }
    async createTodo(userId, input) {
        const [result] = await pool.query(`INSERT INTO ${table('to_do')}
       (created_by, created_at, title, description, labels, status, start_date, deleted, files, sort)
       VALUES (?, UTC_TIMESTAMP(), ?, ?, '', 'to_do', ?, 0, 'a:0:{}', 1000)`, [userId, input.title.trim(), input.description || '', input.start_date || null]);
        return {
            id: result.insertId,
            title: input.title.trim(),
            description: input.description || '',
            status: 'to_do',
            created_at: new Date().toISOString(),
        };
    }
    async toggleTodo(todoId, userId) {
        const [rows] = await pool.query(`SELECT id, status, title FROM ${table('to_do')} WHERE id = ? AND deleted = 0 LIMIT 1`, [todoId]);
        if (rows.length === 0)
            throw new Error('To-Do item tidak ditemukan');
        const nextStatus = rows[0].status === 'done' ? 'to_do' : 'done';
        await pool.query(`UPDATE ${table('to_do')} SET status = ? WHERE id = ?`, [nextStatus, todoId]);
        return { id: todoId, title: rows[0].title, status: nextStatus };
    }
    /**
     * Support Tickets (permana_tickets, permana_ticket_types, permana_ticket_comments)
     */
    async getTickets(userId, isAdmin) {
        const [rows] = await pool.query(`SELECT t.id, t.client_id, t.project_id, t.ticket_type_id, t.title, t.created_by,
              t.created_at, t.status, t.last_activity_at, t.assigned_to,
              tt.title AS ticket_type_title,
              c.company_name AS client_name,
              p.title AS project_title,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              CONCAT(cu.first_name, ' ', cu.last_name) AS creator_name
       FROM ${table('tickets')} t
       LEFT JOIN ${table('ticket_types')} tt ON tt.id = t.ticket_type_id
       LEFT JOIN ${table('clients')} c ON c.id = t.client_id
       LEFT JOIN ${table('projects')} p ON p.id = t.project_id
       LEFT JOIN ${table('users')} u ON u.id = t.assigned_to
       LEFT JOIN ${table('users')} cu ON cu.id = t.created_by
       WHERE t.deleted = 0
       ORDER BY t.last_activity_at DESC, t.id DESC
       LIMIT 40`);
        return rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            ticket_type_id: r.ticket_type_id,
            ticket_type_title: r.ticket_type_title || 'General Support',
            client_name: r.client_name || 'Internal',
            project_id: r.project_id || 0,
            project_title: r.project_title || null,
            assigned_to_name: r.assigned_to_name?.trim() || 'Unassigned',
            creator_name: r.creator_name?.trim() || 'User',
            created_at: toIsoUtc(r.created_at) || r.created_at,
            last_activity_at: toIsoUtc(r.last_activity_at) || r.last_activity_at,
        }));
    }
    async getTicketById(ticketId) {
        const [rows] = await pool.query(`SELECT t.id, t.client_id, t.project_id, t.ticket_type_id, t.title, t.created_by,
              t.created_at, t.status, t.last_activity_at, t.assigned_to,
              tt.title AS ticket_type_title,
              c.company_name AS client_name,
              p.title AS project_title,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM ${table('tickets')} t
       LEFT JOIN ${table('ticket_types')} tt ON tt.id = t.ticket_type_id
       LEFT JOIN ${table('clients')} c ON c.id = t.client_id
       LEFT JOIN ${table('projects')} p ON p.id = t.project_id
       LEFT JOIN ${table('users')} u ON u.id = t.assigned_to
       WHERE t.id = ? AND t.deleted = 0
       LIMIT 1`, [ticketId]);
        if (rows.length === 0)
            throw new Error('Ticket tidak ditemukan');
        const [comments] = await pool.query(`SELECT tc.id, tc.created_by, tc.created_at, tc.description, tc.files,
              CONCAT(u.first_name, ' ', u.last_name) AS author_name,
              u.image AS author_avatar
       FROM ${table('ticket_comments')} tc
       LEFT JOIN ${table('users')} u ON u.id = tc.created_by
       WHERE tc.ticket_id = ? AND tc.deleted = 0
       ORDER BY tc.created_at ASC, tc.id ASC`, [ticketId]);
        const t = rows[0];
        return {
            id: t.id,
            title: t.title,
            status: t.status,
            ticket_type_title: t.ticket_type_title || 'General Support',
            client_name: t.client_name || 'Internal',
            project_title: t.project_title || null,
            assigned_to_name: t.assigned_to_name?.trim() || 'Unassigned',
            created_at: toIsoUtc(t.created_at) || t.created_at,
            comments: comments.map((c) => {
                const avatar = resolveCiFile(c.author_avatar, 'profile_images');
                const attachment = resolveCiFile(c.files, 'ticket_files');
                return {
                    id: c.id,
                    created_by: c.created_by,
                    author_name: c.created_by === 999999999 ? 'Automated Bot (PAAS)' : c.author_name?.trim() || 'User',
                    author_avatar: avatar?.thumbnailUrl || null,
                    description: stripHtml(c.description),
                    attachment_url: attachment?.downloadUrl || null,
                    attachment_name: attachment?.originalName || null,
                    created_at: toIsoUtc(c.created_at) || c.created_at,
                };
            }),
        };
    }
    async createTicket(userId, input) {
        const [result] = await pool.query(`INSERT INTO ${table('tickets')}
       (client_id, project_id, ticket_type_id, title, created_by, requested_by, created_at,
        status, last_activity_at, assigned_to, creator_name, creator_email, labels, task_id,
        closed_at, merged_with_ticket_id, deleted, cc_contacts_and_emails)
       VALUES (0, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), 'new', UTC_TIMESTAMP(), 0, '', '', '', 0, '1970-01-01 00:00:00', 0, 0, '')`, [input.project_id || 0, input.ticket_type_id || 1, input.title.trim(), userId, userId]);
        const ticketId = result.insertId;
        // Insert initial comment
        await pool.query(`INSERT INTO ${table('ticket_comments')}
       (created_by, created_at, description, ticket_id, files, is_note, deleted)
       VALUES (?, UTC_TIMESTAMP(), ?, ?, 'a:0:{}', 0, 0)`, [userId, `<p>${input.description.trim()}</p>`, ticketId]);
        // Check auto_reply_to_tickets setting in permana_settings
        const [settings] = await pool.query(`SELECT setting_name, setting_value FROM ${table('settings')}
       WHERE setting_name IN ('auto_reply_to_tickets', 'auto_reply_to_tickets_message') AND deleted = 0`);
        const sMap = {};
        for (const s of settings)
            sMap[s.setting_name] = s.setting_value || '';
        if (sMap.auto_reply_to_tickets === '1' && sMap.auto_reply_to_tickets_message) {
            await pool.query(`INSERT INTO ${table('ticket_comments')}
         (created_by, created_at, description, ticket_id, files, is_note, deleted)
         VALUES (999999999, UTC_TIMESTAMP(), ?, ?, 'a:0:{}', 0, 0)`, [sMap.auto_reply_to_tickets_message, ticketId]);
        }
        return this.getTicketById(ticketId);
    }
}
export const workspaceService = new WorkspaceService();
