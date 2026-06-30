/**
 * 页面生命周期管理 — 防止移动端切后台/锁屏后页面被刷新。
 *
 * ## 问题背景
 *
 * 手机 Chrome 在用户切出浏览器或锁屏后，会触发以下生命周期：
 * 1. visibilitychange（hidden）→ 页面进入后台
 * 2. freeze → 浏览器冻结页面（CPU 暂停）
 * 3. 如果内存不足 → 浏览器可能直接终止渲染进程
 *
 * 用户返回时，浏览器重新发起导航请求 → 页面重启 → 之前的状态全部丢失。
 *
 * ## 解决方案（四层防护）
 *
 * ### 第一层：Service Worker 缓存
 * 即使浏览器杀掉了渲染进程，重新导航时 SW 会拦截请求，
 * 立即从缓存返回 HTML（Stale-While-Revalidate），页面秒开。
 *
 * ### 第二层：visibilitychange 事件
 * 页面变为 hidden 时，立即将当前阅读状态保存到 IndexedDB。
 * 恢复时检查是否有未完成的阅读，自动续读。
 *
 * ### 第三层：Persistent Storage API
 * 请求浏览器将本应用标记为"持久化存储"，
 * 降低 IndexedDB 数据被清理的风险。
 *
 * ### 第四层：自动恢复
 * 应用启动时检查是否有保存的恢复状态，
 * 如果有，自动导航回上次阅读的页面。
 *
 * ## 使用方法
 *
 * ```ts
 * // main.tsx 中引入并调用
 * import { initLifecycle } from '@/services/lifecycle';
 * initLifecycle();
 * ```
 */

import { setItem, getItem, removeItem } from '@/services/storage/localStorage';

// ═══════════════════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════════════════

/** 恢复状态的 localStorage key */
const RECOVERY_KEY = 'app:recovery-state';

/** 恢复状态有效期（超过此时间视为过期，不自动恢复） */
const RECOVERY_MAX_AGE = 30 * 60 * 1000; // 30 分钟

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 可恢复的应用状态 */
export interface RecoveryState {
  /** 当前路由路径 */
  path: string;
  /** 保存时间戳 */
  savedAt: number;
  /** 上一次可见的时间（用于判断是否被浏览器 kill 过） */
  lastVisibleAt: number;
  /** 附加数据（供详情页恢复使用） */
  extra?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
// Service Worker 注册
// ═══════════════════════════════════════════════════════════════

/** 注册 Service Worker（由 vite-plugin-pwa 构建生成） */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) {
    console.log('[Lifecycle] 浏览器不支持 Service Worker');
    return;
  }

  // 只在生产环境注册（开发时 vite-plugin-pwa 也会生成 SW）
  // 使用 import.meta.env 判断
  const shouldRegister =
    import.meta.env.PROD ||
    import.meta.env.MODE === 'production' ||
    // Vite 开发模式下也注册（用于测试 PWA 功能）
    (import.meta.env.DEV && window.location.hostname === 'localhost');

  if (!shouldRegister) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        console.log('[Lifecycle] SW 注册成功:', registration.scope);

        // 监听新版本 SW
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              console.log('[Lifecycle] 新版本 SW 可用，等待用户操作');
              // 新版本已安装，可以提示用户刷新
              // 这里选择自动应用新版本
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[Lifecycle] SW 注册失败:', err);
      });
  });
}

// ═══════════════════════════════════════════════════════════════
// 持久化存储请求
// ═══════════════════════════════════════════════════════════════

/** 请求浏览器将本应用标记为持久化存储 */
async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage || !navigator.storage.persist) {
    console.log('[Lifecycle] 浏览器不支持 Persistent Storage API');
    return false;
  }

  try {
    // 先检查当前状态
    if (await navigator.storage.persisted()) {
      console.log('[Lifecycle] 存储已持久化');
      return true;
    }

    // 请求持久化权限（浏览器会显示提示或静默授权）
    const granted = await navigator.storage.persist();
    console.log(
      `[Lifecycle] 持久化存储: ${granted ? '已授权' : '未授权'}`,
    );

    // 估算可用存储空间
    if ('estimate' in navigator.storage) {
      const estimate = await navigator.storage.estimate();
      if (estimate.quota && estimate.usage) {
        const usageMB = (estimate.usage / 1024 / 1024).toFixed(1);
        const quotaMB = (estimate.quota / 1024 / 1024).toFixed(1);
        console.log(
          `[Lifecycle] 存储: ${usageMB}MB / ${quotaMB}MB`,
        );
      }
    }

    return granted;
  } catch (err) {
    console.warn('[Lifecycle] 持久化存储请求失败:', err);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 恢复状态管理
// ═══════════════════════════════════════════════════════════════

/** 保存恢复状态 */
export function saveRecoveryState(path: string, extra?: Record<string, unknown>): void {
  const state: RecoveryState = {
    path,
    savedAt: Date.now(),
    lastVisibleAt: Date.now(),
    extra,
  };
  setItem(RECOVERY_KEY, state);
}

/** 获取上次保存的恢复状态（过期返回 null） */
export function getRecoveryState(): RecoveryState | null {
  const state = getItem<RecoveryState | null>(RECOVERY_KEY, null);
  if (!state) return null;

  // 检查是否过期
  if (Date.now() - state.savedAt > RECOVERY_MAX_AGE) {
    removeItem(RECOVERY_KEY);
    return null;
  }

  return state;
}

/** 清除恢复状态 */
export function clearRecoveryState(): void {
  removeItem(RECOVERY_KEY);
}

// ═══════════════════════════════════════════════════════════════
// 可见性监听
// ═══════════════════════════════════════════════════════════════

/** 不可见计时的开始时间（用于检测后台挂了多久） */
let hiddenSince: number | null = null;

/** 页面变为隐藏时的回调（由 ReaderShell 注册） */
let onHiddenCallback: (() => void) | null = null;

/** 注册页面隐藏回调（用于保存阅读进度） */
export function onPageHidden(callback: () => void): () => void {
  onHiddenCallback = callback;
  return () => {
    if (onHiddenCallback === callback) onHiddenCallback = null;
  };
}

/** 初始化可见性监听 */
function initVisibilityListener(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // 页面进入后台 / 锁屏
      hiddenSince = Date.now();
      // 触发保存回调（阅读进度、当前路由等）
      if (onHiddenCallback) onHiddenCallback();
      console.log('[Lifecycle] 页面进入后台');
    } else {
      // 页面恢复可见
      const hiddenDuration = hiddenSince ? Date.now() - hiddenSince : 0;
      hiddenSince = null;

      if (hiddenDuration > 5000) {
        // 超过 5 秒 → 可能经历了浏览器挂起/恢复
        console.log(
          `[Lifecycle] 页面恢复可见（后台 ${(hiddenDuration / 1000).toFixed(0)}s）`,
        );
      }
    }
  });

  // pagehide 事件：页面即将被关闭/缓存，做最后的保存
  // 注意：移动 Safari 中 pagehide 比 visibilitychange(hidden) 更可靠
  window.addEventListener('pagehide', () => {
    if (onHiddenCallback) onHiddenCallback();
    console.log('[Lifecycle] pagehide — 最终保存');
  });

  // freeze 事件：浏览器即将冻结页面（Page Lifecycle API）
  // 在此事件中做最后的持久化保存
  document.addEventListener('freeze', () => {
    if (onHiddenCallback) onHiddenCallback();
    console.log('[Lifecycle] freeze — 页面即将冻结，已保存状态');
  });

  // resume 事件：页面从冻结中恢复
  document.addEventListener('resume', () => {
    console.log('[Lifecycle] resume — 页面从冻结中恢复');
  });
}

// ═══════════════════════════════════════════════════════════════
// 网络状态监听
// ═══════════════════════════════════════════════════════════════

/** 监听网络状态变化，恢复联网时重新加载数据 */
function initNetworkListener(): void {
  window.addEventListener('online', () => {
    console.log('[Lifecycle] 网络已恢复');
    // 可以在此触发数据刷新
  });

  window.addEventListener('offline', () => {
    console.log('[Lifecycle] 网络已断开，使用缓存数据');
  });
}

// ═══════════════════════════════════════════════════════════════
// 主初始化函数
// ═══════════════════════════════════════════════════════════════

/** 初始化页面生命周期管理 */
export function initLifecycle(): void {
  // 1. 注册 Service Worker（缓存防护）
  registerServiceWorker();

  // 2. 请求持久化存储
  requestPersistentStorage();

  // 3. 监听页面可见性变化
  initVisibilityListener();

  // 4. 监听网络状态
  initNetworkListener();

  console.log('[Lifecycle] 初始化完成');
}
