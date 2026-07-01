/**
 * Header — 顶部导航栏。
 *
 * 提供：
 * - 应用标题/Logo（点击返回首页）
 * - 搜索入口（点击跳转搜索页）
 * - 玻璃质感半透明背景
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';

export const Header: React.FC = () => {
  const navigate = useNavigate();

  return (
    <header className="flex items-center h-12 px-4 bg-background/[0.93] backdrop-blur-xl border-b border-border/25 flex-shrink-0 z-50"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Logo / 首页入口 */}
      <button
        onClick={() => navigate('/')}
        aria-label="首页"
        className="bg-transparent border-none text-lg font-bold text-foreground cursor-pointer p-0 mr-4 tracking-tight"
      >
        📖 轻小说
      </button>

      {/* 中间占位 */}
      <div className="flex-1" />

      {/* 搜索入口 */}
      <button
        onClick={() => navigate('/search')}
        aria-label="搜索"
        className="flex items-center gap-1.5 py-1.5 px-3.5 border border-border rounded-[20px] bg-secondary text-muted-foreground text-[13px] cursor-pointer hover:bg-accent transition-colors"
      >
        <Search className="w-4 h-4" />
        搜索
      </button>
    </header>
  );
};
