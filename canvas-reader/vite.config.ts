import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';

/**
 * Custom Vite plugin to serve the crawler output directory in dev mode.
 *
 * The crawler lives at `../crawler/` (sibling to canvas-reader/).
 * This plugin maps HTTP requests for `/crawler/*` to `f:/project/novel/crawler/*`
 * so the WenkuAdapter can fetch chapter data during development.
 */
function crawlerServerPlugin(): Plugin {
  const CRAWLER_ROOT = resolve(__dirname, '..', 'crawler');

  return {
    name: 'crawler-server',
    configureServer(server) {
      // Serve /crawler/* from the actual crawler directory
      server.middlewares.use('/crawler', (req, res, next) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const filePath = path.join(CRAWLER_ROOT, url.pathname);

        // Security: ensure the resolved path is within CRAWLER_ROOT
        if (!filePath.startsWith(CRAWLER_ROOT)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        try {
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const content = fs.readFileSync(filePath);
            const ext = path.extname(filePath);
            const mimeTypes: Record<string, string> = {
              '.json': 'application/json',
              '.txt': 'text/plain',
              '.html': 'text/html',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.png': 'image/png',
              '.svg': 'image/svg+xml',
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.end(content);
            return;
          }
        } catch {
          // Fall through to 404
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), crawlerServerPlugin()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@engine': resolve(__dirname, 'src/engine'),
      '@reader': resolve(__dirname, 'src/reader'),
      '@book': resolve(__dirname, 'src/book'),
      '@store': resolve(__dirname, 'src/store'),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'zustand': ['zustand'],
        },
      },
    },
  },
  server: {
    host: true, // 监听所有网络接口，允许局域网访问
    port: 3000,
    open: true,
    // Allow Vite to serve files from the parent project directory
    fs: {
      allow: [
        resolve(__dirname, '..'),
        resolve(__dirname, '..', '..'),
      ],
    },
  },
});
