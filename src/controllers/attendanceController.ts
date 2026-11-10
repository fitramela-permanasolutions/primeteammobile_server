import { Response } from 'express';
import { attendanceService } from '../services/attendanceService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../types/index.js';

export class AttendanceController {
  async getStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }

      const status = await attendanceService.getCurrentStatus(req.user.id);
      sendSuccess(res, status, 'Current attendance status retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to retrieve attendance status', 500);
    }
  }

  async clockIn(req: AuthenticatedRequest, res: Response): Promise<void> {
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
    } catch (error: any) {
      sendError(res, error.message || 'Clock-in failed', 400);
    }
  }

  async clockOut(req: AuthenticatedRequest, res: Response): Promise<void> {
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
    } catch (error: any) {
      sendError(res, error.message || 'Clock-out failed', 400);
    }
  }

  async getHistory(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }

      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      const history = await attendanceService.getHistory(req.user.id, page, limit, startDate, endDate);
      sendSuccess(res, history, 'Attendance history retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to retrieve attendance history', 500);
    }
  }
}

export const attendanceController = new AttendanceController();
