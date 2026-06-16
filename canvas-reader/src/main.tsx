/**
 * 应用程序入口点。
 *
 * 职责：
 * 1. 挂载 React 应用到 #root DOM 节点
 * 2. 启用 React.StrictMode（开发环境双次渲染检测副作用）
 * 3. 若 #root 元素不存在则抛出明确错误
 *
 * 注意：全局样式和字体加载应在 index.html 中处理，
 * Service Worker 注册在 sw.ts 中完成。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
