/**
 * BottomNav — 移动端底部标签导航栏。
 *
 * 包含四个主要入口：首页、书库、历史、设置。
 * 使用 React Router 的 useNavigate + useLocation 实现导航和高亮。
 * 玻璃质感半透明背景，图标使用 lucide-react。
 */
import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Library, History, Settings } from 'lucide-react';

/** 导航项配置 */
interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

/** 所有导航项 — 使用 lucide 图标 */
const NAV_ITEMS: NavItem[] = [
  { path: '/', label: '首页', icon: <Home className="w-6 h-6" /> },
  { path: '/library', label: '书库', icon: <Library className="w-6 h-6" /> },
  { path: '/history', label: '历史', icon: <History className="w-6 h-6" /> },
  { path: '/settings', label: '设置', icon: <Settings className="w-6 h-6" /> },
];

export const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  /** 判断当前路由是否匹配导航项 */
  const isActive = (path: string): boolean => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav
      className="flex justify-evenly items-center h-[50px] bg-background/[0.93] backdrop-blur-xl border-t border-border/25 flex-shrink-0 z-50"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {NAV_ITEMS.map((item) => {
        const active = isActive(item.path);
        return (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            aria-label={item.label}
            className={`flex flex-col items-center justify-center gap-0.5 min-w-14 min-h-11 py-0.5 px-2 border-none bg-transparent cursor-pointer rounded-lg transition-colors ${
              active ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            {item.icon}
            <span className={`text-[10px] tracking-wider ${active ? 'font-semibold' : 'font-normal'}`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
