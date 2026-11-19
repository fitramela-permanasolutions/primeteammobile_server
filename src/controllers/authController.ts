import { Request, Response } from 'express';
import { authService } from '../services/authService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../types/index.js';

function extractDeviceMeta(req: Request) {
  const cfIp = req.headers['cf-connecting-ip'];
  const fwdIp = req.headers['x-forwarded-for'];
  const rawIp = Array.isArray(cfIp)
    ? cfIp[0]
    : typeof cfIp === 'string'
    ? cfIp
    : Array.isArray(fwdIp)
    ? fwdIp[0]
    : typeof fwdIp === 'string'
    ? fwdIp.split(',')[0].trim()
    : req.ip || '';
  const device = req.body?.deviceInfo || {};
  return {
    ip_address: rawIp,
    device_id: device.device_id || '',
    device_brand: device.device_brand || '',
    device_model: device.device_model || '',
    os_name: device.os_name || '',
    os_version: device.os_version || '',
    app_version: device.app_version || '',
  };
}

export class AuthController {
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        sendError(res, 'Email dan kata sandi wajib diisi', 400);
        return;
      }

      const result = await authService.login(email, password, extractDeviceMeta(req));
      sendSuccess(res, result, 'Login berhasil');
    } catch (error: any) {
      sendError(res, error.message || 'Login gagal', 401);
    }
  }

  async googleLogin(req: Request, res: Response): Promise<void> {
    try {
      const { accessToken, idToken } = req.body || {};
      if (!accessToken && !idToken) {
        sendError(res, 'Token Google wajib disertakan', 400);
        return;
      }
      const result = await authService.googleLogin(
        { accessToken, idToken },
        extractDeviceMeta(req)
      );
      sendSuccess(res, result, 'Login Google berhasil');
    } catch (error: any) {
      sendError(res, error.message || 'Login Google gagal', 401);
    }
  }

  async getSessions(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const sessions = await authService.getActiveSessions();
      sendSuccess(res, sessions, 'Active mobile sessions retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Gagal mengambil daftar sesi perangkat', 500);
    }
  }

  async revokeSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      if (!sessionId) {
        sendError(res, 'ID sesi wajib diisi', 400);
        return;
      }
      const result = await authService.revokeSession(sessionId);
      sendSuccess(res, result, 'Sesi perangkat berhasil diputus');
    } catch (error: any) {
      sendError(res, error.message || 'Gagal memutus sesi perangkat', 500);
    }
  }

  async me(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }

      const user = await authService.getMe(req.user.id);
      sendSuccess(res, user, 'Profile retrieved');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to get profile', 500);
    }
  }

  async changePassword(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        sendError(res, 'Unauthorized', 401);
        return;
      }

      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        sendError(res, 'Current password and new password are required', 400);
        return;
      }

      const result = await authService.changePassword(req.user.id, currentPassword, newPassword);
      sendSuccess(res, result, 'Password changed successfully');
    } catch (error: any) {
      sendError(res, error.message || 'Failed to change password', 400);
    }
  }

  async logout(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (req.user) {
        await authService.logout(req.user.id, req.user.sid);
      }
      sendSuccess(res, null, 'Logged out successfully');
    } catch (error: any) {
      sendError(res, error.message || 'Logout failed', 500);
    }
  }
}

export const authController = new AuthController();
