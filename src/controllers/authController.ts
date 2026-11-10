import { Request, Response } from 'express';
import { authService } from '../services/authService.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { AuthenticatedRequest } from '../types/index.js';

export class AuthController {
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        sendError(res, 'Email and password are required', 400);
        return;
      }

      const result = await authService.login(email, password);
      sendSuccess(res, result, 'Login successful');
    } catch (error: any) {
      sendError(res, error.message || 'Login failed', 401);
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
        await authService.logout(req.user.id);
      }
      sendSuccess(res, null, 'Logged out successfully');
    } catch (error: any) {
      sendError(res, error.message || 'Logout failed', 500);
    }
  }
}

export const authController = new AuthController();
