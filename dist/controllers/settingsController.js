import { settingsService } from '../services/settingsService.js';
import { sendSuccess, sendError } from '../utils/response.js';
function withAbsoluteMediaUrls(req, settings) {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const toFull = (url) => {
        if (!url)
            return null;
        if (url.startsWith('/'))
            return `${baseUrl}${url}`;
        return url;
    };
    return {
        ...settings,
        site_logo_url: toFull(settings.site_logo_url),
        favicon_url: toFull(settings.favicon_url),
        signin_background_url: toFull(settings.signin_background_url),
    };
}
export class SettingsController {
    async getPlatformSettings(req, res) {
        try {
            const settings = await settingsService.getPlatformSettings();
            sendSuccess(res, withAbsoluteMediaUrls(req, settings), 'Platform settings retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to fetch platform settings', 500);
        }
    }
    async getAdminSecrets(req, res) {
        try {
            const secrets = await settingsService.getAdminSecrets();
            sendSuccess(res, secrets, 'Admin settings retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to fetch admin settings', 500);
        }
    }
    async updatePlatformSettings(req, res) {
        try {
            const updated = await settingsService.updatePlatformSettings(req.body || {});
            sendSuccess(res, withAbsoluteMediaUrls(req, updated), 'Platform settings updated');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to update platform settings', 500);
        }
    }
    async updateUploadDocPath(req, res) {
        try {
            const { upload_doc_path } = req.body;
            if (!upload_doc_path || !String(upload_doc_path).trim()) {
                sendError(res, 'Path direktori upload dokumen wajib diisi', 400);
                return;
            }
            const updated = await settingsService.updatePlatformSettings({
                upload_doc_path: String(upload_doc_path).trim(),
            });
            sendSuccess(res, withAbsoluteMediaUrls(req, updated), 'Path penyimpanan dokumen berhasil diperbarui');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal memperbarui path penyimpanan dokumen', 500);
        }
    }
    async uploadLogo(req, res) {
        try {
            if (!req.file) {
                sendError(res, 'File gambar logo wajib diunggah', 400);
                return;
            }
            const updated = await settingsService.uploadSiteLogo(req.file);
            sendSuccess(res, withAbsoluteMediaUrls(req, updated), 'Logo aplikasi berhasil diperbarui');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal mengunggah logo aplikasi', 500);
        }
    }
    async uploadSigninBackground(req, res) {
        try {
            if (!req.file) {
                sendError(res, 'File gambar background login wajib diunggah', 400);
                return;
            }
            const updated = await settingsService.uploadSigninBackground(req.file);
            sendSuccess(res, withAbsoluteMediaUrls(req, updated), 'Background halaman login berhasil diperbarui');
        }
        catch (error) {
            sendError(res, error.message || 'Gagal mengunggah background login', 500);
        }
    }
}
export const settingsController = new SettingsController();
