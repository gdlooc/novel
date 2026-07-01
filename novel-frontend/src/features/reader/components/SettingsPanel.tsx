/**
 * SettingsPanel — 阅读设置滑出面板。
 *
 * 提供字号、行距、段落缩进、页边距、主题、翻页动画、阅读模式等控制。
 *
 * 滑块使用 shadcn/ui Slider 替代原生 <input type="range">，
 * 开关使用 shadcn/ui Switch 替代原生 checkbox。
 */
import React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useSettingsStore, type ThemeId } from '@store/settingsStore';
import { useUIStore } from '@store/uiStore';
import { getThemeById, ALL_THEMES } from '@engine/render/ThemeApplicator';

export const SettingsPanel: React.FC = () => {
  const settings = useSettingsStore();
  const { setShowSettings } = useUIStore();
  const theme = getThemeById(settings.theme);
  const colors = theme.cssVariables;

  return (
    <>
      {/* Backdrop — 半透明遮罩，点击关闭 */}
      <div
        className="fixed inset-0 z-[199] bg-black/30"
        onClick={() => setShowSettings(false)}
      />

      {/* Panel — 底部滑出面板 */}
      <div
        className="absolute bottom-0 left-0 right-0 z-[200] max-h-[70vh] overflow-y-auto bg-background border-t border-border rounded-t-2xl p-5 shadow-[0_-4px_20px_rgba(0,0,0,0.15)] text-foreground"
        style={{ paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))' }}
      >
        {/* 标题栏 */}
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold">阅读设置</h2>
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(false)}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* ── 字号 ── */}
        <SettingRow label={`字号 (${settings.fontSize}px)`}>
          <Slider
            min={10}
            max={32}
            step={1}
            value={[settings.fontSize]}
            onValueChange={([v]) => settings.setFontSize(v)}
          />
        </SettingRow>

        {/* ── 行距 ── */}
        <SettingRow label={`行距 (${settings.lineHeight.toFixed(1)})`}>
          <Slider
            min={1.2}
            max={2.8}
            step={0.1}
            value={[settings.lineHeight]}
            onValueChange={([v]) => settings.setLineHeight(v)}
          />
        </SettingRow>

        {/* ── 段落缩进 ── */}
        <SettingRow label={`段落缩进 (${settings.paragraphIndent}em)`}>
          <Slider
            min={0}
            max={4}
            step={0.5}
            value={[settings.paragraphIndent]}
            onValueChange={([v]) => settings.setParagraphIndent(v)}
          />
        </SettingRow>

        {/* ── 页边距 ── */}
        <SettingRow label="页边距">
          <div className="flex gap-2">
            {(['上', '下', '左', '右'] as const).map((label, i) => {
              const sides = ['top', 'bottom', 'left', 'right'] as const;
              const side = sides[i];
              const key = `padding${side.charAt(0).toUpperCase() + side.slice(1)}` as keyof typeof settings;
              const current = settings[key] as number;
              return (
                <Button
                  key={side}
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const newVal = current >= 36 ? 8 : current + 4;
                    settings.setPadding(side, newVal);
                  }}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </SettingRow>

        {/* ── 主题 ── */}
        <SettingRow label="主题">
          <div className="flex gap-2">
            {ALL_THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => settings.setTheme(t.id as ThemeId)}
                className={`flex-1 py-2 px-4 border-2 rounded-lg text-[13px] cursor-pointer transition-colors ${
                  settings.theme === t.id ? 'font-semibold' : 'font-normal'
                }`}
                style={{
                  background: t.backgroundColor,
                  color: t.textColor,
                  borderColor: settings.theme === t.id ? colors['ui-accent'] : colors['ui-border'],
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </SettingRow>

        {/* ── 翻页动画 ── */}
        <SettingRow label="翻页动画">
          <div className="flex gap-2">
            {([
              { id: 'curl' as const, label: '翻书' },
              { id: 'slide' as const, label: '滑动' },
              { id: 'fade' as const, label: '淡入' },
              { id: 'none' as const, label: '无' },
            ]).map((anim) => (
              <Button
                key={anim.id}
                variant={settings.pageTurnAnimation === anim.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => settings.setPageTurnAnimation(anim.id)}
              >
                {anim.label}
              </Button>
            ))}
          </div>
        </SettingRow>

        {/* ── 阅读模式 ── */}
        <SettingRow label="阅读模式">
          <div className="flex gap-2">
            {([
              { id: 'paged' as const, label: '翻页' },
              { id: 'scroll' as const, label: '滚动' },
            ]).map((mode) => (
              <Button
                key={mode.id}
                variant={settings.readingMode === mode.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => settings.setReadingMode(mode.id)}
              >
                {mode.label}
              </Button>
            ))}
          </div>
        </SettingRow>

        {/* ── 开关项 ── */}
        <SettingRow label="">
          <div className="space-y-2">
            <label className="flex items-center justify-between py-2 cursor-pointer text-sm">
              <span>显示页眉页脚</span>
              <Switch
                checked={settings.showHeaderFooter}
                onCheckedChange={settings.setShowHeaderFooter}
              />
            </label>
            <label className="flex items-center justify-between py-2 cursor-pointer text-sm">
              <span>显示阅读进度</span>
              <Switch
                checked={settings.showProgressBar}
                onCheckedChange={settings.setShowProgressBar}
              />
            </label>
          </div>
        </SettingRow>
      </div>
    </>
  );
};

// ─── 子组件 ───

/** 设置项包装，包含标签和内容 */
const SettingRow: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="mb-4">
    {label ? (
      <div className="text-[13px] text-muted-foreground mb-1.5">{label}</div>
    ) : null}
    {children}
  </div>
);
