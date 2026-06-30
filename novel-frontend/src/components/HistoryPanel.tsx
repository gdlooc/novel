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
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';
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
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

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
    // 去除英文和标点，取第一个中文字符
    const match = title.match(/[一-鿿]/);
    return match ? match[0] : title.charAt(0).toUpperCase();
  };

  // ─── 加载状态 ───
  if (loading) {
    return (
      <div style={centerMessage}>
        <div style={{
          width: 28, height: 28,
          border: `2.5px solid ${colors['ui-border']}`,
          borderTopColor: colors['ui-accent'],
          borderRadius: '50%',
          animation: 'history-spin 0.7s linear infinite',
          margin: '0 auto 12px',
        }} />
        <span style={{ fontSize: 14, color: colors['ui-text-secondary'] }}>加载中...</span>
        <style>{`@keyframes history-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ─── 空状态 ───
  if (entries.length === 0) {
    return (
      <div style={centerMessage}>
        <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>📚</div>
        <div style={{ fontSize: 15, color: colors['ui-text'], marginBottom: 6 }}>
          暂无阅读记录
        </div>
        <div style={{ fontSize: 13, color: colors['ui-text-secondary'] }}>
          打开一本书即可自动记录
        </div>
      </div>
    );
  }

  // ─── 历史列表 ───
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 清空按钮行 — compact 模式下隐藏 */}
      {!compact && (
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '0 16px 8px',
          flexShrink: 0,
        }}>
          <button
            onClick={handleClearAll}
            style={{
              background: 'none',
              border: 'none',
              color: colors['ui-text-secondary'],
              fontSize: 13,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            清空全部
          </button>
        </div>
      )}

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: compact ? '0' : '0 32px',
        paddingBottom: compact ? '0' : 'env(safe-area-inset-bottom, 16px)',
        // 隐藏滚动条但可滚动
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}>
        {(compact ? entries.slice(0, 3) : entries).map((entry) => (
          <div
            key={entry.bookId}
            style={entryCard(colors)}
          >
            {/* 封面占位：书名首字 */}
            <div style={coverPlaceholder(colors)}>
              {getInitial(entry.title)}
            </div>

            {/* 书籍信息 */}
            <div style={{
              flex: 1,
              minWidth: 0,
              marginRight: 12,
            }}>
              <div style={{
                fontSize: 15,
                fontWeight: 600,
                color: colors['ui-text'],
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: 2,
              }}>
                {entry.title}
              </div>
              <div style={{
                fontSize: 12,
                color: colors['ui-text-secondary'],
                marginBottom: 4,
              }}>
                {entry.author}
                {entry.chapterTitle ? ` · ${entry.chapterTitle}` : ''}
              </div>
              {/* 时间和进度 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                color: colors['ui-text-secondary'],
              }}>
                <span>{formatTime(entry.updatedAt)}</span>
                {entry.progress > 0 && (
                  <>
                    {/* 迷你进度条 */}
                    <span style={{
                      display: 'inline-block',
                      width: 40,
                      height: 2,
                      borderRadius: 1,
                      background: colors['ui-border'],
                      verticalAlign: 'middle',
                    }}>
                      <span style={{
                        display: 'block',
                        width: `${Math.round(entry.progress * 100)}%`,
                        height: '100%',
                        borderRadius: 1,
                        background: colors['ui-accent'],
                      }} />
                    </span>
                    <span>{Math.round(entry.progress * 100)}%</span>
                  </>
                )}
              </div>
            </div>

            {/* 继续阅读按钮 */}
            <button
              onClick={() => onSelectBook(entry.source)}
              style={continueButton(colors)}
            >
              继续
            </button>

            {/* 删除按钮 */}
            <button
              onClick={(e) => handleDelete(entry.bookId, e)}
              aria-label="删除记录"
              style={{
                background: 'none',
                border: 'none',
                color: colors['ui-text-secondary'],
                fontSize: 16,
                cursor: 'pointer',
                padding: '4px 0 4px 8px',
                opacity: 0.4,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── 样式 ───

const centerMessage: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
};

const entryCard = (colors: Record<string, string>): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  padding: '14px 0',
  borderBottom: `1px solid ${colors['ui-border']}60`,
});

const coverPlaceholder = (colors: Record<string, string>): React.CSSProperties => ({
  width: 44,
  height: 56,
  borderRadius: 6,
  background: colors['ui-accent'] + '18',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 20,
  fontWeight: 700,
  color: colors['ui-accent'],
  marginRight: 12,
  flexShrink: 0,
});

const continueButton = (colors: Record<string, string>): React.CSSProperties => ({
  padding: '6px 14px',
  border: `1px solid ${colors['ui-accent']}`,
  borderRadius: 16,
  background: 'transparent',
  color: colors['ui-accent'],
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  flexShrink: 0,
});
