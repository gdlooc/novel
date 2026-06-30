import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';

/**
 * 自定义 Vite 插件：在开发模式下提供爬虫输出目录的静态文件服务。
 *
 * 爬虫目录位于 `../crawler/`（novel-frontend 的兄弟目录）。
 * 此插件将 /crawler/* HTTP 请求映射到实际的爬虫目录，
 * 使得 WenkuAdapter 可以在开发期间读取章节数据。
 */
function crawlerServerPlugin(): Plugin {
  const CRAWLER_ROOT = resolve(__dirname, '..', 'crawler');

  return {
    name: 'crawler-server',
    configureServer(server) {
      // 将 /crawler/* 请求映射到实际爬虫目录
      server.middlewares.use('/crawler', (req, res, next) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const filePath = path.join(CRAWLER_ROOT, url.pathname);

        // 安全校验：确保解析后的路径在 CRAWLER_ROOT 内
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
          // 文件不存在或无权限，交给下一个中间件处理
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    crawlerServerPlugin(),
    VitePWA({
      // 使用 injectManifest 策略：由我们编写自定义 SW，workbox 注入预缓存清单
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 手动注册 SW，在生命周期管理模块中处理
      injectRegister: null as unknown as false,
      // PWA Manifest（自动从 public/manifest.json 合并）
      manifest: {
        name: 'Canvas Reader - 沉浸式阅读器',
        short_name: '小说阅读器',
        description: '基于 Canvas 渲染的 Web 小说阅读器，支持离线阅读',
        start_url: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#F5F5F5',
        theme_color: '#F5F5F5',
        categories: ['books', 'entertainment'],
        icons: [
          {
            src: '/vite.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      // Workbox 配置
      workbox: {
        // 预缓存所有静态资源（Vite 构建产物带哈希）
        globPatterns: [
          '**/*.{js,css,html,svg,png,ico,woff,woff2,ttf}',
          '**/manifest.json',
        ],
        // 排除不需要缓存的路径
        globIgnores: ['**/node_modules/**', '**/sw*', '**/workbox-*'],
        // 最大文件大小放宽到 5MB（用于大字体文件等）
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        // 自动清理过期 pre-cache
        cleanupOutdatedCaches: true,
        // 跳过等待，新 SW 立即激活
        skipWaiting: true,
        // 所有已打开页面立即被新 SW 接管
        clientsClaim: true,
        // 导航预加载：加速 HTML 请求
        navigationPreload: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@engine': resolve(__dirname, 'src/engine'),
      '@reader': resolve(__dirname, 'src/features/reader'),
      '@features': resolve(__dirname, 'src/features'),
      '@pages': resolve(__dirname, 'src/pages'),
      '@components': resolve(__dirname, 'src/components'),
      '@book': resolve(__dirname, 'src/book'),
      '@store': resolve(__dirname, 'src/store'),
      '@router': resolve(__dirname, 'src/router'),
      '@services': resolve(__dirname, 'src/services'),
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
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'zustand': ['zustand'],
        },
      },
    },
  },
  server: {
    host: true, // 监听所有网络接口，允许局域网访问
    port: 3000,
    open: true,
    // 代理 /api 请求到 FastAPI 服务器（解决局域网访问时 localhost 指向错误的问题）
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
    // Allow Vite to serve files from the parent project directory
    fs: {
      allow: [
        resolve(__dirname, '..'),
        resolve(__dirname, '..', '..'),
      ],
    },
  },
});
