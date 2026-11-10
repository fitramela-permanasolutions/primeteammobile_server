import { notificationService } from '../services/notificationService.js';
import { sendSuccess, sendError } from '../utils/response.js';
export class NotificationController {
    async getNotifications(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 20;
            const result = await notificationService.getNotifications(req.user.id, page, limit);
            sendSuccess(res, result, 'Notifications retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve notifications', 500);
        }
    }
    async markAsRead(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const notificationId = parseInt(req.params.id, 10);
            if (isNaN(notificationId)) {
                sendError(res, 'Invalid notification ID', 400);
                return;
            }
            const result = await notificationService.markAsRead(notificationId, req.user.id);
            sendSuccess(res, result, 'Notification marked as read');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to mark notification as read', 500);
        }
    }
    async markAllAsRead(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const result = await notificationService.markAllAsRead(req.user.id);
            sendSuccess(res, result, 'All notifications marked as read');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to mark all as read', 500);
        }
    }
}
export const notificationController = new NotificationController();
