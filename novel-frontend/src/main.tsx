/**
 * 应用程序入口点。
 *
 * 职责：
 * 1. 挂载 React 应用到 #root DOM 节点
 * 2. 启用 React.StrictMode（开发环境双次渲染检测副作用）
 * 3. 初始化页面生命周期管理（SW 注册 + 持久化存储 + 可见性监听）
 *
 * 注意：全局样式和字体加载应在 index.html 中处理。
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initLifecycle } from '@/services/lifecycle';
import './styles/global.css';

// ─────────── 初始化生命周期管理 ───────────
// 必须在 React 渲染前执行，确保 SW 尽早注册、持久化存储尽早申请
initLifecycle();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
