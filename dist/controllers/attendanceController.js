import { attendanceService } from '../services/attendanceService.js';
import { sendSuccess, sendError } from '../utils/response.js';
export class AttendanceController {
    async getStatus(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const status = await attendanceService.getCurrentStatus(req.user.id);
            sendSuccess(res, status, 'Current attendance status retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve attendance status', 500);
        }
    }
    async clockIn(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { latitude, longitude, address, selfieUrl, note } = req.body;
            const record = await attendanceService.clockIn(req.user.id, {
                latitude: latitude ? parseFloat(latitude) : undefined,
                longitude: longitude ? parseFloat(longitude) : undefined,
                address,
                selfieUrl,
                note,
            });
            sendSuccess(res, record, 'Clock-in successful', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Clock-in failed', 400);
        }
    }
    async clockOut(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { latitude, longitude, address, note } = req.body;
            const record = await attendanceService.clockOut(req.user.id, {
                latitude: latitude ? parseFloat(latitude) : undefined,
                longitude: longitude ? parseFloat(longitude) : undefined,
                address,
                note,
            });
            sendSuccess(res, record, 'Clock-out successful');
        }
        catch (error) {
            sendError(res, error.message || 'Clock-out failed', 400);
        }
    }
    async getHistory(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const page = parseInt(req.query.page, 10) || 1;
            const limit = parseInt(req.query.limit, 10) || 20;
            const startDate = req.query.startDate;
            const endDate = req.query.endDate;
            const history = await attendanceService.getHistory(req.user.id, page, limit, startDate, endDate);
            sendSuccess(res, history, 'Attendance history retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to retrieve attendance history', 500);
        }
    }
}
export const attendanceController = new AttendanceController();
