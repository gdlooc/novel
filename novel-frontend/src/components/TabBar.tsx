/**
 * TabBar — 通用标签栏组件。
 *
 * @param tabs - 标签配置数组
 * @param activeKey - 当前激活的标签 key
 * @param onChange - 标签切换回调
 */

import React from 'react';
import { useSettingsStore } from '@store/settingsStore';
import { getThemeById } from '@engine/render/ThemeApplicator';

export interface TabItem {
  key: string;
  label: string;
}

export interface TabBarProps {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

export const TabBar: React.FC<TabBarProps> = ({ tabs, activeKey, onChange }) => {
  const theme = useSettingsStore((s) => s.theme);
  const colors = getThemeById(theme).cssVariables;

  return (
    <div style={{
      display: 'flex',
      background: colors['ui-background-secondary'],
      borderRadius: 10,
      padding: 3,
      gap: 2,
    }}>
      {tabs.map((tab) => {
        const active = activeKey === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
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
              transition: 'background 0.15s, color 0.15s',
              boxShadow: active ? `0 1px 3px ${colors['ui-border']}80` : 'none',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
