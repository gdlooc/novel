/**
 * Layout Web Worker — 将文本排版计算从主线程卸载到后台线程。
 *
 * ## 为什么需要 Worker
 *
 * 文本排版（断行 + 分页）是 CPU 密集型操作：
 * - 百万字小说可能有数十万行需要计算
 * - 逐字符遍历断行需要 O(n) 时间（n = 文本长度）
 * - 在主线程执行会导致 UI 冻结（丢帧、无响应）
 *
 * 将排版放在 Worker 中：
 * - 主线程保持响应用户手势和渲染
 * - 排版完成后通过 postMessage 回传结果
 * - 支持取消：主线程发送 CANCEL 消息，Worker 可停止当前排版
 *
 * ## 通信协议
 *
 * 主线程 → Worker：
 * ```
 * { type: 'LAYOUT', requestId, chapterId, text, config, startPageIndex, maxPages, startCharOffset }
 * { type: 'CANCEL', requestId }
 * ```
 *
 * Worker → 主线程：
 * ```
 * { type: 'LAYOUT_RESULT', requestId, chapterId, result: LayoutResult }
 * { type: 'WORKER_READY' }  // Worker 初始化完毕
 * ```
 *
 * ## 当前状态
 *
 * **已知问题 #2**：此 Worker 已编写但尚未集成到阅读流程中。
 * 当前排版在主线程同步执行（useReader → TextLayoutEngine.layout）。
 * 集成需要在 useReader 中创建 Worker 实例并通过 postMessage 通信。
 *
 * ## 使用 TextLayoutEngine
 *
 * Worker 内部仍使用 TextLayoutEngine（与主线程共享同一套代码），
 * 因为 engine 层是框架无关的纯 TypeScript，不依赖 DOM API。
 * 唯一的 DOM 依赖（TextMeasurer 中的 measureText）在 Worker
 * 中也可用，因为所有现代浏览器在 Worker 中支持 OffscreenCanvas。
 */

import { TextLayoutEngine } from '../layout/TextLayoutEngine';
import type {
  LayoutRequest,
  LayoutResponse,
  WorkerInMessage,
} from '../layout/types';

// Create a single engine instance for the worker's lifetime
const engine = new TextLayoutEngine();

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'LAYOUT': {
      handleLayout(msg);
      break;
    }
    case 'CANCEL': {
      // Cancel is handled by checking requestId in the response
      // (the main thread can ignore stale responses)
      break;
    }
    default:
      console.warn('[LayoutWorker] Unknown message type:', (msg as any).type);
  }
};

function handleLayout(msg: LayoutRequest): void {
  const {
    requestId,
    chapterId,
    text,
    config,
    startPageIndex,
    maxPages,
    startCharOffset,
  } = msg;

  try {
    const result = engine.layout(chapterId, text, config, {
      startPageIndex,
      maxPages,
      startCharOffset,
    });

    const response: LayoutResponse = {
      type: 'LAYOUT_RESULT',
      requestId,
      chapterId,
      result,
    };

    self.postMessage(response);
  } catch (error) {
    // Send error back as a layout result with empty pages
    console.error('[LayoutWorker] Layout error:', error);
    const response: LayoutResponse = {
      type: 'LAYOUT_RESULT',
      requestId,
      chapterId,
      result: {
        pages: [],
        configHash: '',
        totalPagesKnown: 0,
        hasMore: false,
      },
    };
    self.postMessage(response);
  }
}

// Tell the main thread we're ready
self.postMessage({ type: 'WORKER_READY' });
