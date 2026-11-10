import { sendError } from '../utils/response.js';
export function errorHandler(err, req, res, next) {
    console.error('[Error Handler]', err);
    const statusCode = err.statusCode || 500;
    const message = err.message || 'Internal server error';
    sendError(res, message, statusCode, process.env.NODE_ENV === 'development' ? err.stack : undefined);
}
