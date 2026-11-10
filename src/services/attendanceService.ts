import { pool, table } from '../config/database.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';
import { stripHtml, toIsoUtc } from '../utils/ciHelpers.js';

export interface ClockInInput {
  latitude?: number;
  longitude?: number;
  address?: string;
  selfieUrl?: string;
  note?: string;
}

export interface ClockOutInput {
  latitude?: number;
  longitude?: number;
  address?: string;
  note?: string;
}

export class AttendanceService {
  /**
   * Get current clock-in status for a user
   */
  async getCurrentStatus(userId: number) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, status, user_id, in_time, out_time, note,
              GREATEST(0, TIMESTAMPDIFF(MINUTE, in_time, UTC_TIMESTAMP())) AS elapsed_minutes
       FROM ${table('attendance')}
       WHERE user_id = ? AND deleted = 0 AND status = 'incomplete'
       ORDER BY id DESC
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      // Also get the last completed record for context
      const [lastRows] = await pool.query<RowDataPacket[]>(
        `SELECT id, status, user_id, in_time, out_time, note
         FROM ${table('attendance')}
         WHERE user_id = ? AND deleted = 0
         ORDER BY id DESC
         LIMIT 1`,
        [userId]
      );

      const last = lastRows.length > 0 ? lastRows[0] : null;
      return {
        isClockedIn: false,
        activeAttendance: null,
        lastAttendance: last
          ? {
              ...last,
              in_time: toIsoUtc(last.in_time) || last.in_time,
              out_time: toIsoUtc(last.out_time) || last.out_time,
              note: stripHtml(last.note),
            }
          : null,
      };
    }

    const current = rows[0];
    const elapsedMinutes = Math.max(0, Number(current.elapsed_minutes) || 0);

    return {
      isClockedIn: true,
      activeAttendance: {
        id: current.id,
        inTime: toIsoUtc(current.in_time) || current.in_time,
        note: stripHtml(current.note),
        elapsedMinutes,
        elapsedFormatted: `${Math.floor(elapsedMinutes / 60)}j ${elapsedMinutes % 60}m`,
      },
    };
  }

  /**
   * Clock In (uses UTC_TIMESTAMP() to match PAAS get_current_utc_time())
   */
  async clockIn(userId: number, input: ClockInInput) {
    // Check if user already clocked in
    const status = await this.getCurrentStatus(userId);
    if (status.isClockedIn) {
      throw new Error('Anda sudah melakukan Clock In sebelumnya');
    }

    // Build location & note metadata
    const locationParts: string[] = [];
    if (input.latitude !== undefined && input.longitude !== undefined) {
      locationParts.push(`GPS: (${input.latitude.toFixed(6)}, ${input.longitude.toFixed(6)})`);
    }
    if (input.address) {
      locationParts.push(`Loc: ${input.address}`);
    }
    if (input.selfieUrl) {
      locationParts.push(`Selfie: ${input.selfieUrl}`);
    }

    const locString = locationParts.length > 0 ? `[In ${locationParts.join(' | ')}] ` : '';
    const fullNote = `${locString}${input.note || ''}`.trim();

    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO ${table('attendance')} (user_id, status, in_time, note, deleted)
       VALUES (?, 'incomplete', UTC_TIMESTAMP(), ?, 0)`,
      [userId, fullNote]
    );

    const [newRecord] = await pool.query<RowDataPacket[]>(
      `SELECT id, status, user_id, in_time, out_time, note
       FROM ${table('attendance')}
       WHERE id = ?`,
      [result.insertId]
    );

    const r = newRecord[0];
    return {
      ...r,
      in_time: toIsoUtc(r.in_time) || r.in_time,
      out_time: toIsoUtc(r.out_time) || r.out_time,
      note: stripHtml(r.note),
    };
  }

  /**
   * Clock Out
   */
  async clockOut(userId: number, input: ClockOutInput) {
    const status = await this.getCurrentStatus(userId);
    if (!status.isClockedIn || !status.activeAttendance) {
      throw new Error('Tidak ada sesi Clock In aktif untuk di-Clock Out');
    }

    const activeId = status.activeAttendance.id;

    const locationParts: string[] = [];
    if (input.latitude !== undefined && input.longitude !== undefined) {
      locationParts.push(`GPS: (${input.latitude.toFixed(6)}, ${input.longitude.toFixed(6)})`);
    }
    if (input.address) {
      locationParts.push(`Loc: ${input.address}`);
    }

    const outNote =
      locationParts.length > 0
        ? `\n[Out ${locationParts.join(' | ')}] ${input.note || ''}`
        : input.note
        ? `\n${input.note}`
        : '';

    await pool.query(
      `UPDATE ${table('attendance')}
       SET out_time = UTC_TIMESTAMP(),
           status = 'pending',
           note = CONCAT(IFNULL(note, ''), ?)
       WHERE id = ?`,
      [outNote, activeId]
    );

    const [updatedRecord] = await pool.query<RowDataPacket[]>(
      `SELECT id, status, user_id, in_time, out_time, note,
              GREATEST(0, TIMESTAMPDIFF(MINUTE, in_time, out_time)) AS total_minutes
       FROM ${table('attendance')}
       WHERE id = ?`,
      [activeId]
    );

    const record = updatedRecord[0];
    const minutes = Number(record.total_minutes) || 0;

    return {
      ...record,
      in_time: toIsoUtc(record.in_time) || record.in_time,
      out_time: toIsoUtc(record.out_time) || record.out_time,
      note: stripHtml(record.note),
      total_hours: (minutes / 60).toFixed(2),
      durationFormatted: `${Math.floor(minutes / 60)}j ${minutes % 60}m`,
    };
  }

  /**
   * Get attendance history
   */
  async getHistory(userId: number, page = 1, limit = 20, startDate?: string, endDate?: string) {
    const offset = (page - 1) * limit;
    const params: any[] = [userId];
    let whereClause = `WHERE a.user_id = ? AND a.deleted = 0`;

    if (startDate) {
      whereClause += ` AND DATE(ADDTIME(a.in_time, '07:00:00')) >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ` AND DATE(ADDTIME(a.in_time, '07:00:00')) <= ?`;
      params.push(endDate);
    }

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as total FROM ${table('attendance')} a ${whereClause}`,
      params
    );
    const total = countRows[0].total;

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT a.id, a.status, a.user_id, a.in_time, a.out_time, a.note,
              a.checked_by, a.reject_reason,
              GREATEST(0, TIMESTAMPDIFF(MINUTE, a.in_time, IFNULL(a.out_time, UTC_TIMESTAMP()))) AS duration_minutes,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM ${table('attendance')} a
       LEFT JOIN ${table('users')} u ON u.id = a.user_id
       ${whereClause}
       ORDER BY a.in_time DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Compute month summary
    const [summaryRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as days_attended,
              IFNULL(SUM(GREATEST(0, TIMESTAMPDIFF(MINUTE, in_time, out_time))), 0) as total_month_minutes
       FROM ${table('attendance')}
       WHERE user_id = ? AND deleted = 0 AND status != 'incomplete'
         AND MONTH(ADDTIME(in_time, '07:00:00')) = MONTH(ADDTIME(UTC_TIMESTAMP(), '07:00:00'))
         AND YEAR(ADDTIME(in_time, '07:00:00')) = YEAR(ADDTIME(UTC_TIMESTAMP(), '07:00:00'))`,
      [userId]
    );

    const monthMinutes = Number(summaryRows[0].total_month_minutes) || 0;

    return {
      records: rows.map((r) => {
        const dur = Math.max(0, Number(r.duration_minutes) || 0);
        return {
          id: r.id,
          status: r.status,
          in_time: toIsoUtc(r.in_time) || r.in_time,
          out_time: toIsoUtc(r.out_time) || r.out_time,
          note: stripHtml(r.note),
          reject_reason: stripHtml(r.reject_reason),
          durationMinutes: dur,
          durationFormatted: `${Math.floor(dur / 60)}j ${dur % 60}m`,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        daysAttendedThisMonth: summaryRows[0].days_attended,
        totalHoursThisMonth: (monthMinutes / 60).toFixed(1),
      },
    };
  }
}

export const attendanceService = new AttendanceService();
