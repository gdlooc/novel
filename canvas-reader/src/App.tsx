/**
 * App — 根应用组件。
 *
 * ## 三种模式
 *
 * 1. **首页**（activeSource === null && showHistory === false）：
 *    展示 BookSelector 界面，标签栏「历史 | 书库」
 * 2. **历史页**（activeSource === null && showHistory === true）：
 *    展示 HistoryPanel，可选择历史记录继续阅读
 * 3. **阅读模式**（activeSource 已设置）：
 *    渲染 ReaderShell 全屏阅读器界面
 *
 * ## 组件树
 *
 * ```
 * App
 * ├── BookSelector (首页)
 * │   ├── 标题
 * │   ├── 标签栏：历史 | 书库
 * │   ├── 示例书籍列表 / 自定义源输入 / 主题切换
 * │   └── HistoryPanel (历史标签页)
 * └── ReaderShell (阅读模式)
 * ```
 */

import React, { useState, useCallback } from 'react';
import { ReaderShell } from '@reader/components/ReaderShell';
import { HistoryPanel } from '@reader/components/HistoryPanel';
import { useReaderStore } from '@store/readerStore';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById, applyThemeToDOM } from '@engine/render/ThemeApplicator';
import type { BookSource } from '@book/types';
import type { ThemeId } from '@store/settingsStore';

/** 内建示例书籍列表（爬虫输出目录） */
const DEFAULT_BOOKS: { label: string; source: BookSource }[] = [
  {
    label: '败北女角太多了！(aid_3057)',
    source: {
      type: 'wenku8',
      uri: '/crawler/novels/aid_3057',
      metadata: { bookId: 'aid_3057' },
    },
  },
];

export const App: React.FC = () => {
  const [activeSource, setActiveSource] = useState<BookSource | null>(null);
  const resetReader = useReaderStore((s) => s.reset);
  const theme = useSettingsStore((s) => s.theme);

  // 初始化时应用主题 CSS 变量到 DOM
  React.useEffect(() => {
    applyThemeToDOM(getThemeById(theme));
  }, [theme]);

  const handleOpenBook = useCallback((source: BookSource) => {
    setActiveSource(source);
  }, []);

  const handleBack = useCallback(() => {
    setActiveSource(null);
    resetReader();
  }, [resetReader]);

  // ─── 阅读模式 ───
  if (activeSource) {
    return (
      <ReaderShell
        bookSource={activeSource}
        onBack={handleBack}
      />
    );
  }

  // ─── 首页（标签栏：历史 | 书库）───
  return <HomeScreen onSelect={handleOpenBook} />;
};

// ═══════════════════════════════════════════════════════
// 首页组件
// ═══════════════════════════════════════════════════════

const HomeScreen: React.FC<{
  onSelect: (source: BookSource) => void;
}> = ({ onSelect }) => {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const colors = getThemeById(theme).cssVariables;
  const [activeTab, setActiveTab] = useState<'history' | 'books'>('history');

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: colors['ui-background'],
      color: colors['ui-text'],
    }}>
      {/* 标题区 */}
      <div style={{
        textAlign: 'center',
        paddingTop: 'calc(env(safe-area-inset-top, 24px) + 24px)',
        paddingBottom: 16,
        paddingLeft: 32,
        paddingRight: 32,
        flexShrink: 0,
      }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 4px' }}>
          📖 Canvas Reader
        </h1>
        <p style={{
          fontSize: 13,
          color: colors['ui-text-secondary'],
          margin: 0,
        }}>
          沉浸式 Web 小说阅读器
        </p>
      </div>

      {/* 标签栏 */}
      <div style={{
        display: 'flex',
        margin: '0 32px 16px',
        background: colors['ui-background-secondary'],
        borderRadius: 10,
        padding: 3,
        flexShrink: 0,
      }}>
        {([
          { key: 'history' as const, label: '历史' },
          { key: 'books' as const, label: '书库' },
        ]).map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                flex: 1,
                padding: '8px 0',
                border: 'none',
                borderRadius: 8,
                background: active ? colors['ui-background'] : 'transparent',
                color: active ? colors['ui-text'] : colors['ui-text-secondary'],
                fontSize: 14,
                fontWeight: active ? 600 : 400,
                cursor: 'pointer',
                transition: 'background 0.15s',
                boxShadow: active ? `0 1px 3px ${colors['ui-border']}80` : 'none',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* 标签内容 */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {activeTab === 'history' ? (
          <HistoryPanel onSelectBook={onSelect} />
        ) : (
          <BookLibrary
            onSelect={onSelect}
            colors={colors}
            theme={theme}
            setTheme={setTheme}
          />
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════
// 书库标签页（原 BookSelector）
// ═══════════════════════════════════════════════════════

const BookLibrary: React.FC<{
  onSelect: (source: BookSource) => void;
  colors: Record<string, string>;
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}> = ({ onSelect, colors, theme, setTheme }) => {
  const [customUrl, setCustomUrl] = useState('');

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      padding: '0 32px 32px',
    }}>
      {/* 示例书籍 */}
      <h3 style={{ fontSize: 13, marginBottom: 10, color: colors['ui-text-secondary'], fontWeight: 500 }}>
        示例书籍
      </h3>
      {DEFAULT_BOOKS.map((book) => (
        <button
          key={book.source.uri}
          onClick={() => onSelect(book.source)}
          style={{
            width: '100%',
            padding: '14px 16px',
            marginBottom: 8,
            border: `1px solid ${colors['ui-border']}`,
            borderRadius: 10,
            background: colors['ui-background-secondary'],
            color: colors['ui-text'],
            fontSize: 15,
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          {book.label}
        </button>
      ))}

      {/* 自定义源 */}
      <div style={{ marginTop: 24 }}>
        <h3 style={{ fontSize: 13, marginBottom: 8, color: colors['ui-text-secondary'], fontWeight: 500 }}>
          自定义源
        </h3>
        <input
          type="text"
          placeholder="输入书籍目录路径或 URL..."
          value={customUrl}
          onChange={(e) => setCustomUrl(e.target.value)}
          style={{
            width: '100%',
            padding: '10px 14px',
            border: `1px solid ${colors['ui-border']}`,
            borderRadius: 8,
            background: colors['ui-background-secondary'],
            color: colors['ui-text'],
            fontSize: 14,
            marginBottom: 8,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <button
          onClick={() => {
            if (customUrl.trim()) {
              const source: BookSource = {
                type: 'wenku8',
                uri: customUrl.trim(),
                metadata: { bookId: customUrl.trim().split('/').pop() || 'custom' },
              };
              onSelect(source);
            }
          }}
          disabled={!customUrl.trim()}
          style={{
            width: '100%',
            padding: '10px',
            border: 'none',
            borderRadius: 8,
            background: customUrl.trim() ? colors['ui-accent'] : colors['ui-border'],
            color: '#fff',
            fontSize: 15,
            cursor: customUrl.trim() ? 'pointer' : 'default',
            opacity: customUrl.trim() ? 1 : 0.5,
          }}
        >
          打开
        </button>
      </div>

      {/* 主题切换 */}
      <div style={{ marginTop: 24, textAlign: 'center' }}>
        <span style={{ fontSize: 12, color: colors['ui-text-secondary'], marginRight: 8 }}>
          主题:
        </span>
        {(['light', 'dark', 'sepia'] as ThemeId[]).map((t) => (
          <button
            key={t}
            onClick={() => setTheme(t)}
            style={{
              padding: '4px 12px',
              margin: '0 2px',
              border: `1px solid ${theme === t ? colors['ui-accent'] : colors['ui-border']}`,
              borderRadius: 4,
              background: 'transparent',
              color: colors['ui-text'],
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {t === 'light' ? '浅色' : t === 'dark' ? '深色' : '护眼'}
          </button>
        ))}
      </div>
    </div>
  );
};
