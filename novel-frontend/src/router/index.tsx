/**
 * 应用路由配置。
 *
 * 集中定义所有 URL 路径与页面组件的映射关系。
 * 使用 React Router v6 的声明式路由 + 布局嵌套：
 * - 公共页面（首页/书库/详情/历史/搜索/设置）嵌套在 AppLayout 中
 * - 阅读器页面独立全屏，无公共布局
 */

import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppLayout } from '@components/layout/AppLayout';
import { HomePage } from '@pages/HomePage';
import { LibraryPage } from '@pages/LibraryPage';
import { BookDetailPage } from '@pages/BookDetailPage';
import { ReaderPage } from '@pages/ReaderPage';
import { HistoryPage } from '@pages/HistoryPage';
import { SearchPage } from '@pages/SearchPage';
import { SettingsPage } from '@pages/SettingsPage';
import { NotFoundPage } from '@pages/NotFoundPage';

/**
 * 应用路由表组件。
 * 在 App.tsx 的 BrowserRouter 内部渲染。
 */
export const AppRoutes: React.FC = () => {
  return (
    <Routes>
      {/* 公共布局：Header + 内容区 + BottomNav */}
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="book/:bookId" element={<BookDetailPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>

      {/* 阅读器：全屏无布局 */}
      <Route path="reader/:bookId" element={<ReaderPage />} />
    </Routes>
  );
};
