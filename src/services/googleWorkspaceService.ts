import { pool, table } from '../config/database.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { decodeCiId, encodeCiId, stripHtml, toIsoUtc } from '../utils/ciHelpers.js';

export type GoogleServiceType = 'drive' | 'docs' | 'sheets' | 'meet' | 'calendar';

export class GoogleWorkspaceService {
  private async getSettingsTableMap(tableName: string): Promise<Record<string, string>> {
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_name, setting_value FROM ${table(tableName)} WHERE deleted = 0`
      );
      const map: Record<string, string> = {};
      for (const r of rows) {
        map[r.setting_name] = r.setting_value ?? '';
      }
      return map;
    } catch {
      return {};
    }
  }

  private async tryRefreshToken(
    clientId: string,
    clientSecret: string,
    tokenJsonStr: string
  ): Promise<{ valid: boolean; accessToken?: string; updatedJson?: string; error?: string }> {
    if (!clientId || !clientSecret || !tokenJsonStr) {
      return { valid: false, error: 'Missing credentials' };
    }

    let tokenObj: any;
    try {
      tokenObj = JSON.parse(tokenJsonStr);
    } catch {
      return { valid: false, error: 'Invalid token JSON' };
    }

    if (!tokenObj.refresh_token && !tokenObj.access_token) {
      return { valid: false, error: 'No refresh_token or access_token' };
    }

    if (tokenObj.refresh_token) {
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: tokenObj.refresh_token,
            grant_type: 'refresh_token',
          }),
        });
        const data: any = await res.json();
        if (res.ok && data.access_token) {
          const updated = {
            ...tokenObj,
            access_token: data.access_token,
            expires_in: data.expires_in || 3599,
            created: Math.floor(Date.now() / 1000),
          };
          return {
            valid: true,
            accessToken: data.access_token,
            updatedJson: JSON.stringify(updated),
          };
        }
        return {
          valid: false,
          error: data.error_description || data.error || 'Token expired or revoked',
        };
      } catch (err: any) {
        return { valid: false, error: err.message };
      }
    }

    return { valid: false, error: 'Token expired' };
  }

  /**
   * Returns complete status of all 5 Google integrations in PAAS
   */
  async getIntegrationStatus(baseUrl: string) {
    const mainSettings = await this.getSettingsTableMap('settings');
    const docsSettings = await this.getSettingsTableMap('google_docs_integration_settings');
    const sheetsSettings = await this.getSettingsTableMap('google_sheets_integration_settings');
    const meetSettings = await this.getSettingsTableMap('google_meet_integration_settings');

    // Count items in DB
    const [[docsCount]]: any = await pool.query(
      `SELECT COUNT(*) as total FROM ${table('google_docs')} WHERE deleted = 0`
    );
    const [[sheetsCount]]: any = await pool.query(
      `SELECT COUNT(*) as total FROM ${table('google_sheets')} WHERE deleted = 0`
    );
    const [[meetsCount]]: any = await pool.query(
      `SELECT COUNT(*) as total FROM ${table('google_meet_meetings')} WHERE deleted = 0`
    );
    const [[driveFilesCount]]: any = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM ${table('general_files')} WHERE service_type = 'google' AND deleted = 0) +
        (SELECT COUNT(*) FROM ${table('project_files')} WHERE service_type = 'google' AND deleted = 0) AS total`
    );

    const driveClientSecret = decodeCiId(
      mainSettings.google_drive_client_secret || '',
      'google_drive_client_secret'
    );
    const driveTokenJson = decodeCiId(
      mainSettings.google_drive_oauth_access_token || '',
      'google_drive_oauth_access_token'
    );
    const driveStatus = await this.tryRefreshToken(
      mainSettings.google_drive_client_id || '',
      driveClientSecret,
      driveTokenJson
    );

    const docsStatus = await this.tryRefreshToken(
      docsSettings.google_docs_client_id || '',
      docsSettings.google_docs_client_secret || '',
      docsSettings.google_docs_oauth_access_token || ''
    );

    const sheetsStatus = await this.tryRefreshToken(
      sheetsSettings.google_sheets_client_id || '',
      sheetsSettings.google_sheets_client_secret || '',
      sheetsSettings.google_sheets_oauth_access_token || ''
    );

    const meetStatus = await this.tryRefreshToken(
      meetSettings.google_client_id || '',
      meetSettings.google_client_secret || '',
      meetSettings.oauth_access_token || ''
    );

    return {
      drive: {
        enabled: mainSettings.enable_google_drive_api_to_upload_file === '1',
        authorized_in_db: mainSettings.google_drive_authorized === '1',
        token_active: driveStatus.valid || docsStatus.valid || sheetsStatus.valid,
        status_message: driveStatus.valid
          ? 'Connected & Active'
          : driveStatus.error || 'Needs Re-authorization (OAuth Testing 7-day limit)',
        parent_folder_id: mainSettings.google_drive_parent_folder_id || null,
        total_cloud_files: Number(driveFilesCount?.total || 0),
        oauth_url: `${baseUrl}/api/v1/google/oauth/url?service=drive`,
      },
      docs: {
        enabled: docsSettings.integrate_google_docs === '1',
        authorized_in_db: docsSettings.google_docs_authorized === '1',
        token_active: docsStatus.valid,
        status_message: docsStatus.valid
          ? 'Connected & Active'
          : docsStatus.error || 'Needs Re-authorization',
        total_items: Number(docsCount?.total || 0),
        oauth_url: `${baseUrl}/api/v1/google/oauth/url?service=docs`,
      },
      sheets: {
        enabled: sheetsSettings.integrate_google_sheets === '1',
        authorized_in_db: sheetsSettings.google_sheets_authorized === '1',
        token_active: sheetsStatus.valid,
        status_message: sheetsStatus.valid
          ? 'Connected & Active'
          : sheetsStatus.error || 'Needs Re-authorization',
        total_items: Number(sheetsCount?.total || 0),
        oauth_url: `${baseUrl}/api/v1/google/oauth/url?service=sheets`,
      },
      meet: {
        enabled: meetSettings.integrate_google_meet === '1',
        authorized_in_db: meetSettings.google_meet_authorized === '1',
        token_active: meetStatus.valid,
        status_message: meetStatus.valid
          ? 'Connected & Active'
          : meetStatus.error || 'Needs Re-authorization',
        total_items: Number(meetsCount?.total || 0),
        oauth_url: `${baseUrl}/api/v1/google/oauth/url?service=meet`,
      },
    };
  }

  /**
   * Generates the Google OAuth2 authorization URL for a service
   */
  async getOAuthConsentUrl(service: GoogleServiceType, redirectUri: string): Promise<string> {
    const mainSettings = await this.getSettingsTableMap('settings');
    const docsSettings = await this.getSettingsTableMap('google_docs_integration_settings');
    const sheetsSettings = await this.getSettingsTableMap('google_sheets_integration_settings');
    const meetSettings = await this.getSettingsTableMap('google_meet_integration_settings');

    let clientId = '';
    let scopes: string[] = [];

    switch (service) {
      case 'drive':
        clientId = mainSettings.google_drive_client_id || '';
        scopes = ['https://www.googleapis.com/auth/drive'];
        break;
      case 'docs':
        clientId = docsSettings.google_docs_client_id || '';
        scopes = [
          'https://www.googleapis.com/auth/documents',
          'https://www.googleapis.com/auth/drive',
        ];
        break;
      case 'sheets':
        clientId = sheetsSettings.google_sheets_client_id || '';
        scopes = [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/drive',
        ];
        break;
      case 'meet':
      case 'calendar':
        clientId =
          meetSettings.google_client_id || mainSettings.google_calendar_client_id || '';
        scopes = ['https://www.googleapis.com/auth/calendar'];
        break;
    }

    if (!clientId) {
      throw new Error(`Client ID untuk layanan Google (${service}) belum diatur di database.`);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'select_account consent',
      state: service,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchanges OAuth2 code and saves the token back to PAAS database
   */
  async handleOAuthCallback(service: GoogleServiceType, code: string, redirectUri: string) {
    const mainSettings = await this.getSettingsTableMap('settings');
    const docsSettings = await this.getSettingsTableMap('google_docs_integration_settings');
    const sheetsSettings = await this.getSettingsTableMap('google_sheets_integration_settings');
    const meetSettings = await this.getSettingsTableMap('google_meet_integration_settings');

    let clientId = '';
    let clientSecret = '';

    switch (service) {
      case 'drive':
        clientId = mainSettings.google_drive_client_id || '';
        clientSecret = decodeCiId(
          mainSettings.google_drive_client_secret || '',
          'google_drive_client_secret'
        );
        break;
      case 'docs':
        clientId = docsSettings.google_docs_client_id || '';
        clientSecret = docsSettings.google_docs_client_secret || '';
        break;
      case 'sheets':
        clientId = sheetsSettings.google_sheets_client_id || '';
        clientSecret = sheetsSettings.google_sheets_client_secret || '';
        break;
      case 'meet':
      case 'calendar':
        clientId = meetSettings.google_client_id || '';
        clientSecret = meetSettings.google_client_secret || '';
        break;
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData: any = await res.json();
    if (!res.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Failed to exchange code');
    }

    const tokenPayload = JSON.stringify({
      ...tokenData,
      created: Math.floor(Date.now() / 1000),
    });

    if (service === 'drive') {
      const encrypted = encodeCiId(tokenPayload, 'google_drive_oauth_access_token');
      await pool.query(
        `UPDATE ${table('settings')} SET setting_value = ? WHERE setting_name = 'google_drive_oauth_access_token'`,
        [encrypted]
      );
      await pool.query(
        `UPDATE ${table('settings')} SET setting_value = '1' WHERE setting_name = 'google_drive_authorized'`
      );
    } else if (service === 'docs') {
      await pool.query(
        `UPDATE ${table('google_docs_integration_settings')} SET setting_value = ? WHERE setting_name = 'google_docs_oauth_access_token'`,
        [tokenPayload]
      );
      await pool.query(
        `UPDATE ${table('google_docs_integration_settings')} SET setting_value = '1' WHERE setting_name = 'google_docs_authorized'`
      );
    } else if (service === 'sheets') {
      await pool.query(
        `UPDATE ${table('google_sheets_integration_settings')} SET setting_value = ? WHERE setting_name = 'google_sheets_oauth_access_token'`,
        [tokenPayload]
      );
      await pool.query(
        `UPDATE ${table('google_sheets_integration_settings')} SET setting_value = '1' WHERE setting_name = 'google_sheets_authorized'`
      );
    } else if (service === 'meet' || service === 'calendar') {
      await pool.query(
        `UPDATE ${table('google_meet_integration_settings')} SET setting_value = ? WHERE setting_name = 'oauth_access_token'`,
        [tokenPayload]
      );
      await pool.query(
        `UPDATE ${table('google_meet_integration_settings')} SET setting_value = '1' WHERE setting_name = 'google_meet_authorized'`
      );
    }

    return { service, authorized: true };
  }

  /**
   * Lists Google Docs from permana_google_docs
   */
  async getGoogleDocs(userId: number, isAdmin: boolean) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT d.id, d.title, d.description, d.created_by, d.share_with_team_members,
              d.share_with_client_contacts, d.google_document_id,
              CONCAT(u.first_name, ' ', u.last_name) AS creator_name
       FROM ${table('google_docs')} d
       LEFT JOIN ${table('users')} u ON u.id = d.created_by
       WHERE d.deleted = 0
       ORDER BY d.id DESC`
    );

    return rows
      .filter((r) => {
        if (isAdmin || r.created_by === userId) return true;
        const share = String(r.share_with_team_members || '');
        return share === 'all' || share.split(',').includes(`member:${userId}`);
      })
      .map((r) => ({
        id: r.id,
        title: r.title,
        description: stripHtml(r.description),
        created_by: r.created_by,
        creator_name: r.creator_name || 'Team Member',
        share_with_team_members: r.share_with_team_members,
        google_document_id: r.google_document_id,
        open_url: r.google_document_id?.startsWith('http')
          ? r.google_document_id
          : `https://docs.google.com/document/d/${r.google_document_id}/edit`,
      }));
  }

  async createGoogleDoc(
    userId: number,
    input: { title: string; description?: string; google_document_id?: string; share_with?: string }
  ) {
    let docId = input.google_document_id?.trim() || '';
    // Extract document ID if full URL was pasted
    const urlMatch = docId.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      docId = urlMatch[1];
    }

    // If no docId provided, try creating via Google Docs OAuth if active
    if (!docId) {
      const docsSettings = await this.getSettingsTableMap('google_docs_integration_settings');
      const tokenCheck = await this.tryRefreshToken(
        docsSettings.google_docs_client_id || '',
        docsSettings.google_docs_client_secret || '',
        docsSettings.google_docs_oauth_access_token || ''
      );
      if (tokenCheck.valid && tokenCheck.accessToken) {
        try {
          const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenCheck.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ title: input.title }),
          });
          if (createRes.ok) {
            const createdDoc: any = await createRes.json();
            if (createdDoc.documentId) {
              docId = createdDoc.documentId;
              // Make public writer like PAAS _make_document_public
              await fetch(
                `https://www.googleapis.com/drive/v3/files/${docId}/permissions`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${tokenCheck.accessToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ type: 'anyone', role: 'writer' }),
                }
              ).catch(() => {});
            }
          }
        } catch {
          // Fallback below
        }
      }
    }

    if (!docId) {
      docId = `doc_${Date.now()}`;
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${table('google_docs')}
       (title, description, created_by, share_with_team_members, share_with_client_contacts, google_document_id, deleted)
       VALUES (?, ?, ?, ?, 'all', ?, 0)`,
      [
        input.title.trim(),
        input.description ? `<p>${input.description.trim()}</p>` : '',
        userId,
        input.share_with || 'all',
        docId,
      ]
    );

    return {
      id: result.insertId,
      title: input.title.trim(),
      description: input.description || '',
      google_document_id: docId,
      open_url: `https://docs.google.com/document/d/${docId}/edit`,
    };
  }

  /**
   * Lists Google Sheets from permana_google_sheets
   */
  async getGoogleSheets(userId: number, isAdmin: boolean) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.title, s.description, s.created_by, s.share_with_team_members,
              s.share_with_client_contacts, s.google_spreadsheet_id,
              CONCAT(u.first_name, ' ', u.last_name) AS creator_name
       FROM ${table('google_sheets')} s
       LEFT JOIN ${table('users')} u ON u.id = s.created_by
       WHERE s.deleted = 0
       ORDER BY s.id DESC`
    );

    return rows
      .filter((r) => {
        if (isAdmin || r.created_by === userId) return true;
        const share = String(r.share_with_team_members || '');
        return share === 'all' || share.split(',').includes(`member:${userId}`);
      })
      .map((r) => ({
        id: r.id,
        title: r.title,
        description: stripHtml(r.description),
        created_by: r.created_by,
        creator_name: r.creator_name || 'Team Member',
        share_with_team_members: r.share_with_team_members,
        google_spreadsheet_id: r.google_spreadsheet_id,
        open_url: r.google_spreadsheet_id?.startsWith('http')
          ? r.google_spreadsheet_id
          : `https://docs.google.com/spreadsheets/d/${r.google_spreadsheet_id}/edit`,
      }));
  }

  async createGoogleSheet(
    userId: number,
    input: { title: string; description?: string; google_spreadsheet_id?: string; share_with?: string }
  ) {
    let sheetId = input.google_spreadsheet_id?.trim() || '';
    const urlMatch = sheetId.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) {
      sheetId = urlMatch[1];
    }

    if (!sheetId) {
      const sheetsSettings = await this.getSettingsTableMap('google_sheets_integration_settings');
      const tokenCheck = await this.tryRefreshToken(
        sheetsSettings.google_sheets_client_id || '',
        sheetsSettings.google_sheets_client_secret || '',
        sheetsSettings.google_sheets_oauth_access_token || ''
      );
      if (tokenCheck.valid && tokenCheck.accessToken) {
        try {
          const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${tokenCheck.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ properties: { title: input.title } }),
          });
          if (createRes.ok) {
            const createdSheet: any = await createRes.json();
            if (createdSheet.spreadsheetId) {
              sheetId = createdSheet.spreadsheetId;
              await fetch(
                `https://www.googleapis.com/drive/v3/files/${sheetId}/permissions`,
                {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${tokenCheck.accessToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ type: 'anyone', role: 'writer' }),
                }
              ).catch(() => {});
            }
          }
        } catch {
          // Fallback below
        }
      }
    }

    if (!sheetId) {
      sheetId = `sheet_${Date.now()}`;
    }

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${table('google_sheets')}
       (title, description, created_by, share_with_team_members, share_with_client_contacts, google_spreadsheet_id, deleted)
       VALUES (?, ?, ?, ?, 'all', ?, 0)`,
      [
        input.title.trim(),
        input.description ? `<p>${input.description.trim()}</p>` : '',
        userId,
        input.share_with || 'all',
        sheetId,
      ]
    );

    return {
      id: result.insertId,
      title: input.title.trim(),
      description: input.description || '',
      google_spreadsheet_id: sheetId,
      open_url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit`,
    };
  }

  /**
   * Lists Google Meet meetings from permana_google_meet_meetings
   */
  async getGoogleMeets(userId: number, isAdmin: boolean) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT m.id, m.title, m.description, m.start_time, m.created_by,
              m.share_with_team_members, m.share_with_client_contacts,
              m.google_event_id, m.join_url,
              CONCAT(u.first_name, ' ', u.last_name) AS creator_name
       FROM ${table('google_meet_meetings')} m
       LEFT JOIN ${table('users')} u ON u.id = m.created_by
       WHERE m.deleted = 0
       ORDER BY m.start_time DESC, m.id DESC`
    );

    return rows
      .filter((r) => {
        if (isAdmin || r.created_by === userId) return true;
        const share = String(r.share_with_team_members || '');
        return share === 'all' || share.split(',').includes(`member:${userId}`);
      })
      .map((r) => ({
        id: r.id,
        title: r.title,
        description: stripHtml(r.description),
        start_time: toIsoUtc(r.start_time) || r.start_time,
        created_by: r.created_by,
        creator_name: r.creator_name || 'Team Member',
        google_event_id: r.google_event_id,
        join_url: r.join_url,
      }));
  }

  async createGoogleMeet(
    userId: number,
    input: { title: string; description?: string; start_time: string; join_url?: string }
  ) {
    const joinUrl = input.join_url?.trim() || 'https://meet.google.com/new';
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${table('google_meet_meetings')}
       (title, description, start_time, created_by, share_with_team_members, share_with_client_contacts, google_event_id, join_url, deleted)
       VALUES (?, ?, ?, ?, 'all', 'all', ?, ?, 0)`,
      [
        input.title.trim(),
        input.description ? `<p>${input.description.trim()}</p>` : '',
        input.start_time,
        userId,
        `evt_${Date.now()}`,
        joinUrl,
      ]
    );

    return {
      id: result.insertId,
      title: input.title.trim(),
      description: input.description || '',
      start_time: input.start_time,
      join_url: joinUrl,
    };
  }
}

export const googleWorkspaceService = new GoogleWorkspaceService();
