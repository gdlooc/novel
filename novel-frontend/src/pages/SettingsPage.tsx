/**
 * SettingsPage — 设置页。
 *
 * 提供应用级全局设置：
 * - 主题切换（浅色/深色/护眼）
 * - 可扩展更多设置项
 *
 * 阅读相关的排版设置（字号/行距等）仍在阅读器内的 SettingsPanel 中。
 */

import React from 'react';
import { useSettingsStore, type ThemeId } from '@store/settingsStore';
import { getThemeById, ALL_THEMES } from '@engine/render/ThemeApplicator';

export const SettingsPage: React.FC = () => {
  const settings = useSettingsStore();
  const colors = getThemeById(settings.theme).cssVariables;

  return (
    <div style={{
      height: '100%',
      overflowY: 'auto',
      background: colors['ui-background'],
      color: colors['ui-text'],
      padding: '16px',
    }}>
      <h2 style={{
        fontSize: 18,
        fontWeight: 600,
        margin: '0 0 20px',
      }}>
        设置
      </h2>

      {/* ── 主题 ── */}
      <section style={{ marginBottom: 24 }}>
        <h3 style={{
          fontSize: 13,
          color: colors['ui-text-secondary'],
          fontWeight: 500,
          marginBottom: 10,
        }}>
          主题
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {ALL_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => settings.setTheme(t.id as ThemeId)}
              style={{
                padding: '10px 20px',
                border: `2px solid ${settings.theme === t.id ? colors['ui-accent'] : colors['ui-border']}`,
                borderRadius: 10,
                background: t.backgroundColor,
                color: t.textColor,
                fontSize: 14,
                fontWeight: settings.theme === t.id ? 600 : 400,
                cursor: 'pointer',
                flex: 1,
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      </section>

      {/* ── 关于 ── */}
      <section>
        <h3 style={{
          fontSize: 13,
          color: colors['ui-text-secondary'],
          fontWeight: 500,
          marginBottom: 10,
        }}>
          关于
        </h3>
        <div style={{
          fontSize: 13,
          color: colors['ui-text-secondary'],
          lineHeight: 1.6,
        }}>
          <p>Canvas Reader v0.1.0</p>
          <p>基于 React + TypeScript + Canvas 的轻小说阅读器</p>
        </div>
      </section>
    </div>
  );
};
