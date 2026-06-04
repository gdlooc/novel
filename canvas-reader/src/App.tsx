/**
 * App — Root application component.
 *
 * Two modes:
 * 1. Book selection (when no book is loaded)
 * 2. Reader (when a book is active)
 */

import React, { useState, useCallback } from 'react';
import { ReaderShell } from '@reader/components/ReaderShell';
import { useReaderStore } from '@store/readerStore';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById, applyThemeToDOM } from '@engine/render/ThemeApplicator';
import type { BookSource } from '@book/types';
import type { ThemeId } from '@store/settingsStore';

/** Default book source — points to the crawler output */
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

  // Apply theme on mount
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

  // Reader mode
  if (activeSource) {
    return (
      <ReaderShell
        bookSource={activeSource}
        onBack={handleBack}
      />
    );
  }

  // Book selection mode
  return <BookSelector onSelect={handleOpenBook} />;
};

/** Simple book selection screen */
const BookSelector: React.FC<{
  onSelect: (source: BookSource) => void;
}> = ({ onSelect }) => {
  const [customUrl, setCustomUrl] = useState('');
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const colors = getThemeById(theme).cssVariables;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        background: colors['ui-background'],
        color: colors['ui-text'],
        overflow: 'auto',
      }}
    >
      <h1
        style={{
          fontSize: 28,
          fontWeight: 700,
          marginBottom: 8,
          textAlign: 'center',
        }}
      >
        📖 Canvas Reader
      </h1>
      <p
        style={{
          fontSize: 14,
          color: colors['ui-text-secondary'],
          marginBottom: 32,
          textAlign: 'center',
        }}
      >
        沉浸式 Web 小说阅读器
      </p>

      {/* Quick book list */}
      <div style={{ width: '100%', maxWidth: 420 }}>
        <h3 style={{ fontSize: 14, marginBottom: 12, color: colors['ui-text-secondary'] }}>
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

        {/* Custom URL */}
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8, color: colors['ui-text-secondary'] }}>
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

        {/* Theme quick toggle */}
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <span style={{ fontSize: 12, color: colors['ui-text-secondary'], marginRight: 8 }}>
            主题:
          </span>
          {(['light', 'dark', 'sepia'] as ThemeId[]).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              style={{
                padding: '4px 10px',
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
    </div>
  );
};
