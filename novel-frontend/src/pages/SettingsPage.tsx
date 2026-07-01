/**
 * SettingsPage — 设置页。
 *
 * 提供应用级全局设置：主题切换、关于信息。
 * 阅读相关的排版设置在阅读器内的 SettingsPanel 中。
 */
import React from 'react';
import { useSettingsStore, type ThemeId } from '@store/settingsStore';
import { ALL_THEMES } from '@engine/render/ThemeApplicator';

export const SettingsPage: React.FC = () => {
  const settings = useSettingsStore();

  return (
    <div className="h-full overflow-y-auto bg-background text-foreground p-4">
      <h2 className="text-lg font-semibold mb-5">设置</h2>

      {/* ── 主题 ── */}
      <section className="mb-6">
        <h3 className="text-[13px] text-muted-foreground font-medium mb-2.5">主题</h3>
        <div className="flex gap-2">
          {ALL_THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => settings.setTheme(t.id as ThemeId)}
              className={`flex-1 py-2.5 px-5 border-2 rounded-[10px] text-sm font-medium cursor-pointer transition-colors ${
                settings.theme === t.id ? 'font-semibold' : 'font-normal'
              }`}
              style={{
                background: t.backgroundColor,
                color: t.textColor,
                borderColor: settings.theme === t.id
                  ? `var(--reader-ui-accent, ${t.accentColor})`
                  : `var(--reader-ui-border, ${t.backgroundColor})`,
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      </section>

      {/* ── 关于 ── */}
      <section>
        <h3 className="text-[13px] text-muted-foreground font-medium mb-2.5">关于</h3>
        <div className="text-[13px] text-muted-foreground leading-relaxed">
          <p>Canvas Reader v0.1.0</p>
          <p>基于 React + TypeScript + Canvas 的轻小说阅读器</p>
        </div>
      </section>
    </div>
  );
};
