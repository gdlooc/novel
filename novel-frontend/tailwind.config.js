/**
 * Tailwind CSS 配置。
 *
 * 颜色系统策略：直接引用 ThemeApplicator 注入到 :root 的 --reader-* CSS 变量，
 * 不包装 hsl() 函数，因为现有的三套主题变量是十六进制颜色值。
 *
 * 当用户切换阅读主题（浅色/深色/护眼）时，applyThemeToDOM 更新 :root 上的变量，
 * Tailwind 的 utility class 自动跟随变化，无需重新加载页面。
 *
 * @see src/engine/render/ThemeApplicator.ts
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── 基础色：直接引用 --reader-* CSS 变量 ──
        border: "var(--reader-ui-border)",
        input: "var(--reader-ui-border)",
        ring: "var(--reader-ui-accent)",
        background: "var(--reader-ui-background)",
        foreground: "var(--reader-ui-text)",
        primary: {
          DEFAULT: "var(--reader-ui-accent)",
          foreground: "var(--reader-ui-background)", // 白底蓝字 → 蓝底白字
        },
        secondary: {
          DEFAULT: "var(--reader-ui-background-secondary)",
          foreground: "var(--reader-ui-text)",
        },
        muted: {
          DEFAULT: "var(--reader-ui-background-secondary)",
          foreground: "var(--reader-ui-text-secondary)",
        },
        accent: {
          DEFAULT: "var(--reader-ui-overlay)",
          foreground: "var(--reader-ui-text)",
        },
        destructive: {
          DEFAULT: "var(--reader-ui-danger)",
          foreground: "#FFFFFF",
        },
        card: {
          DEFAULT: "var(--reader-ui-background-secondary)",
          foreground: "var(--reader-ui-text)",
        },
        popover: {
          DEFAULT: "var(--reader-ui-background)",
          foreground: "var(--reader-ui-text)",
        },
        // ── 滑块专用色 ──
        slider: {
          track: "var(--reader-ui-slider-track)",
          fill: "var(--reader-ui-slider-fill)",
        },
      },
      borderRadius: {
        lg: "var(--reader-radius, 0.5rem)",
        md: "calc(var(--reader-radius, 0.5rem) - 2px)",
        sm: "calc(var(--reader-radius, 0.5rem) - 4px)",
      },
      keyframes: {
        "slide-up": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "slide-up": "slide-up 0.3s ease-out",
        "fade-in": "fade-in 0.2s ease-out",
      },
    },
  },
  plugins: [],
}
