/**
 * AppLayout — 应用公共布局外壳。
 *
 * 为所有公共页面提供统一的导航框架：
 * - Header：顶部导航栏
 * - 内容区：通过 <Outlet /> 渲染子路由页面
 * - BottomNav：移动端底部标签导航
 * - 页面生命周期管理（切后台时保存恢复状态）
 */
import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { BottomNav } from './BottomNav';
import { usePageLifecycle } from '@/services/usePageLifecycle';

export const AppLayout: React.FC = () => {
  const location = useLocation();

  // 注册页面生命周期：切后台时保存恢复状态
  usePageLifecycle({
    enabled: true,
    currentPath: location.pathname + location.search,
  });

  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-background text-foreground">
      {/* 顶部导航栏 */}
      <Header />

      {/* 页面内容区 */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>

      {/* 移动端底部导航 */}
      <BottomNav />
    </div>
  );
};
