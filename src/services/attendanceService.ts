import { pool, table } from '../config/database.js';
import { RowDataPacket, ResultSetHeader } from 'mysql2';

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
      `SELECT id, status, user_id, in_time, out_time, note, created_at
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

      return {
        isClockedIn: false,
        activeAttendance: null,
        lastAttendance: lastRows.length > 0 ? lastRows[0] : null,
      };
    }

    const current = rows[0];
    const inTime = new Date(current.in_time);
    const now = new Date();
    const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - inTime.getTime()) / (1000 * 60)));

    return {
      isClockedIn: true,
      activeAttendance: {
        id: current.id,
        inTime: current.in_time,
        note: current.note,
        elapsedMinutes,
        elapsedFormatted: `${Math.floor(elapsedMinutes / 60)}h ${elapsedMinutes % 60}m`,
      },
    };
  }

  /**
   * Clock In
   */
  async clockIn(userId: number, input: ClockInInput) {
    // Check if user already clocked in
    const status = await this.getCurrentStatus(userId);
    if (status.isClockedIn) {
      throw new Error('User is already clocked in');
    }

    // Build location & note metadata
    const locationParts: string[] = [];
    if (input.latitude && input.longitude) {
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
       VALUES (?, 'incomplete', NOW(), ?, 0)`,
      [userId, fullNote]
    );

    const [newRecord] = await pool.query<RowDataPacket[]>(
      `SELECT id, status, user_id, in_time, out_time, note FROM ${table('attendance')} WHERE id = ?`,
      [result.insertId]
    );

    return newRecord[0];
  }

  /**
   * Clock Out
   */
  async clockOut(userId: number, input: ClockOutInput) {
    const status = await this.getCurrentStatus(userId);
    if (!status.isClockedIn || !status.activeAttendance) {
      throw new Error('No active clock-in session found to clock out');
    }

    const activeId = status.activeAttendance.id;

    const locationParts: string[] = [];
    if (input.latitude && input.longitude) {
      locationParts.push(`GPS: (${input.latitude.toFixed(6)}, ${input.longitude.toFixed(6)})`);
    }
    if (input.address) {
      locationParts.push(`Loc: ${input.address}`);
    }

    const outNote = locationParts.length > 0 ? `\n[Out ${locationParts.join(' | ')}] ${input.note || ''}` : (input.note ? `\n${input.note}` : '');

    await pool.query(
      `UPDATE ${table('attendance')}
       SET out_time = NOW(),
           status = 'pending',
           note = CONCAT(IFNULL(note, ''), ?)
       WHERE id = ?`,
      [outNote, activeId]
    );

    const [updatedRecord] = await pool.query<RowDataPacket[]>(
      `SELECT id, status, user_id, in_time, out_time, note,
              TIMESTAMPDIFF(MINUTE, in_time, out_time) AS total_minutes
       FROM ${table('attendance')}
       WHERE id = ?`,
      [activeId]
    );

    const record = updatedRecord[0];
    const minutes = record.total_minutes || 0;

    return {
      ...record,
      total_hours: (minutes / 60).toFixed(2),
      durationFormatted: `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
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
      whereClause += ` AND DATE(a.in_time) >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ` AND DATE(a.in_time) <= ?`;
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
              TIMESTAMPDIFF(MINUTE, a.in_time, IFNULL(a.out_time, NOW())) AS duration_minutes,
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
              IFNULL(SUM(TIMESTAMPDIFF(MINUTE, in_time, out_time)), 0) as total_month_minutes
       FROM ${table('attendance')}
       WHERE user_id = ? AND deleted = 0 AND status != 'incomplete'
         AND MONTH(in_time) = MONTH(CURRENT_DATE())
         AND YEAR(in_time) = YEAR(CURRENT_DATE())`,
      [userId]
    );

    const monthMinutes = summaryRows[0].total_month_minutes || 0;

    return {
      records: rows.map((r) => ({
        id: r.id,
        status: r.status,
        in_time: r.in_time,
        out_time: r.out_time,
        note: r.note,
        durationMinutes: r.duration_minutes,
        durationFormatted: `${Math.floor((r.duration_minutes || 0) / 60)}h ${(r.duration_minutes || 0) % 60}m`,
      })),
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
