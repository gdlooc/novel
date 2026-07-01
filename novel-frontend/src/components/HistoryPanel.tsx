/**
 * HistoryPanel — 阅读历史记录页面。
 *
 * 展示所有已读过的小说列表，每项包含：
 * - 书名/作者/封面首字
 * - 上次阅读章节
 * - 阅读进度条
 * - 「继续阅读」按钮
 * - 删除按钮
 *
 * 数据来源：IndexedDB（HistoryCache 服务）
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import type { BookSource } from '@book/types';
import {
  getAllHistory,
  deleteHistoryEntry,
  clearAllHistory,
  type HistoryEntry,
} from '@/services/storage/HistoryCache';

interface HistoryPanelProps {
  /** 选择书籍并进入阅读模式 */
  onSelectBook: (source: BookSource) => void;
  /**
   * 紧凑模式：只显示最近 3 条记录，隐藏清空按钮。
   * 用于首页的「最近阅读」区域嵌入展示。
   */
  compact?: boolean;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  onSelectBook,
  compact = false,
}) => {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  /** 加载历史记录 */
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getAllHistory();
      setEntries(all);
    } catch (err) {
      console.warn('[HistoryPanel] 加载历史失败:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  /** 删除单条记录 */
  const handleDelete = useCallback(async (bookId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 防止触发继续阅读
    await deleteHistoryEntry(bookId);
    setEntries((prev) => prev.filter((en) => en.bookId !== bookId));
  }, []);

  /** 清空全部 */
  const handleClearAll = useCallback(async () => {
    await clearAllHistory();
    setEntries([]);
  }, []);

  /** 格式化最后阅读时间 */
  const formatTime = (ts: number): string => {
    const diff = Date.now() - ts;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  };

  /** 从书名中提取首字作为封面占位 */
  const getInitial = (title: string): string => {
    const match = title.match(/[一-鿿]/);
    return match ? match[0] : title.charAt(0).toUpperCase();
  };

  // ─── 加载状态 ───
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="w-7 h-7 border-[2.5px] border-border border-t-primary rounded-full animate-spin mb-3 mx-auto" />
        <span className="text-sm text-muted-foreground">加载中...</span>
      </div>
    );
  }

  // ─── 空状态 ───
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <div className="text-5xl mb-3 opacity-30">📚</div>
        <div className="text-[15px] text-foreground mb-1.5">暂无阅读记录</div>
        <div className="text-[13px] text-muted-foreground">打开一本书即可自动记录</div>
      </div>
    );
  }

  // ─── 历史列表 ───
  const displayEntries = compact ? entries.slice(0, 3) : entries;

  return (
    <div className="h-full flex flex-col">
      {/* 清空按钮行 — compact 模式下隐藏 */}
      {!compact && (
        <div className="flex justify-end px-4 pb-2 flex-shrink-0">
          <Button variant="ghost" size="sm" onClick={handleClearAll} className="text-muted-foreground">
            清空全部
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-0 pb-4 scrollbar-none">
        {displayEntries.map((entry) => (
          <div
            key={entry.bookId}
            className="flex items-center py-3.5 border-b border-border/40"
          >
            {/* 封面占位：书名首字 */}
            <div className="w-11 h-14 rounded-md bg-primary/10 flex items-center justify-center text-xl font-bold text-primary mr-3 flex-shrink-0">
              {getInitial(entry.title)}
            </div>

            {/* 书籍信息 */}
            <div className="flex-1 min-w-0 mr-3">
              <div className="text-[15px] font-semibold text-foreground truncate mb-0.5">
                {entry.title}
              </div>
              <div className="text-xs text-muted-foreground mb-1">
                {entry.author}
                {entry.chapterTitle ? ` · ${entry.chapterTitle}` : ''}
              </div>
              {/* 时间和进度 */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span>{formatTime(entry.updatedAt)}</span>
                {entry.progress > 0 && (
                  <>
                    {/* 迷你进度条 */}
                    <span className="inline-block w-10 h-0.5 rounded-sm bg-border align-middle overflow-hidden">
                      <span
                        className="block h-full rounded-sm bg-primary"
                        style={{ width: `${Math.round(entry.progress * 100)}%` }}
                      />
                    </span>
                    <span>{Math.round(entry.progress * 100)}%</span>
                  </>
                )}
              </div>
            </div>

            {/* 继续阅读按钮 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSelectBook(entry.source)}
              className="rounded-2xl border-primary text-primary flex-shrink-0"
            >
              继续
            </Button>

            {/* 删除按钮 */}
            <button
              onClick={(e) => handleDelete(entry.bookId, e)}
              aria-label="删除记录"
              className="bg-transparent border-none text-muted-foreground cursor-pointer py-1 pl-2 pr-0 opacity-40 flex-shrink-0 hover:opacity-70"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
