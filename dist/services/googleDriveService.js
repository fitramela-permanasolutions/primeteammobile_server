import fs from 'fs';
import { pool, table } from '../config/database.js';
import { decodeCiId, encodeCiId, parsePhpSerializedArray } from '../utils/ciHelpers.js';
export class GoogleDriveService {
    async getSettingsMap(keys) {
        const placeholders = keys.map(() => '?').join(', ');
        const [rows] = await pool.query(`SELECT setting_name, setting_value FROM ${table('settings')}
       WHERE setting_name IN (${placeholders}) AND deleted = 0`, keys);
        const map = {};
        for (const r of rows) {
            map[r.setting_name] = r.setting_value || '';
        }
        return map;
    }
    async saveSetting(name, value) {
        await pool.query(`INSERT INTO ${table('settings')} (setting_name, setting_value, type, deleted)
       VALUES (?, ?, 'app', 0)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), deleted = 0`, [name, value]);
    }
    /**
     * Obtains a valid Google Drive OAuth2 access token from permana_settings,
     * refreshing it automatically if needed.
     */
    async getValidAccessToken() {
        const settings = await this.getSettingsMap([
            'enable_google_drive_api_to_upload_file',
            'google_drive_authorized',
            'google_drive_client_id',
            'google_drive_client_secret',
            'google_drive_oauth_access_token',
            'google_drive_parent_folder_id',
            'google_drive_folder_ids',
        ]);
        if (settings.enable_google_drive_api_to_upload_file !== '1' ||
            settings.google_drive_authorized !== '1') {
            return null;
        }
        const clientId = settings.google_drive_client_id;
        const clientSecret = decodeCiId(settings.google_drive_client_secret, 'google_drive_client_secret');
        const rawTokenJson = decodeCiId(settings.google_drive_oauth_access_token, 'google_drive_oauth_access_token');
        if (!clientId || !clientSecret || !rawTokenJson) {
            return null;
        }
        let tokenObj;
        try {
            tokenObj = JSON.parse(rawTokenJson);
        }
        catch {
            return null;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        const createdSec = Number(tokenObj.created || 0);
        const expiresInSec = Number(tokenObj.expires_in || 3600);
        const isExpired = createdSec + expiresInSec - 120 < nowSec;
        let accessToken = tokenObj.access_token;
        if (isExpired && tokenObj.refresh_token) {
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
                if (res.ok) {
                    const refreshed = await res.json();
                    if (refreshed.access_token) {
                        accessToken = refreshed.access_token;
                        const updatedTokenObj = {
                            ...tokenObj,
                            access_token: refreshed.access_token,
                            expires_in: refreshed.expires_in || 3599,
                            created: Math.floor(Date.now() / 1000),
                        };
                        const encodedNewToken = encodeCiId(JSON.stringify(updatedTokenObj), 'google_drive_oauth_access_token');
                        await this.saveSetting('google_drive_oauth_access_token', encodedNewToken);
                    }
                }
                else {
                    // Try fallback to Google Docs or Google Sheets OAuth tokens which also have Google Drive scope
                    const fallbackToken = await this.getFallbackDriveTokenFromPlugins();
                    if (fallbackToken) {
                        accessToken = fallbackToken;
                    }
                    else {
                        return null;
                    }
                }
            }
            catch {
                return null;
            }
        }
        const folderIds = parsePhpSerializedArray(settings.google_drive_folder_ids) || {};
        return {
            accessToken,
            parentFolderId: settings.google_drive_parent_folder_id || '',
            folderIds,
        };
    }
    async getFallbackDriveTokenFromPlugins() {
        const tables = [
            {
                tableName: 'google_docs_integration_settings',
                idKey: 'google_docs_client_id',
                secretKey: 'google_docs_client_secret',
                tokenKey: 'google_docs_oauth_access_token',
            },
            {
                tableName: 'google_sheets_integration_settings',
                idKey: 'google_sheets_client_id',
                secretKey: 'google_sheets_client_secret',
                tokenKey: 'google_sheets_oauth_access_token',
            },
        ];
        for (const cfg of tables) {
            try {
                const [rows] = await pool.query(`SELECT setting_name, setting_value FROM ${table(cfg.tableName)} WHERE deleted = 0`);
                const map = {};
                for (const r of rows)
                    map[r.setting_name] = r.setting_value || '';
                const tokenObj = JSON.parse(map[cfg.tokenKey] || '{}');
                if (map[cfg.idKey] && map[cfg.secretKey] && tokenObj.refresh_token) {
                    const res = await fetch('https://oauth2.googleapis.com/token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({
                            client_id: map[cfg.idKey],
                            client_secret: map[cfg.secretKey],
                            refresh_token: tokenObj.refresh_token,
                            grant_type: 'refresh_token',
                        }),
                    });
                    if (res.ok) {
                        const refreshed = await res.json();
                        if (refreshed.access_token)
                            return refreshed.access_token;
                    }
                }
            }
            catch {
                // Continue
            }
        }
        return null;
    }
    /**
     * Ensures a target subfolder (e.g., 'project_files', 'general') exists in Google Drive
     */
    async resolveTargetFolderId(accessToken, parentFolderId, folderIds, folderName) {
        if (folderIds[folderName]) {
            return folderIds[folderName];
        }
        if (!parentFolderId) {
            return '';
        }
        try {
            const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: folderName,
                    mimeType: 'application/vnd.google-apps.folder',
                    parents: [parentFolderId],
                }),
            });
            if (createRes.ok) {
                const created = await createRes.json();
                if (created.id) {
                    return created.id;
                }
            }
        }
        catch {
            // Fallback to parentFolderId
        }
        return parentFolderId;
    }
    /**
     * Uploads a file from local path to Google Drive and sets public reader permission,
     * matching paas/app/Libraries/Google.php::upload_file
     */
    async uploadFile(localFilePath, targetFileName, mimeType, folderName = 'general') {
        try {
            const auth = await this.getValidAccessToken();
            if (!auth) {
                return null;
            }
            const folderId = await this.resolveTargetFolderId(auth.accessToken, auth.parentFolderId, auth.folderIds, folderName);
            const fileBuffer = fs.readFileSync(localFilePath);
            const boundary = '-------PrimeTeamDriveBoundary' + Date.now();
            const metadata = {
                name: targetFileName,
            };
            if (folderId) {
                metadata.parents = [folderId];
            }
            const multipartHeader = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`, 'utf8');
            const multipartFooter = Buffer.from(`\r\n--${boundary}--`, 'utf8');
            const bodyBuffer = Buffer.concat([multipartHeader, fileBuffer, multipartFooter]);
            const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${auth.accessToken}`,
                    'Content-Type': `multipart/related; boundary=${boundary}`,
                    'Content-Length': String(bodyBuffer.length),
                },
                body: bodyBuffer,
            });
            if (!uploadRes.ok) {
                return null;
            }
            const uploaded = await uploadRes.json();
            const fileId = uploaded.id;
            if (!fileId) {
                return null;
            }
            // Make file public ('anyone' -> 'reader') just like PAAS _make_file_as_public
            await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${auth.accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    type: 'anyone',
                    role: 'reader',
                }),
            }).catch(() => { });
            return {
                file_name: targetFileName,
                file_id: fileId,
                service_type: 'google',
            };
        }
        catch {
            return null;
        }
    }
}
export const googleDriveService = new GoogleDriveService();
