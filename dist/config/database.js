import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();
const prefix = process.env.DB_PREFIX || 'permana_';
export const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sql_primeteam_permanasolutions_com',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0,
    dateStrings: true,
});
/**
 * Returns the fully prefixed and escaped table name.
 * e.g., table('users') => `permana_users`
 */
export function table(name) {
    return `\`${prefix}${name}\``;
}
/**
 * Returns raw prefixed table name without backticks.
 * e.g., rawTable('users') => permana_users
 */
export function rawTable(name) {
    return `${prefix}${name}`;
}
export default pool;
