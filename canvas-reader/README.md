# Canvas Reader

沉浸式 Web 小说阅读器。基于 React + TypeScript + Canvas 渲染，支持超长篇小说（百万字级别）的高性能阅读体验。

## 架构概览

```
┌──────────────────────────────────────┐
│  React UI Layer (Zustand stores)     │
│  ┌──────────────────────────────┐    │
│  │ ReaderShell → CanvasViewport  │    │
│  │ TouchLayer / TopBar / Settings│    │
│  └──────────┬───────────────────┘    │
│             │                        │
│  ┌──────────▼───────────────────┐    │
│  │  Book Data Layer              │    │
│  │  WenkuAdapter / PlainTextAdapter │ │
│  │  BookLoader / ChapterProvider │    │
│  └──────────┬───────────────────┘    │
│             │                        │
│  ┌──────────▼───────────────────┐    │
│  │  Engine Layer                 │    │
│  │  ┌─────────────────────────┐ │    │
│  │  │ TextLayoutEngine        │ │    │
│  │  │ LineBreaker (CJK-aware) │ │    │
│  │  │ Paginator (sliding win) │ │    │
│  │  └───────────┬─────────────┘ │    │
│  │  ┌───────────▼─────────────┐ │    │
│  │  │ CanvasRenderer          │ │    │
│  │  │ PagePainter / Themes     │ │    │
│  │  └─────────────────────────┘ │    │
│  │  ┌─────────────────────────┐ │    │
│  │  │ Cache: LRU + IndexedDB  │ │    │
│  │  │ Worker: layout.worker   │ │    │
│  │  └─────────────────────────┘ │    │
│  └──────────────────────────────┘    │
└──────────────────────────────────────┘
```

## 核心特性

- **Canvas 文本渲染** — 正文使用 Canvas 2D API 渲染，零 DOM 节点
- **CJK 排版引擎** — 中日韩文字自动换行、禁则处理（标点避头尾）
- **懒分页** — 滑动窗口算法，只计算当前阅读位置周围的页面，支持百万字级别小说
- **Web Worker 排版** — 文本排版计算在 Worker 中执行，不阻塞 UI 线程
- **三级缓存** — 内存 LRU → IndexedDB → Worker 缓存
- **三套主题** — 浅色 / 深色 / 护眼（即时切换，无需重新排版）
- **移动端优先** — 触摸手势、横竖屏适配、高 DPI 屏幕支持
- **PWA 离线支持** — Service Worker 缓存，离线阅读
- **格式适配器模式** — 支持多种书籍格式（可扩展 EPUB/PDF 等）
- **阅读进度持久化** — IndexedDB + LocalStorage 双重保存

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 类型检查
npm run typecheck

# 生产构建
npm run build

# 运行测试
npm test
```

## 项目结构

```
src/
├── engine/           # 框架无关的核心引擎
│   ├── layout/       # 文本排版 (TextLayoutEngine, LineBreaker, Paginator)
│   ├── render/       # Canvas 渲染 (CanvasRenderer, PagePainter, ThemeApplicator)
│   ├── cache/        # 缓存层 (PageCacheManager, ChapterCacheDB)
│   └── worker/       # Web Workers (layout.worker, render.worker)
├── reader/           # React UI 层
│   ├── components/   # 阅读器组件 (ReaderShell, CanvasViewport, SettingsPanel, etc.)
│   ├── gestures/     # 触摸手势检测
│   └── hooks/        # React Hooks (useReader, useCanvasResize, usePageTurn, etc.)
├── book/             # 书籍数据层
│   └── formats/      # 格式适配器 (WenkuAdapter, PlainTextAdapter)
├── store/            # Zustand 状态管理 (readerStore, settingsStore, uiStore)
├── themes/           # 主题定义 (light, dark, sepia)
├── services/         # 基础设施 (IndexedDB, LocalStorage)
└── utils/            # 工具函数
```

## 设计原则

1. **阅读体验优先** — 接近微信读书 / Kindle 级别的流畅阅读
2. **性能优先** — 懒分页、Worker 排版、多级缓存
3. **可扩展性** — 格式适配器模式，轻松接入新格式和 AI 功能
4. **移动端体验** — 手势操作、安全区域适配、DPR 优化

## 浏览器支持

支持所有现代浏览器（Chrome、Firefox、Safari、Edge），移动端和桌面端均可使用。
