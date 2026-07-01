/**
 * BottomBar — 阅读器底部工具栏。
 *
 * 半透明玻璃质感，横向排列工具按钮（图标在上，标签在下）。
 * 当前按钮：目录、设置，预留书签和搜索位。
 * 每个按钮最小 44px 触摸区域。
 */
import React from 'react';
import { List, Settings, Bookmark, Search } from 'lucide-react';
import { useUIStore } from '@store/uiStore';

/** 底部工具栏按钮配置 */
interface ToolButton {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  /** 是否禁用（灰色弱化显示） */
  disabled?: boolean;
}

export const BottomBar: React.FC = () => {
  const { setShowToc, setShowSettings } = useUIStore();

  const tools: ToolButton[] = [
    {
      id: 'toc',
      label: '目录',
      icon: <List className="w-6 h-6" />,
      onClick: () => setShowToc(true),
    },
    {
      id: 'settings',
      label: '设置',
      icon: <Settings className="w-6 h-6" />,
      onClick: () => setShowSettings(true),
    },
    {
      id: 'bookmark',
      label: '书签',
      icon: <Bookmark className="w-6 h-6 opacity-35" />,
      onClick: () => {/* 未来实现 */},
      disabled: true,
    },
    {
      id: 'search',
      label: '搜索',
      icon: <Search className="w-6 h-6 opacity-35" />,
      onClick: () => {/* 未来实现 */},
      disabled: true,
    },
  ];

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-[100] bg-background/80 backdrop-blur-xl border-t border-border/25 text-foreground"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex justify-evenly items-start h-14 pt-1.5">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={tool.onClick}
            disabled={tool.disabled}
            aria-label={tool.label}
            className={`flex flex-col items-center justify-center gap-0.5 min-w-12 min-h-12 py-1 px-2 border-none bg-transparent cursor-pointer rounded-[10px] ${
              tool.disabled ? 'opacity-35' : 'opacity-75'
            }`}
          >
            <div className="w-6 h-6 flex items-center justify-center">
              {tool.icon}
            </div>
            <span className="text-[10px] font-medium tracking-wider leading-[14px]">
              {tool.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
