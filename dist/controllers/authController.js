import { authService } from '../services/authService.js';
import { settingsService } from '../services/settingsService.js';
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
     * Starts Google OAuth 2.0 Authorization Code Flow (Web Client ID) from the backend
     * so redirect_uri is ALWAYS a compliant HTTPS URL (/api/v1/auth/google/callback).
     */
    async googleOAuthStart(req, res) {
        try {
            const secrets = await settingsService.getAdminSecrets();
            const clientId = (secrets.google_oauth_client_id || '').trim();
            const clientSecret = (secrets.google_oauth_client_secret || '').trim();
            if (!clientId) {
                res.status(400).send('Google OAuth Client ID belum dikonfigurasi oleh Admin.');
                return;
            }
            const appRedirectUri = String(req.query.app_redirect_uri || 'primeteam://google-auth').trim();
            const host = req.get('host') || 'mobileserver.indodefence.net';
            const isLocalHost = /^(localhost|127\.0\.0\.1|10\.|192\.168\.)/i.test(host);
            const proto = isLocalHost ? req.protocol || 'http' : 'https';
            const httpsCallbackUrl = `${proto}://${host}/api/v1/auth/google/callback`;
            const responseType = clientSecret ? 'code' : 'token';
            const params = new URLSearchParams({
                client_id: clientId,
                redirect_uri: httpsCallbackUrl,
                response_type: responseType,
                scope: 'openid email profile',
                state: appRedirectUri,
                prompt: 'select_account',
            });
            if (responseType === 'code') {
                params.set('access_type', 'online');
            }
            res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
        }
        catch (error) {
            res.status(500).send(error.message || 'Gagal memulai autentikasi Google');
        }
    }
    /**
     * HTTPS OAuth 2.0 callback bridge compliant with Google Web Client ID policy.
     * Supports BOTH:
     * - Authorization Code Flow (?code=...&state=<appReturnUrl>) -> exchanges code on server
     * - Implicit fallback (#access_token=...&state=<appReturnUrl>) -> bridges fragment in browser
     */
    async googleOAuthCallback(req, res) {
        const code = typeof req.query.code === 'string' ? req.query.code : '';
        const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
        const rawState = typeof req.query.state === 'string' ? req.query.state : 'primeteam://google-auth';
        let appReturnUrl = rawState;
        try {
            if (/^(https?|primeteam|exp|exps)%3A/i.test(rawState)) {
                appReturnUrl = decodeURIComponent(rawState);
            }
        }
        catch {
            // keep raw
        }
        if (!/^(primeteam|exp|exps|https?):\/\//i.test(appReturnUrl)) {
            appReturnUrl = 'primeteam://google-auth';
        }
        let resolvedHash = '';
        if (oauthError) {
            resolvedHash = `error=${encodeURIComponent(oauthError)}`;
        }
        else if (code) {
            try {
                const secrets = await settingsService.getAdminSecrets();
                const clientId = (secrets.google_oauth_client_id || '').trim();
                const clientSecret = (secrets.google_oauth_client_secret || '').trim();
                const host = req.get('host') || 'mobileserver.indodefence.net';
                const isLocalHost = /^(localhost|127\.0\.0\.1|10\.|192\.168\.)/i.test(host);
                const proto = isLocalHost ? req.protocol || 'http' : 'https';
                const httpsCallbackUrl = `${proto}://${host}/api/v1/auth/google/callback`;
                const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        code,
                        client_id: clientId,
                        client_secret: clientSecret,
                        redirect_uri: httpsCallbackUrl,
                        grant_type: 'authorization_code',
                    }).toString(),
                });
                const tokenJson = await tokenRes.json();
                if (tokenJson.access_token || tokenJson.id_token) {
                    const hp = new URLSearchParams();
                    if (tokenJson.access_token)
                        hp.set('access_token', tokenJson.access_token);
                    if (tokenJson.id_token)
                        hp.set('id_token', tokenJson.id_token);
                    resolvedHash = hp.toString();
                }
                else {
                    resolvedHash = `error=${encodeURIComponent(tokenJson.error_description || tokenJson.error || 'token_exchange_failed')}`;
                }
            }
            catch (err) {
                resolvedHash = `error=${encodeURIComponent(err?.message || 'token_exchange_error')}`;
            }
        }
        const serverRedirectTarget = resolvedHash ? `${appReturnUrl}#${resolvedHash}` : '';
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
    <h3 style="margin:0 0 8px 0;">Autentikasi Google Diproses</h3>
    <p>Sedang mengarahkan kembali ke aplikasi PrimeTeam...</p>
    <a id="openAppBtn" class="btn" href="${serverRedirectTarget || appReturnUrl}">Buka Aplikasi</a>
  </div>
  <script>
    (function() {
      var serverTarget = ${JSON.stringify(serverRedirectTarget)};
      if (serverTarget) {
        window.location.replace(serverTarget);
        return;
      }
      var hash = window.location.hash ? window.location.hash.replace(/^#/, '') : '';
      var query = window.location.search ? window.location.search.replace(/^\\?/, '') : '';
      var params = new URLSearchParams(hash || query);
      var rawState = params.get('state') || 'primeteam://google-auth';
      var appReturnUrl = rawState;
      try {
        if (/^(https?|primeteam|exp|exps)%3A/i.test(rawState)) {
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
