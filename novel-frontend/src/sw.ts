/**
 * Service Worker — 离线支持 + 后台恢复保护。
 *
 * ## 缓存策略（三层）
 *
 * ### 1. 预缓存（Precache）— App Shell
 * 由 vite-plugin-pwa 自动注入 self.__WB_MANIFEST。
 * 所有静态资源（HTML/JS/CSS/字体/图标）在 SW 安装时全部缓存。
 * 使用 workbox 的 precacheAndRoute，自动管理版本和过期清理。
 *
 * ### 2. Stale-While-Revalidate — 导航请求（HTML）
 * 用户访问页面时：
 * - 立即从缓存返回 HTML（秒开）
 * - 后台发起网络请求更新缓存
 * - 下次访问使用最新版本
 *
 * ### 3. Network-First — API 数据
 * 书籍数据 / API 请求：
 * - 优先从网络获取最新数据
 * - 网络成功 → 更新缓存 → 返回
 * - 网络失败 → 从缓存返回（离线降级）
 * - 缓存有效期 24 小时，过期后即使离线也不返回旧数据
 *
 * ## 为什么浏览器不会"刷新"了？
 *
 * 手机 Chrome 切后台/锁屏后，浏览器可能终止渲染进程以释放内存。
 * 用户返回时，浏览器重新发起导航请求。
 *
 * 有了本 SW：
 * 1. 导航请求命中 Stale-While-Revalidate 缓存 → 页面立即呈现（无白屏）
 * 2. 预缓存覆盖所有 JS/CSS → 不需要联网，启动速度快
 * 3. 离线也能正常打开应用
 *
 * ## 生命周期
 *
 * - **install**：预缓存所有静态资源 + skipWaiting（立即激活）
 * - **activate**：清理旧缓存 + clients.claim（接管所有页面）
 * - **message**：处理来自主线程的 skipWaiting 请求
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

// workbox 预缓存清单（由 vite-plugin-pwa 构建时注入）
// @ts-ignore - WB_MANIFEST 由 workbox-build 在构建时替换
const manifest = self.__WB_MANIFEST || [];

// ═══════════════════════════════════════════════════════════════
// 缓存版本管理
// ═══════════════════════════════════════════════════════════════

/** 动态缓存名称（API 数据、导航请求等运行时缓存） */
const RUNTIME_CACHE = 'novel-frontend-runtime-v1';

/** API 数据缓存有效期：24 小时 */
const API_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;

/** 静态资源的不可变缓存有效期：30 天 */
const STATIC_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════

/** 判断请求是否需要从网络获取（非 GET / 非 http/https 跳过） */
function isCacheableRequest(request: Request): boolean {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  return url.protocol === 'http:' || url.protocol === 'https:';
}

/** 判断是否为导航请求（用户打开页面 / 刷新） */
function isNavigationRequest(request: Request): boolean {
  return request.mode === 'navigate';
}

/** 判断是否为 API 数据请求 */
function isApiRequest(request: Request): boolean {
  const url = new URL(request.url);
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/crawler/') ||
    request.destination === '' // fetch() 发出的请求无 destination
  );
}

/** 获取缓存的带时间戳包装 */
async function getCachedWithTimestamp(
  cache: Cache,
  request: Request,
): Promise<Response | undefined> {
  const cached = await cache.match(request);
  if (!cached) return undefined;

  // 检查是否过期
  const cachedTime = cached.headers.get('sw-cached-time');
  if (cachedTime) {
    const age = Date.now() - parseInt(cachedTime, 10);
    const maxAge = isApiRequest(request) ? API_CACHE_MAX_AGE : STATIC_CACHE_MAX_AGE;
    if (age > maxAge) {
      // 过期 → 视为无缓存
      return undefined;
    }
  }

  return cached;
}

/** 将响应存入缓存，并附加时间戳头 */
async function putCachedWithTimestamp(
  cache: Cache,
  request: Request,
  response: Response,
): Promise<void> {
  const headers = new Headers(response.headers);
  headers.set('sw-cached-time', String(Date.now()));

  const cacheable = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });

  await cache.put(request, cacheable);
}

// ═══════════════════════════════════════════════════════════════
// 离线回退页面（网络和缓存都不可用时）
// ═══════════════════════════════════════════════════════════════

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>离线 - Canvas Reader</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; background: #F5F5F5; color: #333;
    }
    .offline-card {
      text-align: center; padding: 40px;
    }
    .offline-card h1 { font-size: 48px; margin-bottom: 16px; }
    .offline-card p { font-size: 16px; color: #666; margin-bottom: 24px; }
    .offline-card button {
      padding: 12px 32px; font-size: 16px;
      background: #4285F4; color: #fff; border: none; border-radius: 8px;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="offline-card">
    <h1>📡</h1>
    <p>当前离线，请检查网络连接</p>
    <p style="font-size: 14px; color: #999;">首次访问需联网缓存资源</p>
    <button onclick="location.reload()">重试</button>
  </div>
</body>
</html>`;

// ═══════════════════════════════════════════════════════════════
// 预缓存：服务所有静态资源（由 workbox 管理）
// ═══════════════════════════════════════════════════════════════

/** 手动实现 precache 逻辑，不依赖 workbox-runtime */
async function precacheAll(): Promise<void> {
  const cache = await caches.open(RUNTIME_CACHE);
  const urlsToCache = manifest
    .filter((entry): entry is { url: string; revision: string | null } =>
      typeof entry === 'object' && 'url' in entry,
    )
    .map((entry) => entry.url);

  if (urlsToCache.length === 0) return;

  // 并发预缓存所有静态资源
  await Promise.all(
    urlsToCache.map(async (url) => {
      try {
        const response = await fetch(url, { credentials: 'same-origin' });
        if (response.ok) {
          await putCachedWithTimestamp(cache, new Request(url), response);
        }
      } catch {
        // 预缓存失败不阻塞安装
        console.warn('[SW] 预缓存失败:', url);
      }
    }),
  );
}

// ═══════════════════════════════════════════════════════════════
// Install：预缓存 App Shell
// ═══════════════════════════════════════════════════════════════

self.addEventListener('install', (event) => {
  console.log('[SW] 安装中...', new Date().toISOString());
  event.waitUntil(
    (async () => {
      await precacheAll();
      console.log('[SW] 预缓存完成，移至 activate');
      // 立即激活，不等待旧 SW 释放
      await self.skipWaiting();
    })(),
  );
});

// ═══════════════════════════════════════════════════════════════
// Activate：清理旧缓存 + 接管所有页面
// ═══════════════════════════════════════════════════════════════

self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...', new Date().toISOString());
  event.waitUntil(
    (async () => {
      // 清理不再是当前版本的缓存
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((name) => name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name)),
      );
      // 接管所有已打开的页面（新 SW 立即生效）
      await self.clients.claim();
      console.log('[SW] 已激活并接管所有页面');
    })(),
  );
});

// ═══════════════════════════════════════════════════════════════
// Fetch：核心请求拦截逻辑
// ═══════════════════════════════════════════════════════════════

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 跳过非 GET 请求
  if (!isCacheableRequest(request)) return;

  // 跳过 chrome-extension:// 等非 http 请求
  const url = new URL(request.url);

  // ── 策略 1: 导航请求 → Stale-While-Revalidate ──
  // 用户打开页面 / 刷新时：
  // 1. 立即从缓存返回（秒开）
  // 2. 后台 fetch 更新缓存
  // 这是防止"页面被浏览器刷新后白屏"的核心策略
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);

        try {
          // 使用预加载响应（如果浏览器支持 Navigation Preload）
          // 否则从网络获取
          const preloadResponse = (event as any).preloadResponse as Promise<Response> | undefined;
          const networkResponse = await (preloadResponse || fetch(request));

          // 网络成功 → 更新缓存
          if (networkResponse && networkResponse.ok) {
            await putCachedWithTimestamp(cache, request, networkResponse.clone());
            return networkResponse;
          }
        } catch {
          // 网络失败 → 继续走到缓存回退
        }

        // 从缓存返回（如果缓存也没了，显示离线页面）
        const cached = await cache.match(request);
        if (cached) return cached;

        // 最后兜底：尝试匹配根路径的缓存（SPA fallback）
        const rootCached = await cache.match('/');
        if (rootCached) return rootCached;

        // 完全离线 → 返回内嵌离线页面
        return new Response(OFFLINE_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      })(),
    );
    return;
  }

  // ── 策略 2: 静态资源（JS/CSS/字体/图片）→ Cache-First ──
  // Vite 构建产物全部带内容哈希，天然不可变，直接走缓存最快
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'font' ||
    request.destination === 'image'
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await getCachedWithTimestamp(cache, request);
        if (cached) return cached;

        // 缓存未命中 → 从网络获取
        try {
          const response = await fetch(request);
          if (response.ok) {
            await putCachedWithTimestamp(cache, request, response.clone());
          }
          return response;
        } catch {
          // 离线且无缓存 → 对于非关键资源返回空响应
          if (request.destination === 'image' || request.destination === 'font') {
            return new Response('', { status: 200 });
          }
          throw new Error('离线，资源不可用');
        }
      })(),
    );
    return;
  }

  // ── 策略 3: API 数据 → Network-First with Cache Fallback ──
  // 书籍数据优先从网络获取（保证最新），离线时用缓存
  if (isApiRequest(request)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);

        try {
          const response = await fetch(request);
          if (response.ok) {
            await putCachedWithTimestamp(cache, request, response.clone());
            return response;
          }
        } catch {
          // 网络不可达
        }

        // 回退到缓存
        const cached = await getCachedWithTimestamp(cache, request);
        if (cached) return cached;

        // 彻底离线 → 返回空 JSON
        return new Response(JSON.stringify({ error: '离线，数据不可用' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      })(),
    );
    return;
  }

  // ── 策略 4: 其他请求 → 默认 Network-First ──
  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      try {
        const response = await fetch(request);
        if (response.ok) {
          await putCachedWithTimestamp(cache, request, response.clone());
        }
        return response;
      } catch {
        const cached = await cache.match(request);
        return cached || new Response('', { status: 408 });
      }
    })(),
  );
});

// ═══════════════════════════════════════════════════════════════
// Message：接收主线程消息
// ═══════════════════════════════════════════════════════════════

self.addEventListener('message', (event) => {
  const { type } = event.data || {};

  // 主线程要求 SW 立即接管
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
