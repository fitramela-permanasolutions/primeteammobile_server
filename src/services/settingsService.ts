import { pool, table } from '../config/database.js';
import { RowDataPacket } from 'mysql2';
import { resolveCiFile } from '../utils/ciHelpers.js';

export const PAAS_THEME_PALETTE = [
  { code: 'F2F2F2', hex: '#00628d', name: 'Default (Indodefence Blue)' },
  { code: '2471a3', hex: '#2471a3', name: 'Ocean Blue' },
  { code: '2e86c1', hex: '#2e86c1', name: 'Sky Blue' },
  { code: '5d78ff', hex: '#5d78ff', name: 'Royal Indigo' },
  { code: '557bbb', hex: '#557bbb', name: 'Steel Blue' },
  { code: '00BCD4', hex: '#00BCD4', name: 'Cyan' },
  { code: '17a589', hex: '#17a589', name: 'Emerald Teal' },
  { code: '83c340', hex: '#83c340', name: 'Fresh Green' },
  { code: 'd68910', hex: '#d68910', name: 'Amber Gold' },
  { code: 'a93226', hex: '#a93226', name: 'Crimson Red' },
  { code: '884ea0', hex: '#884ea0', name: 'Amethyst Purple' },
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
      'footer_copyright_text',
      'timezone',
      'date_format',
      'time_format',
      'currency_symbol',
      'accepted_file_formats',
      'enable_google_drive_api_to_upload_file',
      'google_drive_authorized',
      'module_attendance',
      'module_file_manager',
      'module_project_timesheet',
      'module_todo',
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

    const rawThemeColor = (map.default_theme_color || 'F2F2F2').replace(/^#/, '');
    const pwaThemeColor = map.pwa_theme_color
      ? map.pwa_theme_color.startsWith('#')
        ? map.pwa_theme_color
        : `#${map.pwa_theme_color}`
      : '#00628d';

    // In RISE CRM / PAAS, 'F2F2F2' is the default light sidebar theme whose brand color is pwa_theme_color (#00628d)
    const primaryColor =
      rawThemeColor.toUpperCase() === 'F2F2F2' ? pwaThemeColor : `#${rawThemeColor}`;

    const siteLogo = resolveCiFile(map.site_logo, 'system', false);
    const favicon = resolveCiFile(map.favicon, 'system', false);
    const signinBg = resolveCiFile(map.signin_page_background, 'system', true);
    const pwaIcon = resolveCiFile(map.pwa_icon, 'system', false);

    return {
      app_title: map.app_title || 'PrimeTeam',
      footer_copyright_text: map.footer_copyright_text || 'Permana Solutions',
      default_theme_color: rawThemeColor,
      pwa_theme_color: pwaThemeColor,
      primary_color: primaryColor,
      site_logo_url: siteLogo?.thumbnailUrl || null,
      favicon_url: favicon?.thumbnailUrl || pwaIcon?.thumbnailUrl || null,
      signin_background_url: signinBg?.thumbnailUrl || null,
      show_background_image_in_signin_page: map.show_background_image_in_signin_page === 'yes',
      show_logo_in_signin_page: map.show_logo_in_signin_page !== 'no',
      show_theme_color_changer: map.show_theme_color_changer !== 'no',
      timezone: map.timezone || 'Asia/Jakarta',
      date_format: map.date_format || 'd-m-Y',
      time_format: map.time_format || '24_hours',
      currency_symbol: map.currency_symbol || 'Rp. ',
      accepted_file_formats: map.accepted_file_formats || 'jpg,jpeg,png,pdf,doc,docx,xlsx,zip',
      google_drive_enabled:
        map.enable_google_drive_api_to_upload_file === '1' && map.google_drive_authorized === '1',
      modules: {
        attendance: map.module_attendance !== '0',
        file_manager: map.module_file_manager !== '0',
        project_timesheet: map.module_project_timesheet !== '0',
        todo: map.module_todo !== '0',
      },
      theme_palette: PAAS_THEME_PALETTE,
    };
  }

  async updatePlatformSettings(input: {
    default_theme_color?: string;
    pwa_theme_color?: string;
    app_title?: string;
  }) {
    const updates: Array<[string, string]> = [];

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
    if (input.app_title && input.app_title.trim()) {
      updates.push(['app_title', input.app_title.trim()]);
    }

    for (const [name, value] of updates) {
      await pool.query(
        `INSERT INTO ${table('settings')} (setting_name, setting_value, type, deleted)
         VALUES (?, ?, 'app', 0)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), deleted = 0`,
        [name, value]
      );
    }

    return this.getPlatformSettings();
  }
}

export const settingsService = new SettingsService();
