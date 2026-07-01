/**
 * TocPanel — 目录滑出面板。
 *
 * 展示分卷分组的章节目录，当前章节高亮，点击跳转。
 * 打开时自动滚动到当前阅读章节。
 */
import React, { useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useReaderStore } from '@store/readerStore';
import { useUIStore } from '@store/uiStore';

interface TocPanelProps {
  onChapterSelect: (chapterId: string) => void;
}

export const TocPanel: React.FC<TocPanelProps> = ({ onChapterSelect }) => {
  const chapterNav = useReaderStore((s) => s.chapterNav);
  const currentChapterId = useReaderStore((s) => s.chapterId);
  const { setShowToc } = useUIStore();

  /** 面板的滚动容器 ref，用于打开时定位到当前章节 */
  const panelRef = useRef<HTMLDivElement>(null);

  const handleSelect = (chapterId: string) => {
    setShowToc(false);
    onChapterSelect(chapterId);
  };

  /** 面板打开时，自动滚动到当前阅读章节 */
  useEffect(() => {
    if (!panelRef.current || !currentChapterId) return;

    // 短延迟等待浏览器完成布局渲染
    const timer = setTimeout(() => {
      const currentEl = panelRef.current?.querySelector(
        `[data-chapter-id="${currentChapterId}"]`,
      );
      if (currentEl) {
        currentEl.scrollIntoView({
          behavior: 'instant',
          block: 'center',
        });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [currentChapterId]);

  if (!chapterNav) return null;

  const displayEntries = buildDisplayEntries(chapterNav);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[199] bg-black/30"
        onClick={() => setShowToc(false)}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="absolute bottom-0 left-0 right-0 z-[200] max-h-[75vh] overflow-y-auto bg-background border-t border-border rounded-t-2xl p-5 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] text-foreground"
        style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* 标题栏 */}
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">目录</h2>
          <Button variant="ghost" size="icon" onClick={() => setShowToc(false)}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* 章节总数 */}
        <div className="text-xs text-muted-foreground mb-3">
          共 {chapterNav.totalChapters} 章
        </div>

        {/* 章节列表 */}
        <div>
          {displayEntries.map((entry) => {
            const isCurrent = entry.chapterId === currentChapterId;
            const isVolume = entry.isVolume;

            return (
              <div
                key={entry.chapterId}
                data-chapter-id={entry.chapterId}
                onClick={() => {
                  if (!isVolume && entry.chapterId) {
                    handleSelect(entry.chapterId);
                  }
                }}
                className={`py-2 mb-0.5 rounded-md transition-colors ${
                  isVolume
                    ? 'pl-2 text-[13px] font-semibold cursor-default'
                    : 'pl-6 text-sm cursor-pointer hover:bg-accent'
                } ${
                  isCurrent
                    ? 'bg-primary/10 text-primary border-l-[3px] border-l-primary'
                    : 'border-l-[3px] border-l-transparent'
                }`}
              >
                {entry.title}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

// ─── 辅助类型和函数 ───

interface DisplayEntry {
  chapterId: string;
  title: string;
  isVolume: boolean;
}

/** 从 ChapterNav 构建用于展示的条目列表（分卷 + 章节） */
function buildDisplayEntries(
  nav: NonNullable<ReturnType<typeof useReaderStore.getState>['chapterNav']>,
): DisplayEntry[] {
  const entries: DisplayEntry[] = [];

  for (const ch of nav.chapters) {
    if (ch.children && ch.children.length > 0) {
      entries.push({ chapterId: ch.chapterId, title: ch.title, isVolume: true });
      for (const child of ch.children) {
        entries.push({ chapterId: child.chapterId, title: child.title, isVolume: false });
      }
    } else {
      entries.push({ chapterId: ch.chapterId, title: ch.title, isVolume: false });
    }
  }

  return entries;
}
