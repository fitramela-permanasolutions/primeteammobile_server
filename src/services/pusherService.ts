import crypto from 'crypto';
import { pool, table } from '../config/database.js';
import { RowDataPacket } from 'mysql2';

export interface PusherConfig {
  enabled: boolean;
  chatEnabled: boolean;
  appId: string;
  key: string;
  secret: string;
  cluster: string;
}

class PusherService {
  private cachedConfig: PusherConfig | null = null;
  private cachedAt = 0;
  private readonly CACHE_TTL_MS = 15000;

  invalidateCache(): void {
    this.cachedConfig = null;
    this.cachedAt = 0;
  }

  async getConfig(): Promise<PusherConfig> {
    if (this.cachedConfig && Date.now() - this.cachedAt < this.CACHE_TTL_MS) {
      return this.cachedConfig;
    }

    const keys = [
      'enable_push_notification',
      'enable_chat_via_pusher',
      'pusher_app_id',
      'pusher_key',
      'pusher_secret',
      'pusher_cluster',
    ];
    const placeholders = keys.map(() => '?').join(',');
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT setting_name, setting_value FROM ${table('settings')}
       WHERE setting_name IN (${placeholders}) AND deleted = 0`,
      keys
    );

    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.setting_name] = r.setting_value;
    }

    this.cachedConfig = {
      enabled: map.enable_push_notification === '1',
      chatEnabled: map.enable_chat_via_pusher !== '0',
      appId: (map.pusher_app_id || '').trim(),
      key: (map.pusher_key || '').trim(),
      secret: (map.pusher_secret || '').trim(),
      cluster: (map.pusher_cluster || 'ap1').trim(),
    };
    this.cachedAt = Date.now();
    return this.cachedConfig;
  }

  /**
   * Triggers a Pusher Channels event using official Pusher HTTP REST API signing (HMAC-SHA256).
   * Shares the exact same Pusher credentials as the CodeIgniter `paas` web portal so mobile
   * and web stay 100% synchronized in real time.
   */
  async trigger(channels: string | string[], eventName: string, data: any): Promise<boolean> {
    try {
      const cfg = await this.getConfig();
      if (!cfg.enabled || !cfg.appId || !cfg.key || !cfg.secret || !cfg.cluster) {
        return false;
      }

      const channelList = Array.isArray(channels) ? channels : [channels];
      if (channelList.length === 0) return false;

      // Pusher allows max 100 channels per request
      const chunks: string[][] = [];
      for (let i = 0; i < channelList.length; i += 100) {
        chunks.push(channelList.slice(i, i + 100));
      }

      const payloadData = typeof data === 'string' ? data : JSON.stringify(data);
      let allOk = true;

      for (const batch of chunks) {
        const bodyObj = {
          name: eventName,
          channels: batch,
          data: payloadData,
        };
        const bodyStr = JSON.stringify(bodyObj);
        const bodyMd5 = crypto.createHash('md5').update(bodyStr).digest('hex');
        const authTimestamp = Math.floor(Date.now() / 1000).toString();
        const apiPath = `/apps/${cfg.appId}/events`;

        const queryParams = [
          `auth_key=${cfg.key}`,
          `auth_timestamp=${authTimestamp}`,
          `auth_version=1.0`,
          `body_md5=${bodyMd5}`,
        ].join('&');

        const stringToSign = `POST\n${apiPath}\n${queryParams}`;
        const authSignature = crypto
          .createHmac('sha256', cfg.secret)
          .update(stringToSign)
          .digest('hex');

        const url = `https://api-${cfg.cluster}.pusher.com${apiPath}?${queryParams}&auth_signature=${authSignature}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
        });

        if (!resp.ok) {
          allOk = false;
        }
      }

      return allOk;
    } catch (err: any) {
      if (process.env.DEBUG === '1') {
        console.warn('[PusherService] Trigger failed:', err?.message);
      }
      return false;
    }
  }

  /**
   * Sends a notification to one or more users on the exact same channel (`user_{id}_channel`)
   * and event (`rise-pusher-event`) used by the `paas` web portal.
   */
  async notifyUsers(
    userIds: number[],
    payload: {
      title: string;
      message: string;
      notification_id?: number;
      project_id?: number;
      task_id?: number;
      type?: string;
    }
  ): Promise<boolean> {
    const uniqueIds = Array.from(new Set(userIds.filter((id) => id > 0)));
    if (uniqueIds.length === 0) return false;
    const channels = uniqueIds.map((uid) => `user_${uid}_channel`);
    return this.trigger(channels, 'rise-pusher-event', payload);
  }

  async triggerProjectChat(projectId: number, message: any): Promise<boolean> {
    return this.trigger(`project_${projectId}_chat`, 'new-message', message);
  }

  async triggerProjectComment(projectId: number, comment: any): Promise<boolean> {
    return this.trigger(`project_${projectId}_comments`, 'new-comment', comment);
  }

  async triggerTaskComment(taskId: number, comment: any): Promise<boolean> {
    return this.trigger(`task_${taskId}_comments`, 'new-comment', comment);
  }

  async triggerTaskChecklist(taskId: number, payload: any): Promise<boolean> {
    return this.trigger(`task_${taskId}_comments`, 'checklist-updated', payload);
  }
}

export const pusherService = new PusherService();
