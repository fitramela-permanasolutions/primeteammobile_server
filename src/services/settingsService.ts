import { pool, table } from '../config/database.js';
import { RowDataPacket } from 'mysql2';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parsePhpSerializedArray, resolveCiFile } from '../utils/ciHelpers.js';
import { googleDriveService } from './googleDriveService.js';
import { pusherService } from './pusherService.js';
import { invalidateCloudflarePolicyCache } from '../middlewares/cloudflareMiddleware.js';

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
      'web_app_url',
      'prevent_screenshot',
      'cloudflare_enabled',
      'cloudflare_proxy_secret',
      'cloudflare_turnstile_site_key',
      'cloudflare_turnstile_secret_key',
      'allow_rooted_device',
      'mobile_session_timeout_hours',
      'show_web_portal_url',
      'project_terminology',
      'enable_push_notification',
      'enable_chat_via_pusher',
      'pusher_app_id',
      'pusher_key',
      'pusher_cluster',
      'max_upload_size',
      'max_file_size',
      'show_todo',
      'show_kanban',
      'show_attendance',
      'google_oauth_client_id',
      'google_drive_client_id',
    ];

    const placeholders = keys.map(() => '?').join(', ');
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT setting_name, setting_value
       FROM ${table('settings')}
       WHERE setting_name IN (${placeholders}) AND deleted = 0`,
      keys
    );

    const map: Record<string, string> = {};
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
      const [aaRows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_name, setting_value FROM ${table('auto_attendance_settings')} WHERE deleted = 0`
      );
      const aaMap: Record<string, string> = {};
      for (const r of aaRows) aaMap[r.setting_name] = r.setting_value ?? '';
      autoAttendance = {
        auto_clock_in_on_signin: aaMap.auto_clock_in_on_signin === '1',
        auto_clock_out_after: Number(aaMap.auto_clock_out_after || 12),
        auto_clock_out_on_signout: aaMap.auto_clock_out_on_signout === '1',
      };
    } catch {
      // Ignore if table doesn't exist
    }

    // Fetch Google Docs, Sheets, Meet integration flags
    let googleDocsEnabled = false;
    let googleSheetsEnabled = false;
    let googleMeetEnabled = false;
    try {
      const [gdRows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_name, setting_value FROM ${table('google_docs_integration_settings')} WHERE deleted = 0`
      );
      const gdMap: Record<string, string> = {};
      for (const r of gdRows) gdMap[r.setting_name] = r.setting_value ?? '';
      googleDocsEnabled =
        gdMap.integrate_google_docs === '1' && gdMap.google_docs_authorized === '1';

      const [gsRows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_name, setting_value FROM ${table('google_sheets_integration_settings')} WHERE deleted = 0`
      );
      const gsMap: Record<string, string> = {};
      for (const r of gsRows) gsMap[r.setting_name] = r.setting_value ?? '';
      googleSheetsEnabled =
        gsMap.integrate_google_sheets === '1' && gsMap.google_sheets_authorized === '1';

      const [gmRows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_name, setting_value FROM ${table('google_meet_integration_settings')} WHERE deleted = 0`
      );
      const gmMap: Record<string, string> = {};
      for (const r of gmRows) gmMap[r.setting_name] = r.setting_value ?? '';
      googleMeetEnabled =
        gmMap.integrate_google_meet === '1' && gmMap.google_meet_authorized === '1';
    } catch {
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
    const primaryColor =
      rawThemeColor.toUpperCase() === 'F2F2F2' ? pwaThemeColor : `#${rawThemeColor}`;

    const siteLogo = resolveCiFile(map.site_logo, 'system', false);
    const favicon = resolveCiFile(map.favicon, 'system', false);
    const signinBg = resolveCiFile(map.signin_page_background, 'system', true);
    const pwaIcon = resolveCiFile(map.pwa_icon, 'system', false);

    const parsedPlugins = parsePhpSerializedArray(map.plugins || '') || {};
    const uploadDocPath = (map.upload_doc_path || defaultUploadDocPath).trim();
    const webAppUrl = (map.web_app_url || 'https://indodefence.net').trim().replace(/\/+$/, '');
    const maxUploadSize = Math.max(
      1,
      Number(map.max_upload_size || map.max_file_size || 25) || 25
    );
    const sessionTimeoutHours = Math.max(
      1,
      Number(map.mobile_session_timeout_hours || 168) || 168
    );

    return {
      app_title: map.app_title || 'Indodefence ( IDD )',
      web_app_url: webAppUrl,
      show_web_portal_url: map.show_web_portal_url !== '0',
      prevent_screenshot: map.prevent_screenshot === '1',
      cloudflare_enabled: map.cloudflare_enabled === '1',
      cloudflare_turnstile_site_key: (map.cloudflare_turnstile_site_key || '').trim(),
      allow_rooted_device: map.allow_rooted_device !== '0',
      mobile_session_timeout_hours: sessionTimeoutHours,
      project_terminology: map.project_terminology === 'department' ? 'department' : 'project',
      enable_push_notification: map.enable_push_notification === '1',
      enable_chat_via_pusher: map.enable_chat_via_pusher !== '0',
      pusher_key: (map.pusher_key || '').trim(),
      pusher_cluster: (map.pusher_cluster || 'ap1').trim(),
      max_upload_size: maxUploadSize,
      show_todo: map.show_todo !== '0',
      show_kanban: map.show_kanban !== '0',
      show_attendance: map.show_attendance !== '0',
      google_oauth_client_id: (
        map.google_oauth_client_id ||
        process.env.GOOGLE_CLIENT_ID ||
        map.google_drive_client_id ||
        ''
      ).trim(),
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
      accepted_file_formats:
        map.accepted_file_formats || 'jpg,jpeg,png,doc,xlsx,txt,pdf,zip,webm,gif,docx,mp4',
      rows_per_page: Number(map.rows_per_page || 10),
      show_in_kanban: (map.show_in_kanban || 'project_name,client_name').split(',').filter(Boolean),
      show_the_status_checkbox_in_tasks_list: map.show_the_status_checkbox_in_tasks_list === '1',
      show_time_with_task_start_date_and_deadline:
        map.show_time_with_task_start_date_and_deadline === '1',
      project_tab_order: (
        map.project_tab_order || 'overview,tasks_kanban,milestones,tasks_list,notes,files,comments'
      )
        .split(',')
        .filter(Boolean),
      google_drive_enabled:
        map.enable_google_drive_api_to_upload_file === '1' && map.google_drive_authorized === '1',
      google_calendar_enabled:
        map.enable_google_calendar_api === '1' && map.google_calendar_authorized === '1',
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

  async getUploadDocPath(): Promise<string> {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_value FROM ${table('settings')} WHERE setting_name = 'upload_doc_path' AND deleted = 0 LIMIT 1`
      );
      if (rows.length > 0 && rows[0].setting_value && String(rows[0].setting_value).trim()) {
        return String(rows[0].setting_value).trim();
      }
    } catch {
      // Fallback to default on DB error
    }
    return defaultUploadDocPath;
  }

  async getResolvedUploadBaseDir(): Promise<string> {
    const configuredPath = await this.getUploadDocPath();
    const envUploadDir = process.env.UPLOAD_DIR ? process.env.UPLOAD_DIR.trim() : '';

    // If Docker/server env defines UPLOAD_DIR (e.g., /var/www/html/files) and it exists on disk,
    // prefer envUploadDir whenever DB holds a relative path or a non-existent host path,
    // so shared container volumes stay 100% synchronized with the CodeIgniter web app.
    const isRelative = !path.isAbsolute(configuredPath);
    const configuredExists = path.isAbsolute(configuredPath) && fs.existsSync(configuredPath);
    const shouldPreferEnv = Boolean(
      envUploadDir && (fs.existsSync(envUploadDir) || isRelative) && (isRelative || !configuredExists)
    );

    const effectivePath = shouldPreferEnv ? envUploadDir : configuredPath;

    const resolved = path.isAbsolute(effectivePath)
      ? effectivePath
      : path.resolve(serverRootDir, effectivePath);
    try {
      if (!fs.existsSync(resolved)) {
        fs.mkdirSync(resolved, { recursive: true, mode: 0o775 });
      }
      fs.chmodSync(resolved, 0o775);
    } catch {
      // Fallback to UPLOAD_DIR or default paas/files if configured path cannot be created
      const fallback = envUploadDir || path.resolve(serverRootDir, '../paas/files');
      try {
        if (!fs.existsSync(fallback)) {
          fs.mkdirSync(fallback, { recursive: true, mode: 0o775 });
        }
        fs.chmodSync(fallback, 0o775);
      } catch {
        // ignore chmod error
      }
      return fallback;
    }
    return resolved;
  }

  private async upsertSetting(name: string, value: string): Promise<void> {
    const [existing]: any = await pool.query(
      `SELECT setting_name FROM ${table('settings')} WHERE setting_name = ? LIMIT 1`,
      [name]
    );
    if (existing && existing.length > 0) {
      await pool.query(
        `UPDATE ${table('settings')}
         SET setting_value = ?, deleted = 0
         WHERE setting_name = ?`,
        [value, name]
      );
    } else {
      await pool.query(
        `INSERT INTO ${table('settings')} (setting_name, setting_value, type, deleted)
         VALUES (?, ?, 'app', 0)`,
        [name, value]
      );
    }
  }

  private buildPhpSerializedFile(fileName: string, fileId?: string | null, serviceType?: string | null): string {
    const fn = fileName || '';
    const fid = fileId || '';
    const st = serviceType || '';
    if (st === 'google' && fid) {
      return `a:3:{s:9:"file_name";s:${Buffer.byteLength(fn)}:"${fn}";s:7:"file_id";s:${Buffer.byteLength(fid)}:"${fid}";s:12:"service_type";s:6:"google";}`;
    }
    return `a:1:{s:9:"file_name";s:${Buffer.byteLength(fn)}:"${fn}";}`;
  }

  async uploadSiteLogo(file: Express.Multer.File) {
    try {
      fs.chmodSync(file.path, 0o664);
    } catch {
      // ignore chmod error
    }
    const driveRes = await googleDriveService.uploadFile(
      file.path,
      file.filename,
      file.mimetype,
      'system'
    );
    const serialized = this.buildPhpSerializedFile(
      file.filename,
      driveRes?.file_id || null,
      driveRes?.service_type || null
    );
    await this.upsertSetting('site_logo', serialized);
    await this.upsertSetting('show_logo_in_signin_page', 'yes');
    return this.getPlatformSettings();
  }

  async uploadSigninBackground(file: Express.Multer.File) {
    try {
      fs.chmodSync(file.path, 0o664);
    } catch {
      // ignore chmod error
    }
    const driveRes = await googleDriveService.uploadFile(
      file.path,
      file.filename,
      file.mimetype,
      'system'
    );
    const serialized = this.buildPhpSerializedFile(
      file.filename,
      driveRes?.file_id || null,
      driveRes?.service_type || null
    );
    await this.upsertSetting('signin_page_background', serialized);
    await this.upsertSetting('show_background_image_in_signin_page', 'yes');
    return this.getPlatformSettings();
  }

  async getAdminSecrets() {
    const keys = [
      'cloudflare_enabled',
      'cloudflare_proxy_secret',
      'cloudflare_turnstile_site_key',
      'cloudflare_turnstile_secret_key',
      'enable_push_notification',
      'enable_chat_via_pusher',
      'pusher_app_id',
      'pusher_key',
      'pusher_secret',
      'pusher_cluster',
      'google_oauth_client_id',
    ];
    const placeholders = keys.map(() => '?').join(', ');
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT setting_name, setting_value
       FROM ${table('settings')}
       WHERE setting_name IN (${placeholders}) AND deleted = 0`,
      keys
    );
    const map: Record<string, string> = {};
    for (const r of rows) map[r.setting_name] = r.setting_value ?? '';
    return {
      cloudflare_enabled: map.cloudflare_enabled === '1',
      cloudflare_proxy_secret: map.cloudflare_proxy_secret || '',
      cloudflare_turnstile_site_key: map.cloudflare_turnstile_site_key || '',
      cloudflare_turnstile_secret_key: map.cloudflare_turnstile_secret_key || '',
      enable_push_notification: map.enable_push_notification === '1',
      enable_chat_via_pusher: map.enable_chat_via_pusher !== '0',
      pusher_app_id: map.pusher_app_id || '',
      pusher_key: map.pusher_key || '',
      pusher_secret: map.pusher_secret || '',
      pusher_cluster: map.pusher_cluster || 'ap1',
      google_oauth_client_id: map.google_oauth_client_id || process.env.GOOGLE_CLIENT_ID || '',
    };
  }

  async getMaxUploadSizeBytes(): Promise<number> {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_value FROM ${table('settings')}
         WHERE setting_name IN ('max_upload_size', 'max_file_size') AND deleted = 0
         ORDER BY FIELD(setting_name, 'max_upload_size', 'max_file_size') ASC LIMIT 1`
      );
      const mb = Math.max(1, Number(rows[0]?.setting_value || 25) || 25);
      return mb * 1024 * 1024;
    } catch {
      return 25 * 1024 * 1024;
    }
  }

  async getMobileSessionTimeoutHours(): Promise<number> {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_value FROM ${table('settings')}
         WHERE setting_name = 'mobile_session_timeout_hours' AND deleted = 0 LIMIT 1`
      );
      return Math.max(1, Number(rows[0]?.setting_value || 168) || 168);
    } catch {
      return 168;
    }
  }

  async updatePlatformSettings(input: {
    default_theme_color?: string;
    pwa_theme_color?: string;
    app_title?: string;
    footer_copyright_text?: string;
    upload_doc_path?: string;
    web_app_url?: string;
    show_web_portal_url?: boolean | string;
    prevent_screenshot?: boolean | string;
    cloudflare_enabled?: boolean | string;
    cloudflare_proxy_secret?: string;
    cloudflare_turnstile_site_key?: string;
    cloudflare_turnstile_secret_key?: string;
    allow_rooted_device?: boolean | string;
    mobile_session_timeout_hours?: number | string;
    project_terminology?: string;
    enable_push_notification?: boolean | string;
    enable_chat_via_pusher?: boolean | string;
    pusher_app_id?: string;
    pusher_key?: string;
    pusher_secret?: string;
    pusher_cluster?: string;
    max_upload_size?: number | string;
    show_todo?: boolean | string;
    show_kanban?: boolean | string;
    show_attendance?: boolean | string;
    google_oauth_client_id?: string;
    show_logo_in_signin_page?: boolean | string;
    show_background_image_in_signin_page?: boolean | string;
  }) {
    const updates: Array<[string, string]> = [];
    const toBit = (v: boolean | string) =>
      v === true || v === '1' || v === 'yes' || v === 'true' ? '1' : '0';

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
    if (input.web_app_url !== undefined && input.web_app_url.trim()) {
      let cleanWebUrl = input.web_app_url.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(cleanWebUrl)) {
        cleanWebUrl = `https://${cleanWebUrl}`;
      }
      updates.push(['web_app_url', cleanWebUrl]);
    }
    if (input.show_web_portal_url !== undefined) {
      updates.push(['show_web_portal_url', toBit(input.show_web_portal_url)]);
    }
    if (input.prevent_screenshot !== undefined) {
      updates.push(['prevent_screenshot', toBit(input.prevent_screenshot)]);
    }
    if (input.cloudflare_enabled !== undefined) {
      updates.push(['cloudflare_enabled', toBit(input.cloudflare_enabled)]);
    }
    if (input.cloudflare_proxy_secret !== undefined) {
      updates.push(['cloudflare_proxy_secret', String(input.cloudflare_proxy_secret).trim()]);
    }
    if (input.cloudflare_turnstile_site_key !== undefined) {
      updates.push(['cloudflare_turnstile_site_key', String(input.cloudflare_turnstile_site_key).trim()]);
    }
    if (input.cloudflare_turnstile_secret_key !== undefined) {
      updates.push(['cloudflare_turnstile_secret_key', String(input.cloudflare_turnstile_secret_key).trim()]);
    }
    if (input.allow_rooted_device !== undefined) {
      updates.push(['allow_rooted_device', toBit(input.allow_rooted_device)]);
    }
    if (input.mobile_session_timeout_hours !== undefined) {
      const hours = Math.max(1, Math.min(8760, Number(input.mobile_session_timeout_hours) || 168));
      updates.push(['mobile_session_timeout_hours', String(hours)]);
    }
    if (input.project_terminology !== undefined) {
      const mode = input.project_terminology === 'department' ? 'department' : 'project';
      updates.push(['project_terminology', mode]);
    }
    if (input.enable_push_notification !== undefined) {
      updates.push(['enable_push_notification', toBit(input.enable_push_notification)]);
    }
    if (input.enable_chat_via_pusher !== undefined) {
      updates.push(['enable_chat_via_pusher', toBit(input.enable_chat_via_pusher)]);
    }
    if (input.pusher_app_id !== undefined) {
      updates.push(['pusher_app_id', String(input.pusher_app_id).trim()]);
    }
    if (input.pusher_key !== undefined) {
      updates.push(['pusher_key', String(input.pusher_key).trim()]);
    }
    if (input.pusher_secret !== undefined) {
      updates.push(['pusher_secret', String(input.pusher_secret).trim()]);
    }
    if (input.pusher_cluster !== undefined && String(input.pusher_cluster).trim()) {
      updates.push(['pusher_cluster', String(input.pusher_cluster).trim()]);
    }
    if (input.max_upload_size !== undefined) {
      const mb = Math.max(1, Math.min(500, Number(input.max_upload_size) || 25));
      updates.push(['max_upload_size', String(mb)]);
    }
    if (input.show_todo !== undefined) {
      updates.push(['show_todo', toBit(input.show_todo)]);
    }
    if (input.show_kanban !== undefined) {
      updates.push(['show_kanban', toBit(input.show_kanban)]);
    }
    if (input.show_attendance !== undefined) {
      updates.push(['show_attendance', toBit(input.show_attendance)]);
    }
    if (input.google_oauth_client_id !== undefined) {
      updates.push(['google_oauth_client_id', String(input.google_oauth_client_id).trim()]);
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
      } catch (err: any) {
        throw new Error(`Gagal membuat direktori penyimpanan '${cleanPath}': ${err.message}`);
      }
    }
    if (input.show_logo_in_signin_page !== undefined) {
      const val =
        input.show_logo_in_signin_page === true || input.show_logo_in_signin_page === 'yes'
          ? 'yes'
          : 'no';
      updates.push(['show_logo_in_signin_page', val]);
    }
    if (input.show_background_image_in_signin_page !== undefined) {
      const val =
        input.show_background_image_in_signin_page === true ||
        input.show_background_image_in_signin_page === 'yes'
          ? 'yes'
          : 'no';
      updates.push(['show_background_image_in_signin_page', val]);
    }

    for (const [name, value] of updates) {
      await this.upsertSetting(name, value);
    }

    pusherService.invalidateCache();
    invalidateCloudflarePolicyCache();

    return this.getPlatformSettings();
  }
}

export const settingsService = new SettingsService();
