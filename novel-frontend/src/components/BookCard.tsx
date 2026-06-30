/**
 * BookCard — 书籍卡片组件。
 *
 * 在书库、搜索等页面展示书籍摘要信息。
 * 结构：封面占位（首字）+ 书名 + 作者 + 可选进度条。
 *
 * @param title - 书名
 * @param author - 作者
 * @param coverUrl - 封面图 URL（可选，无则使用首字占位）
 * @param progress - 阅读进度 0-1（可选）
 * @param tags - 标签列表（可选）
 * @param onClick - 点击回调
 */

import React from 'react';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

export interface BookCardProps {
  title: string;
  author?: string;
  coverUrl?: string;
  progress?: number;
  tags?: string[];
  onClick?: () => void;
}

export const BookCard: React.FC<BookCardProps> = ({
  title,
  author,
  coverUrl,
  progress,
  tags,
  onClick,
}) => {
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

  /** 提取书名首字作为封面占位 */
  const firstChar = title.replace(/[\[\]【】《》「」\s]/g, '').charAt(0) || '书';

  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        gap: 12,
        padding: '12px',
        border: `1px solid ${colors['ui-border']}`,
        borderRadius: 10,
        background: colors['ui-background-secondary'],
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        color: colors['ui-text'],
      }}
    >
      {/* 封面占位 */}
      <div style={{
        width: 56,
        height: 76,
        flexShrink: 0,
        borderRadius: 6,
        background: coverUrl
          ? `url(${coverUrl}) center/cover`
          : `linear-gradient(135deg, ${colors['ui-accent']}50, ${colors['ui-accent']}20)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 26,
        fontWeight: 700,
        color: colors['ui-accent'],
      }}>
        {!coverUrl && firstChar}
      </div>

      {/* 信息区 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 15,
          fontWeight: 600,
          marginBottom: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {title}
        </div>
        {author && (
          <div style={{
            fontSize: 12,
            color: colors['ui-text-secondary'],
            marginBottom: 6,
          }}>
            {author}
          </div>
        )}
        {/* 标签 */}
        {tags && tags.length > 0 && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} style={{
                padding: '1px 6px',
                borderRadius: 4,
                background: colors['ui-background'],
                color: colors['ui-text-secondary'],
                fontSize: 10,
                border: `1px solid ${colors['ui-border']}`,
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}
        {/* 进度条 */}
        {progress !== undefined && progress > 0 && (
          <div style={{
            height: 3,
            borderRadius: 2,
            background: colors['ui-border'],
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${Math.round(progress * 100)}%`,
              background: colors['ui-accent'],
              borderRadius: 2,
              transition: 'width 0.3s',
            }} />
          </div>
        )}
      </div>
    </button>
  );
};
