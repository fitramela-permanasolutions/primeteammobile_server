import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';
import { debugMiddleware } from './middlewares/debugMiddleware.js';
import { settingsService } from './services/settingsService.js';
import { fileService } from './services/fileService.js';
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = parseInt(process.env.PORT || '5000', 10);
// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// Debug Middleware (activates when DEBUG=1)
app.use(debugMiddleware);
// Dynamic static file hosting for uploads/attachments from upload_doc_path and fallback paas/files
const fallbackFilesDir = path.resolve(__dirname, '../../paas/files');
app.use('/files-static', async (req, res, next) => {
    try {
        const dynamicDir = await settingsService.getResolvedUploadBaseDir();
        const relPath = decodeURIComponent(req.path).replace(/^\/+/, '');
        const filename = path.basename(relPath);
        const candidates = [
            path.join(dynamicDir, relPath),
            path.join(fallbackFilesDir, relPath),
            path.join(dynamicDir, 'general', 'global_files', 'all', filename),
            path.join(dynamicDir, 'general', filename),
            path.join(fallbackFilesDir, 'general', 'global_files', 'all', filename),
            path.join(fallbackFilesDir, 'general', filename),
        ];
        for (const candidate of candidates) {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                res.sendFile(candidate);
                return;
            }
        }
        next();
    }
    catch {
        next();
    }
});
// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Serve OpenAPI Specification
app.get('/docs/openapi.json', (req, res) => {
    const primaryPath = path.join(__dirname, 'docs', 'openapi.json');
    const fallbackPath = path.resolve(__dirname, '../src/docs/openapi.json');
    if (fs.existsSync(primaryPath)) {
        res.sendFile(primaryPath);
    }
    else if (fs.existsSync(fallbackPath)) {
        res.sendFile(fallbackPath);
    }
    else {
        res.status(404).json({ error: 'OpenAPI specification not found' });
    }
});
// API Routes
app.use('/api/v1', routes);
// 404 Handler
app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.method} ${req.url} not found` });
});
// Global Error Handler
app.use(errorHandler);
// Start server
app.listen(port, () => {
    console.log(`[PrimeTeam API] Server is running on http://localhost:${port}`);
    console.log(`[PrimeTeam API] OpenAPI Spec available at http://localhost:${port}/docs/openapi.json`);
    if (process.env.DEBUG === '1') {
        console.log(`[PrimeTeam API] 🐞 DEBUG Mode ACTIVE (Logging API endpoints & response bodies)`);
    }
    // Sync legacy general files if any exist directly in files/general to files/general/global_files/all
    fileService.syncLegacyGeneralFiles().catch(() => { });
});
export default app;
