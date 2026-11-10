/**
 * Middleware to debug incoming API requests and their response body.
 * Active when environment variable DEBUG=1 is set.
 */
export function debugMiddleware(req, res, next) {
    if (process.env.DEBUG !== '1') {
        return next();
    }
    const startTime = Date.now();
    const originalSend = res.send;
    let hasLogged = false;
    res.send = function (body) {
        if (!hasLogged) {
            hasLogged = true;
            const duration = Date.now() - startTime;
            const timestamp = new Date().toLocaleTimeString('id-ID');
            console.log(`\n================== [DEBUG API REQUEST] ==================`);
            console.log(`⏱️  Waktu       : ${timestamp} (+${duration}ms)`);
            console.log(`🛣️  Endpoint    : [${req.method}] ${req.originalUrl}`);
            console.log(`📊 Status Code : ${res.statusCode}`);
            if (req.query && Object.keys(req.query).length > 0) {
                console.log(`🔎 Query Params:`, JSON.stringify(req.query));
            }
            if (req.body && Object.keys(req.body).length > 0) {
                const safeBody = { ...req.body };
                if (safeBody.password)
                    safeBody.password = '***REDACTED***';
                console.log(`📥 Request Body:`, JSON.stringify(safeBody));
            }
            console.log(`📤 Response Body:`);
            try {
                if (typeof body === 'string') {
                    try {
                        const parsed = JSON.parse(body);
                        console.log(JSON.stringify(parsed, null, 2));
                    }
                    catch {
                        console.log(body);
                    }
                }
                else if (Buffer.isBuffer(body)) {
                    console.log('[Buffer / Binary Data]');
                }
                else {
                    console.log(JSON.stringify(body, null, 2));
                }
            }
            catch {
                console.log(body);
            }
            console.log(`================== [DEBUG API END] ====================\n`);
        }
        return originalSend.call(this, body);
    };
    next();
}
