import { authService } from '../services/authService.js';
import { sendSuccess, sendError } from '../utils/response.js';
function extractDeviceMeta(req) {
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
    async login(req, res) {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                sendError(res, 'Email dan kata sandi wajib diisi', 400);
                return;
            }
            const result = await authService.login(email, password, extractDeviceMeta(req));
            sendSuccess(res, result, 'Login berhasil');
        }
        catch (error) {
            sendError(res, error.message || 'Login gagal', 401);
        }
    }
    async googleLogin(req, res) {
        try {
            const { accessToken, idToken } = req.body || {};
            if (!accessToken && !idToken) {
                sendError(res, 'Token Google wajib disertakan', 400);
                return;
            }
            const result = await authService.googleLogin({ accessToken, idToken }, extractDeviceMeta(req));
            sendSuccess(res, result, 'Login Google berhasil');
        }
        catch (error) {
            sendError(res, error.message || 'Login Google gagal', 401);
        }
    }
    /**
     * HTTPS OAuth 2.0 callback bridge compliant with Google Web Client ID policy.
     * Reads the fragment (#access_token=...&state=<appReturnUrl>) in the browser
     * and redirects back to the mobile app deep link (primeteam:// or exp://).
     */
    googleOAuthCallback(req, res) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(`<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Mengalihkan ke PrimeTeam...</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; padding: 24px; text-align: center; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; max-width: 360px; width: 100%; box-shadow: 0 4px 16px rgba(15,23,42,0.06); }
    .btn { display: inline-block; margin-top: 16px; background: #00628d; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 10px; font-weight: 700; font-size: 14px; }
    p { color: #64748b; font-size: 13px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <h3 style="margin:0 0 8px 0;">Autentikasi Google Berhasil</h3>
    <p>Sedang mengarahkan kembali ke aplikasi PrimeTeam...</p>
    <a id="openAppBtn" class="btn" href="primeteam://google-auth">Buka Aplikasi</a>
  </div>
  <script>
    (function() {
      var hash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
      var query = window.location.search ? window.location.search.replace(/^\\?/, '') : '';
      var params = new URLSearchParams(hash || query);
      var rawState = params.get('state') || 'primeteam://google-auth';
      var appReturnUrl = rawState;
      try {
        if (/^https?%3A|^primeteam%3A|^exp%3A/i.test(rawState)) {
          appReturnUrl = decodeURIComponent(rawState);
        }
      } catch (e) {}
      if (!/^(primeteam|exp|exps|https?):\\/\\//i.test(appReturnUrl)) {
        appReturnUrl = 'primeteam://google-auth';
      }
      var target = appReturnUrl + (hash ? '#' + hash : (query ? '?' + query : ''));
      var btn = document.getElementById('openAppBtn');
      if (btn) btn.href = target;
      window.location.replace(target);
    })();
  </script>
</body>
</html>`);
    }
    async getSessions(req, res) {
        try {
            const sessions = await authService.getActiveSessions();
            sendSuccess(res, sessions, 'Active mobile sessions retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal mengambil daftar sesi perangkat', 500);
        }
    }
    async revokeSession(req, res) {
        try {
            const { sessionId } = req.params;
            if (!sessionId) {
                sendError(res, 'ID sesi wajib diisi', 400);
                return;
            }
            const result = await authService.revokeSession(sessionId);
            sendSuccess(res, result, 'Sesi perangkat berhasil diputus');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal memutus sesi perangkat', 500);
        }
    }
    async me(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const user = await authService.getMe(req.user.id);
            sendSuccess(res, user, 'Profile retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to get profile', 500);
        }
    }
    async changePassword(req, res) {
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
        }
        catch (error) {
            sendError(res, error.message || 'Failed to change password', 400);
        }
    }
    async logout(req, res) {
        try {
            if (req.user) {
                await authService.logout(req.user.id, req.user.sid);
            }
            sendSuccess(res, null, 'Logged out successfully');
        }
        catch (error) {
            sendError(res, error.message || 'Logout failed', 500);
        }
    }
}
export const authController = new AuthController();
