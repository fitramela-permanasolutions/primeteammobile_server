import { pool, table } from '../config/database.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parsePhpSerializedArray, resolveCiFile } from '../utils/ciHelpers.js';
import { googleDriveService } from './googleDriveService.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRootDir = path.resolve(__dirname, '../..');
const defaultUploadDocPath = process.env.UPLOAD_DIR || '../paas/files';
export const PAAS_THEME_PALETTE = [
    { code: 'F2F2F2', hex: '#00628d', name: 'Default (Indodefence Blue)' },
    { code: 'a93226', hex: '#a93226', name: 'Crimson Red (PAAS Default)' },
    { code: '83c340', hex: '#83c340', name: 'Fresh Green' },
    { code: '2471a3', hex: '#2471a3', name: 'Ocean Blue' },
    { code: '2e86c1', hex: '#2e86c1', name: 'Sky Blue' },
    { code: '5d78ff', hex: '#5d78ff', name: 'Royal Indigo' },
    { code: '557bbb', hex: '#557bbb', name: 'Steel Blue' },
    { code: '00BCD4', hex: '#00BCD4', name: 'Cyan' },
    { code: '17a589', hex: '#17a589', name: 'Emerald Teal' },
    { code: '839192', hex: '#839192', name: 'Muted Teal' },
    { code: 'd68910', hex: '#d68910', name: 'Amber Gold' },
    { code: '884ea0', hex: '#884ea0', name: 'Amethyst Purple' },
    { code: 'a6acaf', hex: '#a6acaf', name: 'Silver Grey' },
    { code: '555a61', hex: '#555a61', name: 'Slate Grey' },
    { code: '2e4053', hex: '#2e4053', name: 'Midnight Slate' },
    { code: '1d2632', hex: '#1d2632', name: 'Dark Navy' },
    { code: '1E202D', hex: '#1E202D', name: 'Obsidian Dark' },
    { code: '404040', hex: '#404040', name: 'Charcoal Grey' },
];
export class SettingsService {
    async getPlatformSettings() {
        const keys = [
            'app_title',
            'site_logo',
            'favicon',
            'signin_page_background',
            'show_background_image_in_signin_page',
            'show_logo_in_signin_page',
            'show_theme_color_changer',
            'default_theme_color',
            'pwa_theme_color',
            'pwa_icon',
            'enable_footer',
            'footer_copyright_text',
            'timezone',
            'date_format',
            'time_format',
            'currency_symbol',
            'default_currency',
            'accepted_file_formats',
            'rows_per_page',
            'show_in_kanban',
            'show_the_status_checkbox_in_tasks_list',
            'show_time_with_task_start_date_and_deadline',
            'project_tab_order',
            'enable_google_drive_api_to_upload_file',
            'google_drive_authorized',
            'enable_google_calendar_api',
            'google_calendar_authorized',
            'module_attendance',
            'module_leave',
            'module_event',
            'module_todo',
            'module_note',
            'module_announcement',
            'module_file_manager',
            'module_project_timesheet',
            'module_ticket',
            'module_timeline',
            'module_message',
            'module_expense',
            'module_invoice',
            'plugins',
            'upload_doc_path',
        ];
        const placeholders = keys.map(() => '?').join(', ');
        const [rows] = await pool.query(`SELECT setting_name, setting_value
       FROM ${table('settings')}
       WHERE setting_name IN (${placeholders}) AND deleted = 0`, keys);
        const map = {};
        for (const r of rows) {
            map[r.setting_name] = r.setting_value ?? '';
        }
        // Fetch Auto Attendance plugin settings if available
        let autoAttendance = {
            auto_clock_in_on_signin: false,
            auto_clock_out_after: 12,
            auto_clock_out_on_signout: false,
        };
        try {
            const [aaRows] = await pool.query(`SELECT setting_name, setting_value FROM ${table('auto_attendance_settings')} WHERE deleted = 0`);
            const aaMap = {};
            for (const r of aaRows)
                aaMap[r.setting_name] = r.setting_value ?? '';
            autoAttendance = {
                auto_clock_in_on_signin: aaMap.auto_clock_in_on_signin === '1',
                auto_clock_out_after: Number(aaMap.auto_clock_out_after || 12),
                auto_clock_out_on_signout: aaMap.auto_clock_out_on_signout === '1',
            };
        }
        catch {
            // Ignore if table doesn't exist
        }
        // Fetch Google Docs, Sheets, Meet integration flags
        let googleDocsEnabled = false;
        let googleSheetsEnabled = false;
        let googleMeetEnabled = false;
        try {
            const [gdRows] = await pool.query(`SELECT setting_name, setting_value FROM ${table('google_docs_integration_settings')} WHERE deleted = 0`);
            const gdMap = {};
            for (const r of gdRows)
                gdMap[r.setting_name] = r.setting_value ?? '';
            googleDocsEnabled =
                gdMap.integrate_google_docs === '1' && gdMap.google_docs_authorized === '1';
            const [gsRows] = await pool.query(`SELECT setting_name, setting_value FROM ${table('google_sheets_integration_settings')} WHERE deleted = 0`);
            const gsMap = {};
            for (const r of gsRows)
                gsMap[r.setting_name] = r.setting_value ?? '';
            googleSheetsEnabled =
                gsMap.integrate_google_sheets === '1' && gsMap.google_sheets_authorized === '1';
            const [gmRows] = await pool.query(`SELECT setting_name, setting_value FROM ${table('google_meet_integration_settings')} WHERE deleted = 0`);
            const gmMap = {};
            for (const r of gmRows)
                gmMap[r.setting_name] = r.setting_value ?? '';
            googleMeetEnabled =
                gmMap.integrate_google_meet === '1' && gmMap.google_meet_authorized === '1';
        }
        catch {
            // Ignore if plugin tables don't exist
        }
        const rawThemeColor = (map.default_theme_color || 'F2F2F2').replace(/^#/, '');
        const pwaThemeColor = map.pwa_theme_color
            ? map.pwa_theme_color.startsWith('#')
                ? map.pwa_theme_color
                : `#${map.pwa_theme_color}`
            : '#00628d';
        // In RISE CRM / PAAS, 'F2F2F2' is the default light sidebar theme whose brand color is pwa_theme_color (#00628d).
        // Any other hex code in default_theme_color (e.g. 'a93226' or '83c340') is the active theme color of the platform.
        const primaryColor = rawThemeColor.toUpperCase() === 'F2F2F2' ? pwaThemeColor : `#${rawThemeColor}`;
        const siteLogo = resolveCiFile(map.site_logo, 'system', false);
        const favicon = resolveCiFile(map.favicon, 'system', false);
        const signinBg = resolveCiFile(map.signin_page_background, 'system', true);
        const pwaIcon = resolveCiFile(map.pwa_icon, 'system', false);
        const parsedPlugins = parsePhpSerializedArray(map.plugins || '') || {};
        const uploadDocPath = (map.upload_doc_path || defaultUploadDocPath).trim();
        return {
            app_title: map.app_title || 'Indodefence ( IDD )',
            enable_footer: map.enable_footer !== '0',
            footer_copyright_text: map.footer_copyright_text || 'Medianusa Permana',
            default_theme_color: rawThemeColor,
            pwa_theme_color: pwaThemeColor,
            primary_color: primaryColor,
            site_logo_url: siteLogo?.thumbnailUrl || null,
            favicon_url: favicon?.thumbnailUrl || pwaIcon?.thumbnailUrl || null,
            signin_background_url: signinBg?.thumbnailUrl || null,
            show_background_image_in_signin_page: map.show_background_image_in_signin_page === 'yes',
            show_logo_in_signin_page: map.show_logo_in_signin_page !== 'no',
            show_theme_color_changer: map.show_theme_color_changer !== 'no',
            upload_doc_path: uploadDocPath,
            timezone: map.timezone || 'Asia/Jakarta',
            date_format: map.date_format || 'd-m-Y',
            time_format: map.time_format || '24_hours',
            currency_symbol: map.currency_symbol || 'Rp. ',
            default_currency: map.default_currency || 'IDR',
            accepted_file_formats: map.accepted_file_formats || 'jpg,jpeg,png,doc,xlsx,txt,pdf,zip,webm,gif,docx,mp4',
            rows_per_page: Number(map.rows_per_page || 10),
            show_in_kanban: (map.show_in_kanban || 'project_name,client_name').split(',').filter(Boolean),
            show_the_status_checkbox_in_tasks_list: map.show_the_status_checkbox_in_tasks_list === '1',
            show_time_with_task_start_date_and_deadline: map.show_time_with_task_start_date_and_deadline === '1',
            project_tab_order: (map.project_tab_order || 'overview,tasks_kanban,milestones,tasks_list,notes,files,comments')
                .split(',')
                .filter(Boolean),
            google_drive_enabled: map.enable_google_drive_api_to_upload_file === '1' && map.google_drive_authorized === '1',
            google_calendar_enabled: map.enable_google_calendar_api === '1' && map.google_calendar_authorized === '1',
            google_docs_enabled: googleDocsEnabled,
            google_sheets_enabled: googleSheetsEnabled,
            google_meet_enabled: googleMeetEnabled,
            auto_attendance: autoAttendance,
            modules: {
                attendance: map.module_attendance !== '0',
                leave: map.module_leave !== '0',
                event: map.module_event !== '0',
                todo: map.module_todo !== '0',
                note: map.module_note !== '0',
                announcement: map.module_announcement !== '0',
                file_manager: map.module_file_manager !== '0',
                project_timesheet: map.module_project_timesheet !== '0',
                ticket: map.module_ticket !== '0',
                timeline: map.module_timeline !== '0',
                message: map.module_message !== '0',
                expense: map.module_expense !== '0',
                invoice: map.module_invoice !== '0',
            },
            active_plugins: parsedPlugins,
            theme_palette: PAAS_THEME_PALETTE,
        };
    }
    async getUploadDocPath() {
        try {
            const [rows] = await pool.query(`SELECT setting_value FROM ${table('settings')} WHERE setting_name = 'upload_doc_path' AND deleted = 0 LIMIT 1`);
            if (rows.length > 0 && rows[0].setting_value && String(rows[0].setting_value).trim()) {
                return String(rows[0].setting_value).trim();
            }
        }
        catch {
            // Fallback to default on DB error
        }
        return defaultUploadDocPath;
    }
    async getResolvedUploadBaseDir() {
        const configuredPath = await this.getUploadDocPath();
        const resolved = path.isAbsolute(configuredPath)
            ? configuredPath
            : path.resolve(serverRootDir, configuredPath);
        try {
            if (!fs.existsSync(resolved)) {
                fs.mkdirSync(resolved, { recursive: true });
            }
        }
        catch {
            // Fallback to default paas/files if configured path cannot be created
            const fallback = path.resolve(serverRootDir, '../paas/files');
            if (!fs.existsSync(fallback)) {
                fs.mkdirSync(fallback, { recursive: true });
            }
            return fallback;
        }
        return resolved;
    }
    async upsertSetting(name, value) {
        await pool.query(`INSERT INTO ${table('settings')} (setting_name, setting_value, type, deleted)
       VALUES (?, ?, 'app', 0)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), deleted = 0`, [name, value]);
    }
    buildPhpSerializedFile(fileName, fileId, serviceType) {
        const fn = fileName || '';
        const fid = fileId || '';
        const st = serviceType || '';
        if (st === 'google' && fid) {
            return `a:3:{s:9:"file_name";s:${Buffer.byteLength(fn)}:"${fn}";s:7:"file_id";s:${Buffer.byteLength(fid)}:"${fid}";s:12:"service_type";s:6:"google";}`;
        }
        return `a:1:{s:9:"file_name";s:${Buffer.byteLength(fn)}:"${fn}";}`;
    }
    async uploadSiteLogo(file) {
        const driveRes = await googleDriveService.uploadFile(file.path, file.filename, file.mimetype, 'system');
        const serialized = this.buildPhpSerializedFile(file.filename, driveRes?.file_id || null, driveRes?.service_type || null);
        await this.upsertSetting('site_logo', serialized);
        await this.upsertSetting('show_logo_in_signin_page', 'yes');
        return this.getPlatformSettings();
    }
    async uploadSigninBackground(file) {
        const driveRes = await googleDriveService.uploadFile(file.path, file.filename, file.mimetype, 'system');
        const serialized = this.buildPhpSerializedFile(file.filename, driveRes?.file_id || null, driveRes?.service_type || null);
        await this.upsertSetting('signin_page_background', serialized);
        await this.upsertSetting('show_background_image_in_signin_page', 'yes');
        return this.getPlatformSettings();
    }
    async updatePlatformSettings(input) {
        const updates = [];
        if (input.default_theme_color) {
            const cleanCode = input.default_theme_color.replace(/^#/, '');
            updates.push(['default_theme_color', cleanCode]);
        }
        if (input.pwa_theme_color) {
            const cleanHex = input.pwa_theme_color.startsWith('#')
                ? input.pwa_theme_color
                : `#${input.pwa_theme_color}`;
            updates.push(['pwa_theme_color', cleanHex]);
        }
        if (input.app_title !== undefined && input.app_title.trim()) {
            updates.push(['app_title', input.app_title.trim()]);
        }
        if (input.footer_copyright_text !== undefined) {
            updates.push(['footer_copyright_text', input.footer_copyright_text.trim()]);
        }
        if (input.upload_doc_path !== undefined && input.upload_doc_path.trim()) {
            const cleanPath = input.upload_doc_path.trim();
            updates.push(['upload_doc_path', cleanPath]);
            // Ensure the target directory exists right away
            const resolved = path.isAbsolute(cleanPath)
                ? cleanPath
                : path.resolve(serverRootDir, cleanPath);
            try {
                if (!fs.existsSync(resolved)) {
                    fs.mkdirSync(resolved, { recursive: true });
                }
            }
            catch (err) {
                throw new Error(`Gagal membuat direktori penyimpanan '${cleanPath}': ${err.message}`);
            }
        }
        if (input.show_logo_in_signin_page !== undefined) {
            const val = input.show_logo_in_signin_page === true || input.show_logo_in_signin_page === 'yes'
                ? 'yes'
                : 'no';
            updates.push(['show_logo_in_signin_page', val]);
        }
        if (input.show_background_image_in_signin_page !== undefined) {
            const val = input.show_background_image_in_signin_page === true ||
                input.show_background_image_in_signin_page === 'yes'
                ? 'yes'
                : 'no';
            updates.push(['show_background_image_in_signin_page', val]);
        }
        for (const [name, value] of updates) {
            await this.upsertSetting(name, value);
        }
        return this.getPlatformSettings();
    }
}
export const settingsService = new SettingsService();
