import { googleWorkspaceService, } from '../services/googleWorkspaceService.js';
import { sendSuccess, sendError } from '../utils/response.js';
export class GoogleWorkspaceController {
    getBaseUrl(req) {
        const publicEnv = process.env.PUBLIC_BASE_URL?.trim();
        if (publicEnv) {
            return publicEnv.replace(/\/+$/, '');
        }
        const host = req.get('x-forwarded-host') || req.get('host') || 'localhost:5000';
        const rawProto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
        const firstProto = rawProto.split(',')[0].trim().toLowerCase();
        const isLocalHost = /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(host);
        const proto = !isLocalHost && firstProto === 'http' ? 'https' : firstProto;
        return `${proto}://${host}`.replace(/\/+$/, '');
    }
    getRedirectUri(req) {
        const baseUrl = this.getBaseUrl(req);
        return `${baseUrl}/api/v1/google/oauth/callback`;
    }
    async getStatus(req, res) {
        try {
            const baseUrl = this.getBaseUrl(req);
            const redirectUri = this.getRedirectUri(req);
            const status = await googleWorkspaceService.getIntegrationStatus(baseUrl);
            sendSuccess(res, {
                ...status,
                redirect_uri: redirectUri,
                authorized_redirect_uris: [
                    redirectUri,
                    'https://mobileserver.indodefence.net/api/v1/google/oauth/callback',
                ].filter((v, i, arr) => arr.indexOf(v) === i),
            }, 'Google Workspace integration status retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to get Google integration status', 500);
        }
    }
    async getOAuthUrl(req, res) {
        try {
            const service = (req.query.service || 'drive');
            const appRedirectUri = typeof req.query.app_redirect_uri === 'string' ? req.query.app_redirect_uri.trim() : '';
            const redirectUri = this.getRedirectUri(req);
            const statePayload = appRedirectUri
                ? Buffer.from(JSON.stringify({ service, appRedirectUri }), 'utf8').toString('base64url')
                : service;
            const consentUrl = await googleWorkspaceService.getOAuthConsentUrl(service, redirectUri, statePayload);
            if (req.query.redirect === '1') {
                res.redirect(consentUrl);
                return;
            }
            sendSuccess(res, {
                service,
                auth_url: consentUrl,
                redirect_uri: redirectUri,
                authorized_redirect_uris: [
                    redirectUri,
                    'https://mobileserver.indodefence.net/api/v1/google/oauth/callback',
                ].filter((v, i, arr) => arr.indexOf(v) === i),
            });
        }
        catch (error) {
            sendError(res, error.message || 'Failed to generate OAuth URL', 400);
        }
    }
    async handleOAuthCallback(req, res) {
        try {
            const code = req.query.code;
            const rawState = req.query.state || 'drive';
            let service = 'drive';
            let appRedirectUri = '';
            if (['drive', 'docs', 'sheets', 'meet', 'calendar'].includes(rawState)) {
                service = rawState;
            }
            else {
                try {
                    const decoded = JSON.parse(Buffer.from(rawState, 'base64url').toString('utf8'));
                    if (decoded?.service)
                        service = decoded.service;
                    if (decoded?.appRedirectUri)
                        appRedirectUri = decoded.appRedirectUri;
                }
                catch {
                    // fallback to drive
                }
            }
            if (!code) {
                res.status(400).send('<h3>OAuth Error: Missing authorization code</h3>');
                return;
            }
            const redirectUri = this.getRedirectUri(req);
            await googleWorkspaceService.handleOAuthCallback(service, code, redirectUri);
            if (appRedirectUri && /^(primeteam|exp|exps|https?):\/\//i.test(appRedirectUri)) {
                const sep = appRedirectUri.includes('?') ? '&' : '?';
                res.redirect(`${appRedirectUri}${sep}status=success&service=${encodeURIComponent(service)}`);
                return;
            }
            res.send(`
        <html>
          <body style="font-family: sans-serif; text-align: center; padding: 48px; background: #f8fafc;">
            <div style="max-width: 420px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
              <h2 style="color: #10b981;">✅ Google (${service.toUpperCase()}) Berhasil Terhubung!</h2>
              <p style="color: #475569;">Token OAuth2 baru telah disimpan ke database platform. Anda dapat menutup halaman ini dan kembali ke aplikasi mobile.</p>
            </div>
          </body>
        </html>
      `);
        }
        catch (error) {
            res.status(500).send(`<h3>Gagal memproses OAuth: ${error.message}</h3>`);
        }
    }
    async getDocs(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const docs = await googleWorkspaceService.getGoogleDocs(req.user.id, Boolean(req.user.is_admin));
            sendSuccess(res, docs, 'Google Docs retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to get Google Docs', 500);
        }
    }
    async createDoc(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { title, description, google_document_id, share_with } = req.body;
            if (!title || !String(title).trim()) {
                sendError(res, 'Judul dokumen wajib diisi', 400);
                return;
            }
            const created = await googleWorkspaceService.createGoogleDoc(req.user.id, {
                title: String(title),
                description,
                google_document_id,
                share_with,
            });
            sendSuccess(res, created, 'Google Doc created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create Google Doc', 500);
        }
    }
    async getSheets(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const sheets = await googleWorkspaceService.getGoogleSheets(req.user.id, Boolean(req.user.is_admin));
            sendSuccess(res, sheets, 'Google Sheets retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to get Google Sheets', 500);
        }
    }
    async createSheet(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { title, description, google_spreadsheet_id, share_with } = req.body;
            if (!title || !String(title).trim()) {
                sendError(res, 'Judul spreadsheet wajib diisi', 400);
                return;
            }
            const created = await googleWorkspaceService.createGoogleSheet(req.user.id, {
                title: String(title),
                description,
                google_spreadsheet_id,
                share_with,
            });
            sendSuccess(res, created, 'Google Sheet created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create Google Sheet', 500);
        }
    }
    async getMeets(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const meets = await googleWorkspaceService.getGoogleMeets(req.user.id, Boolean(req.user.is_admin));
            sendSuccess(res, meets, 'Google Meet meetings retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to get Google Meet meetings', 500);
        }
    }
    async createMeet(req, res) {
        try {
            if (!req.user) {
                sendError(res, 'Unauthorized', 401);
                return;
            }
            const { title, description, start_time, join_url } = req.body;
            if (!title || !String(title).trim()) {
                sendError(res, 'Judul meeting wajib diisi', 400);
                return;
            }
            const created = await googleWorkspaceService.createGoogleMeet(req.user.id, {
                title: String(title),
                description,
                start_time: start_time || new Date().toISOString().slice(0, 19).replace('T', ' '),
                join_url,
            });
            sendSuccess(res, created, 'Google Meet created', 201);
        }
        catch (error) {
            sendError(res, error.message || 'Failed to create Google Meet', 500);
        }
    }
}
export const googleWorkspaceController = new GoogleWorkspaceController();
