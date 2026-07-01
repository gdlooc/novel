/**
 * TopBar — 阅读器顶部工具栏。
 *
 * 半透明玻璃质感，左侧返回箭头，居中显示「分卷名 · 章节名」。
 * 仅在用户点击屏幕中央时浮现/隐藏。
 */
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useReaderStore } from '@store/readerStore';

interface TopBarProps {
  onBack?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({ onBack }) => {
  const chapterNav = useReaderStore((s) => s.chapterNav);
  const chapterTitle = useReaderStore((s) => s.chapterTitle);
  const chapterId = useReaderStore((s) => s.chapterId);

  // 查找当前章节所属分卷名
  const volumeName = chapterId && chapterNav ? chapterNav.getVolumeName(chapterId) : undefined;

  return (
    <div
      className="absolute top-0 left-0 right-0 z-[100] flex items-center h-11 px-2 bg-background/80 backdrop-blur-xl border-b border-border/25 text-foreground"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* ── 左侧：返回箭头 ── */}
      <button
        onClick={onBack}
        aria-label="返回"
        className="bg-transparent border-none text-foreground w-9 h-9 flex items-center justify-center cursor-pointer rounded-lg flex-shrink-0 hover:bg-accent"
      >
        <ArrowLeft className="w-5 h-5" />
      </button>

      {/* ── 中间：分卷名 · 章节名 ── */}
      <div className="flex-1 text-center overflow-hidden px-2">
        {volumeName ? (
          <span className="text-[13px] font-medium leading-5 tracking-wide">
            <span className="opacity-60">{volumeName}</span>
            <span className="opacity-30 mx-1.5">·</span>
            <span>{chapterTitle || ''}</span>
          </span>
        ) : (
          <span className="text-[13px] font-medium leading-5">
            {chapterTitle || ''}
          </span>
        )}
      </div>

      {/* ── 右侧占位（保持居中对称）── */}
      <div className="w-9 flex-shrink-0" />
    </div>
  );
};
