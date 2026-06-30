/**
 * App — 应用根组件。
 *
 * 职责：
 * 1. 提供 BrowserRouter 路由上下文
 * 2. 初始化主题 CSS 变量（监听主题变更）
 * 3. 渲染全局路由表
 *
 * 过去用 useState 切换首页/阅读器，现在改为 React Router 驱动。
 */

import React, { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '@router/index';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById, applyThemeToDOM } from '@engine/render/ThemeApplicator';

/** 主题初始化：在应用启动时将 CSS 变量注入 DOM */
const ThemeInitializer: React.FC = () => {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    applyThemeToDOM(getThemeById(theme));
  }, [theme]);

  return <AppRoutes />;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ThemeInitializer />
    </BrowserRouter>
  );
};
