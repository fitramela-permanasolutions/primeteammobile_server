import { settingsService } from '../services/settingsService.js';
import { sendSuccess, sendError } from '../utils/response.js';
export class SettingsController {
    async getPlatformSettings(req, res) {
        try {
            const settings = await settingsService.getPlatformSettings();
            sendSuccess(res, settings, 'Platform settings retrieved');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to fetch platform settings', 500);
        }
    }
    async updatePlatformSettings(req, res) {
        try {
            const { default_theme_color, pwa_theme_color, app_title } = req.body;
            const updated = await settingsService.updatePlatformSettings({
                default_theme_color,
                pwa_theme_color,
                app_title,
            });
            sendSuccess(res, updated, 'Platform settings updated');
        }
        catch (error) {
            sendError(res, error.message || 'Failed to update platform settings', 500);
        }
    }
}
export const settingsController = new SettingsController();
