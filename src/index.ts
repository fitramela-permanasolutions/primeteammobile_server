import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/errorHandler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '5000', 10);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static file hosting for uploads/attachments from CI paas/files
const filesDir = path.resolve(__dirname, '../../paas/files');
if (fs.existsSync(filesDir)) {
  app.use('/files-static', express.static(filesDir));
}

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
  } else if (fs.existsSync(fallbackPath)) {
    res.sendFile(fallbackPath);
  } else {
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
});

export default app;
