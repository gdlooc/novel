/**
 * SettingsPanel — Slide-up settings sheet.
 *
 * Provides controls for:
 * - Font size (slider)
 * - Font family (picker)
 * - Line height (slider)
 * - Theme (light/dark/sepia)
 * - Paragraph indent toggle
 * - Page turn animation style
 * - Show/hide header & footer
 */

import React from 'react';
import { useSettingsStore, type ThemeId } from '@store/settingsStore';
import { useUIStore } from '@store/uiStore';
import { getThemeById, ALL_THEMES } from '@engine/render/ThemeApplicator';
import { DEFAULT_CJK_FONTS } from '@/utils/fontLoader';

export const SettingsPanel: React.FC = () => {
  const settings = useSettingsStore();
  const { setShowSettings } = useUIStore();
  const theme = getThemeById(settings.theme);
  const colors = theme.cssVariables;

  const panelStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 200,
    maxHeight: '70vh',
    overflowY: 'auto',
    background: colors['ui-background'],
    borderTop: `1px solid ${colors['ui-border']}`,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: '20px 16px',
    paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
    color: colors['ui-text'],
    boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
  };

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 199,
    background: 'rgba(0,0,0,0.3)',
  };

  return (
    <>
      {/* Backdrop */}
      <div style={overlayStyle} onClick={() => setShowSettings(false)} />

      {/* Panel */}
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>阅读设置</h2>
          <button
            onClick={() => setShowSettings(false)}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 20,
              color: colors['ui-text-secondary'],
              cursor: 'pointer',
              padding: 4,
            }}
          >
            ✕
          </button>
        </div>

        {/* Font size */}
        <SettingRow label={`字号 (${settings.fontSize}px)`}>
          <Slider
            min={10}
            max={32}
            step={1}
            value={settings.fontSize}
            onChange={(v) => settings.setFontSize(v)}
            colors={colors}
          />
        </SettingRow>

        {/* Line height */}
        <SettingRow label={`行距 (${settings.lineHeight.toFixed(1)})`}>
          <Slider
            min={1.2}
            max={2.8}
            step={0.1}
            value={settings.lineHeight}
            onChange={(v) => settings.setLineHeight(v)}
            colors={colors}
          />
        </SettingRow>

        {/* Paragraph indent */}
        <SettingRow label={`段落缩进 (${settings.paragraphIndent}em)`}>
          <Slider
            min={0}
            max={4}
            step={0.5}
            value={settings.paragraphIndent}
            onChange={(v) => settings.setParagraphIndent(v)}
            colors={colors}
          />
        </SettingRow>

        {/* Page margin */}
        <SettingRow label={`页边距`}>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
              <button
                key={side}
                onClick={() => {
                  const current = settings[`padding${side.charAt(0).toUpperCase() + side.slice(1)}` as keyof typeof settings] as number;
                  const newVal = current >= 36 ? 8 : current + 4;
                  settings.setPadding(side, newVal);
                }}
                style={{
                  padding: '4px 10px',
                  border: `1px solid ${colors['ui-border']}`,
                  borderRadius: 6,
                  background: colors['ui-background-secondary'],
                  color: colors['ui-text'],
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {side === 'top' ? '上' : side === 'bottom' ? '下' : side === 'left' ? '左' : '右'}
              </button>
            ))}
          </div>
        </SettingRow>

        {/* Theme selector */}
        <SettingRow label="主题">
          <div style={{ display: 'flex', gap: 8 }}>
            {ALL_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => settings.setTheme(t.id as ThemeId)}
                style={{
                  padding: '8px 16px',
                  border: `2px solid ${settings.theme === t.id ? colors['ui-accent'] : colors['ui-border']}`,
                  borderRadius: 8,
                  background: t.backgroundColor,
                  color: t.textColor,
                  fontSize: 13,
                  fontWeight: settings.theme === t.id ? 600 : 400,
                  cursor: 'pointer',
                  flex: 1,
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </SettingRow>

        {/* Page turn animation */}
        <SettingRow label="翻页动画">
          <div style={{ display: 'flex', gap: 8 }}>
            {([
              { id: 'curl' as const, label: '翻书' },
              { id: 'slide' as const, label: '滑动' },
              { id: 'fade' as const, label: '淡入' },
              { id: 'none' as const, label: '无' },
            ]).map((anim) => (
              <button
                key={anim.id}
                onClick={() => settings.setPageTurnAnimation(anim.id)}
                style={{
                  padding: '6px 14px',
                  border: `2px solid ${settings.pageTurnAnimation === anim.id ? colors['ui-accent'] : colors['ui-border']}`,
                  borderRadius: 6,
                  background: settings.pageTurnAnimation === anim.id ? colors['ui-accent'] + '20' : 'transparent',
                  color: colors['ui-text'],
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {anim.label}
              </button>
            ))}
          </div>
        </SettingRow>

        {/* 阅读模式 */}
        <SettingRow label="阅读模式">
          <div style={{ display: 'flex', gap: 8 }}>
            {([
              { id: 'paged' as const, label: '翻页' },
              { id: 'scroll' as const, label: '滚动' },
            ]).map((mode) => (
              <button
                key={mode.id}
                onClick={() => settings.setReadingMode(mode.id)}
                style={{
                  padding: '6px 14px',
                  border: `2px solid ${settings.readingMode === mode.id ? colors['ui-accent'] : colors['ui-border']}`,
                  borderRadius: 6,
                  background: settings.readingMode === mode.id ? colors['ui-accent'] + '20' : 'transparent',
                  color: colors['ui-text'],
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </SettingRow>

        {/* Toggles */}
        <SettingRow label="">
          <ToggleItem
            label="显示页眉页脚"
            checked={settings.showHeaderFooter}
            onChange={settings.setShowHeaderFooter}
            colors={colors}
          />
          <ToggleItem
            label="显示阅读进度"
            checked={settings.showProgressBar}
            onChange={settings.setShowProgressBar}
            colors={colors}
          />
        </SettingRow>
      </div>
    </>
  );
};

// ─── Sub-components ───

const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div style={{ marginBottom: 16 }}>
    {label ? (
      <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>{label}</div>
    ) : null}
    {children}
  </div>
);

const Slider: React.FC<{
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  colors: Record<string, string>;
}> = ({ min, max, step, value, onChange, colors }) => (
  <input
    type="range"
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={(e) => onChange(parseFloat(e.target.value))}
    style={{
      width: '100%',
      height: 6,
      appearance: 'none',
      WebkitAppearance: 'none',
      background: `linear-gradient(to right, ${colors['ui-accent']} ${((value - min) / (max - min)) * 100}%, ${colors['ui-slider-track']} ${((value - min) / (max - min)) * 100}%)`,
      borderRadius: 3,
      outline: 'none',
      cursor: 'pointer',
    }}
  />
);

const ToggleItem: React.FC<{
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  colors: Record<string, string>;
}> = ({ label, checked, onChange, colors }) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 0',
      cursor: 'pointer',
      fontSize: 14,
    }}
  >
    <span>{label}</span>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      style={{
        width: 20,
        height: 20,
        accentColor: colors['ui-accent'],
      }}
    />
  </label>
);
