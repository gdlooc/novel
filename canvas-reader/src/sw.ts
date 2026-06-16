/**
 * Service Worker — PWA 离线支持。
 *
 * ## 缓存策略
 *
 * 采用两种缓存策略组合：
 *
 * ### Cache First（静态资源）
 * 适用于 JS/CSS/HTML/Font/Image 等不常变化的资源。
 * - 优先从缓存读取（即时响应）
 * - 同时发起网络请求更新缓存（下次访问时使用新版本）
 * - 首次访问无缓存时走网络
 *
 * ### Network First（书籍数据）
 * 适用于 JSON/文本等动态数据。
 * - 优先从网络获取最新数据
 * - 网络成功 → 更新缓存 → 返回
 * - 网络失败 → 从缓存读取（离线降级）
 *
 * ## 生命周期
 *
 * - **install**：预缓存静态资源列表，调用 skipWaiting() 立即激活
 * - **activate**：清理旧版本缓存，调用 clients.claim() 接管所有页面
 * - **fetch**：拦截所有请求，按策略分发
 *
 * ## 缓存命名
 *
 * 缓存名 'canvas-reader-v1' 带版本号。
 * 更新 Service Worker 时修改 CACHE_NAME 即可触发旧缓存清理。
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'canvas-reader-v1';
const STATIC_ASSETS = ['/', '/index.html'];

// Install event — pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }),
  );
  // Activate immediately
  self.skipWaiting();
});

// Activate event — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
    }),
  );
  self.clients.claim();
});

// Fetch event — serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // For static assets (JS, CSS, HTML): Cache First
  if (
    request.destination === 'script' ||
    request.destination === 'style' ||
    request.destination === 'document' ||
    request.destination === 'manifest' ||
    request.destination === 'image' ||
    request.destination === 'font'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetched = fetch(request).then((response) => {
          // Cache the fresh response
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, clone);
          });
          return response;
        });
        return cached || fetched;
      }),
    );
    return;
  }

  // For book data (JSON, text): Network First, cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, clone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(request) as Promise<Response>;
      }),
  );
});
