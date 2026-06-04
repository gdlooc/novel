# 项目状态报告 — Canvas Reader

> 生成日期: 2026-05-31
> 更新日期: 2026-05-31 (初始版本)

---

## 1. 项目目标

开发一个基于 **React + TypeScript + Canvas** 的现代 Web 小说阅读器，目标体验对齐微信读书、Kindle、Apple Books。

- Canvas 原生渲染正文，零 DOM 节点
- 支持百万字级别超长篇小说
- CJK（中日韩）文字排版引擎，包含中文禁则处理
- 移动端 + 桌面端 + PWA 离线支持
- 格式适配器模式，未来可扩展 EPUB / PDF / AI 功能

---

## 2. 已完成工作

| 模块 | 文件 | 功能 | 状态 |
|---|---|---|---|
| 项目工程 | `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` | Vite + React + TS 工程搭建，路径别名，PWA 插件 | ✅ |
| 排版类型 | `engine/layout/types.ts` | TextLine, PageDescriptor, LayoutConfig, WorkerMessage 等核心类型定义 | ✅ |
| CJK 禁则处理 | `engine/layout/CjkPunctuation.ts` | 避头（。，、；：！？）》）+ 避尾（《「『（【）字符集，断行规则判断 | ✅ |
| 文本测量 | `engine/layout/TextMeasurer.ts` | Canvas measureText 封装，支持动态字体配置 | ✅ |
| CJK 断行 | `engine/layout/LineBreaker.ts` | 段落检测、标题识别、中日韩混排断行、禁则拉入/推出、场景分隔符 | ✅ |
| 懒分页 | `engine/layout/Paginator.ts` | 滑动窗口懒分页，按需计算页面，含越界保护和页号重算 | ✅ |
| 排版引擎 | `engine/layout/TextLayoutEngine.ts` | 排版编排器，统一对外 API | ✅ |
| 渲染类型 | `engine/render/types.ts` | RenderTheme, PaintOptions, ViewportState | ✅ |
| 主题系统 | `engine/render/ThemeApplicator.ts` | 浅色/深色/护眼三套主题，CSS 变量注入 DOM，主题即时切换 | ✅ |
| 页面绘制 | `engine/render/PagePainter.ts` | Canvas 2D 页面绘制：背景 → 文字 → 页眉页脚 → 进度条 | ✅ |
| 渲染器 | `engine/render/CanvasRenderer.ts` | Canvas 生命周期管理，DPR 自适应，翻页动画（滑动/淡入），预渲染 | ✅ |
| 页面缓存 | `engine/cache/PageCacheManager.ts` | 内存 LRU 页面缓存（默认 30 页），按章节批量失效 | ✅ |
| IndexedDB 缓存 | `engine/cache/ChapterCacheDB.ts` | 四表存储（books/chapters/pages/progress），含清理和空间估算 | ✅ |
| 排版 Worker | `engine/worker/layout.worker.ts` | Web Worker 离线排版，postMessage 通信协议 | ✅ |
| 渲染 Worker | `engine/worker/render.worker.ts` | OffscreenCanvas 离线渲染 → ImageBitmap 回传主线程 | ✅ |
| 格式接口 | `book/formats/IBookFormat.ts` | 书籍格式适配器接口，解耦引擎和数据源 | ✅ |
| Wenku 适配器 | `book/formats/WenkuAdapter.ts` | 读取爬虫输出的 metadata.json + chapters.json + 章节 JSON | ✅ |
| 纯文本适配器 | `book/formats/PlainTextAdapter.ts` | TXT 文件读取，正则自动检测章节边界 | ✅ |
| 书籍加载器 | `book/BookLoader.ts` | 适配器注册与选择，加载元数据 + 目录，构建导航 | ✅ |
| 章节提供器 | `book/ChapterProvider.ts` | 章节加载（缓存优先），后台预加载 | ✅ |
| 阅读器状态 | `store/readerStore.ts` | Zustand：书籍、章节、页面、进度状态 | ✅ |
| 设置状态 | `store/settingsStore.ts` | Zustand：字号/字体/行距/页边距/主题，localStorage 持久化 | ✅ |
| UI 状态 | `store/uiStore.ts` | Zustand：面板显隐、加载状态、全屏 | ✅ |
| 阅读器控制器 | `reader/hooks/useReader.ts` | 核心 Hook：打开书籍→加载章节→排版→渲染全流程编排 | ✅ |
| Canvas 尺寸 | `reader/hooks/useCanvasResize.ts` | ResizeObserver + DPR 监听，横竖屏适配 | ✅ |
| 翻页 | `reader/hooks/usePageTurn.ts` | 翻页状态机，含章节边界自动切换 | ✅ |
| 键盘导航 | `reader/hooks/useKeyboardNav.ts` | 桌面快捷键（方向键/Space/F/Esc/T） | ✅ |
| 手势检测 | `reader/gestures/useGestureDetector.ts` | Pointer Events 手势：Tap（左/中/右分区）+ Swipe + 长按 | ✅ |
| 阅读器外壳 | `reader/components/ReaderShell.tsx` | 顶层布局，组装 Canvas + 触摸层 + 工具栏 + 面板 | ✅ |
| Canvas 视口 | `reader/components/CanvasViewport.tsx` | Canvas 元素 + ResizeObserver 尺寸管理 | ✅ |
| 触摸层 | `reader/components/TouchLayer.tsx` | 透明触摸覆盖层 | ✅ |
| 顶栏/底栏 | `reader/components/TopBar.tsx`, `BottomBar.tsx` | 书名/返回/全屏，章节名/进度 | ✅ |
| 设置面板 | `reader/components/SettingsPanel.tsx` | 字号滑杆/字体选择/行距/页边距/主题切换/翻页动画 | ✅ |
| 目录面板 | `reader/components/TocPanel.tsx` | 分卷章节列表，当前章节高亮，点击跳转 | ✅ |
| 翻页动画 | `reader/components/PageTurnAnimator.tsx` | CSS 翻页过渡包装组件 | ✅ |
| 入口 | `App.tsx`, `main.tsx` | 书籍选择界面 → 阅读器界面，含自定义源输入 | ✅ |
| Service Worker | `sw.ts` | PWA 离线缓存：Cache First (静态资源) + Network First (书籍数据) | ✅ |
| PWA Manifest | `public/manifest.json` | 应用名称、图标、全屏显示、主题色 | ✅ |
| 文档 | `README.md` | 项目架构、快速开始、核心特性说明 | ✅ |

---

## 3. 已修复的关键 Bug

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | 点击示例书籍一直加载 | WenkuAdapter 查找 `book.json`/`catalog.json`，实际文件是 `metadata.json`/`chapters.json` | 重写 WenkuAdapter 匹配实际爬虫输出结构 |
| 2 | `"Unexpected token '<'"` JSON 错误 | fetch 不存在文件时 Vite 返回 HTML fallback | 添加 `fetchJSON` 校验 content-type |
| 3 | 一直加载不显示内容 | `canvasDimensions` 初始为 null，`openBook` 闭包永远看到 null | 改用 ref 存储 + `waitForCanvasDims` 轮询等待 |
| 4 | 改变窗口大小文字消失 | resize 后只更新了 canvas 尺寸但没触发重排版 | 添加 `useEffect` 监听尺寸变化并触发 `onSettingsChanged` |
| 5 | 文字超出屏幕未正确换行 | LineBreaker 跳过空格时不累加宽度，`"Hello World"` 被当作 `"HelloWorld"` 测量 | 空格和其他字符一样累加宽度 |
| 6 | 普通段落被居中显示 | 标题检测过于激进：≤30字符 + 不以标点结尾 → 居中 | 改为仅匹配显式标题模式（第X章/序章/尾声等） |
| 7 | 改字号后不重排版 | `onSettingsChanged` 触发了排版但 `CanvasRenderer` 内部仍用旧 config 渲染 | 在 settings effect 中先 `renderer.updateConfig({ config })` 再重排版 |
| 8 | 字号增大后当前页码越界 | 旧 pageIndex（如第 10 页）在新布局中可能不存在（只 8 页） | 改用 charOffset（字符位置，布局无关）定位阅读位置 |

---

## 4. 当前架构

```
canvas-reader/
├── index.html                    # SPA 入口
├── package.json                  # 依赖：React 18, TypeScript 5, Zustand 4, idb 8
├── vite.config.ts                # Vite 5 + React 插件 + crawler 静态服务 + 路径别名
├── tsconfig.json                 # TypeScript 严格模式
│
├── public/
│   ├── manifest.json             # PWA Manifest
│   └── vite.svg                  # 应用图标
│
├── src/
│   ├── engine/                   # ═══ 框架无关引擎层 ═══
│   │   ├── layout/               #   文本排版 (6 文件)
│   │   │   ├── types.ts              # 核心类型 (TextLine, PageDescriptor, LayoutConfig)
│   │   │   ├── CjkPunctuation.ts     # CJK 禁则处理字符集 + 断行规则
│   │   │   ├── TextMeasurer.ts       # Canvas measureText 封装
│   │   │   ├── LineBreaker.ts        # 中日韩混排断行 + 段落/标题/分隔符检测
│   │   │   ├── Paginator.ts          # 滑动窗口懒分页
│   │   │   └── TextLayoutEngine.ts   # 排版编排器
│   │   ├── render/               #   Canvas 渲染 (4 文件)
│   │   │   ├── types.ts              # RenderTheme, PaintOptions
│   │   │   ├── ThemeApplicator.ts    # 三套主题 + DOM CSS 变量注入
│   │   │   ├── PagePainter.ts        # 单页 Canvas 2D 绘制
│   │   │   └── CanvasRenderer.ts     # Canvas 生命周期 + DPR + 动画 + 预渲染
│   │   ├── cache/                #   缓存层 (3 文件)
│   │   │   ├── PageCacheManager.ts   # LRU 内存缓存
│   │   │   └── ChapterCacheDB.ts     # IndexedDB 持久化缓存
│   │   ├── worker/               #   Web Worker (2 文件)
│   │   │   ├── layout.worker.ts      # 离线排版 Worker
│   │   │   └── render.worker.ts      # OffscreenCanvas 渲染 Worker
│   │   └── index.ts
│   │
│   ├── book/                     # ═══ 书籍数据层 ═══
│   │   ├── types.ts                  # BookSource, BookMetadata, TocEntry, ChapterContent
│   │   ├── formats/
│   │   │   ├── IBookFormat.ts        # 格式适配器接口
│   │   │   ├── WenkuAdapter.ts       # 爬虫输出 JSON 适配器
│   │   │   └── PlainTextAdapter.ts   # 纯文本适配器
│   │   ├── BookLoader.ts             # 适配器注册与选择
│   │   └── ChapterProvider.ts        # 章节加载（缓存优先 + 预加载）
│   │
│   ├── store/                    # ═══ Zustand 状态管理 ═══
│   │   ├── readerStore.ts            # 阅读状态 (book/chapter/page/position)
│   │   ├── settingsStore.ts          # 阅读设置 (font/theme/margins)
│   │   └── uiStore.ts                # UI 状态 (panels/loading/fullscreen)
│   │
│   ├── reader/                   # ═══ React UI 层 ═══
│   │   ├── components/
│   │   │   ├── ReaderShell.tsx       # 顶层布局
│   │   │   ├── CanvasViewport.tsx    # Canvas 视口
│   │   │   ├── TouchLayer.tsx        # 触摸层
│   │   │   ├── TopBar.tsx            # 顶栏
│   │   │   ├── BottomBar.tsx         # 底栏
│   │   │   ├── SettingsPanel.tsx     # 设置面板
│   │   │   ├── TocPanel.tsx          # 目录面板
│   │   │   └── PageTurnAnimator.tsx  # 翻页动画
│   │   ├── hooks/
│   │   │   ├── useReader.ts          # 核心控制器
│   │   │   ├── useCanvasResize.ts    # Canvas 尺寸管理
│   │   │   ├── usePageTurn.ts        # 翻页逻辑
│   │   │   └── useKeyboardNav.ts     # 键盘快捷键
│   │   └── gestures/
│   │       ├── types.ts              # 手势类型
│   │       └── useGestureDetector.ts # 手势检测
│   │
│   ├── services/storage/         # ═══ 基础设施 ═══
│   │   ├── localStorage.ts           # 类型安全的 localStorage
│   │   ├── idb.ts                    # IndexedDB re-export
│   │   └── ProgressCache.ts          # 阅读进度持久化
│   │
│   ├── themes/                   # ═══ 主题定义 ═══
│   │   └── types.ts, light.ts, dark.ts, sepia.ts
│   │
│   ├── utils/                    # ═══ 工具 ═══
│   │   ├── debounce.ts
│   │   ├── fontLoader.ts
│   │   └── dpr.ts
│   │
│   ├── App.tsx                   # 根组件
│   ├── main.tsx                  # 入口
│   └── sw.ts                     # Service Worker
```

### 数据流

```
用户点击书籍
    │
    ▼
BookLoader.loadBook(source)
    ├── 1. WenkuAdapter.getMetadata()    → metadata.json → BookMetadata
    ├── 2. WenkuAdapter.getToc()         → chapters.json → ChapterNav
    └── 3. restoreReadingProgress()      → 恢复到上次阅读位置
            │
            ▼
useReader.goToChapter(chapterId)
    ├── ChapterProvider.loadChapter()    → chapters/{cid}.json → 文本内容
    └── layoutCurrentChapter()
            │
            ▼
TextLayoutEngine.layout(text, config)
    ├── TextMeasurer.configure(config)
    ├── LineBreaker.breakTextIntoLines() → TextLine[] (CJK禁则处理)
    └── Paginator.paginate()             → PageDescriptor[] (滑动窗口)
            │
            ▼
store.setCurrentPage(page)
            │
            ▼
CanvasRenderer.renderPage(page)
    └── PagePainter.paintPage(ctx, page, config, theme)
        ├── 背景填充 (theme.backgroundColor)
        ├── 逐行 drawText (theme.textColor, config.fontFamily, config.fontSize)
        ├── 页眉 (章节名)
        └── 页脚 (页码 + 进度条)
```

### 性能策略

| 层级 | 机制 | 说明 |
|---|---|---|
| 排版 | Web Worker | 文本分行分页在 Worker 中完成，不阻塞 UI 线程 |
| 分页 | 滑动窗口懒加载 | 每次计算 10 页，按需扩展，绝不一次性分页整本书 |
| 缓存 L1 | 内存 LRU | 最多 30 页，最近最少使用淘汰 |
| 缓存 L2 | IndexedDB | 最多 500 页，7 天 TTL，跨 session |
| 渲染 | 预渲染 + RAF | 下一页提前渲染到离屏 Canvas，requestAnimationFrame 动画 |
| 字号变化 | charOffset 定位 | 用字符偏移量（布局无关）而非页码（布局相关）定位阅读位置 |
| 配置变化 | 防抖 300ms | 滑杆拖动字号时不频繁重排 |

---

## 5. 待完成任务

| 优先级 | 任务 | 说明 |
|---|---|---|
| P1 | 单元测试 | 为 LineBreaker、CjkPunctuation、Paginator、TextMeasurer 编写 Vitest 测试 |
| P1 | 实际使用验证 | 在真实移动设备和桌面浏览器中完整阅读测试 |
| P2 | 章间预加载优化 | 当前有基础预加载但可更加智能（根据阅读速度预测） |
| P2 | 滚动模式 | 当前仅支持翻页模式，部分用户偏好连续滚动 |
| P2 | 文本选择/划线/笔记 | 阅读标注功能 |
| P2 | EPUB 适配器 | 添加 `EPUBAdapter` 支持标准电子书格式 |
| P2 | PDF 适配器 | 添加 `PDFAdapter`（漫画/扫描书场景） |
| P3 | 云同步 | 跨设备阅读进度和笔记同步 |
| P3 | AI 朗读 | TTS 语音合成朗读 |
| P3 | AI 总结/问书 | 接入 LLM 实现章节总结和问答 |
| P3 | 漫画阅读模式 | 图片浏览 + 缩放，与文本阅读共用阅读器框架 |

---

## 6. 已知问题

| # | 问题 | 影响 | 解决方案 |
|---|---|---|---|
| 1 | 无单元测试覆盖 | 重构风险较高 | P1：添加 Vitest 测试 |
| 2 | Worker 排版未实际启用 | 当前排版在主线程同步执行，layout.worker.ts 已编写但未集成 | 在 useReader 中接入 Worker |
| 3 | 调试依赖 dev server | Vite 自定义中间件（crawler-server）仅在 dev 模式生效 | 生产环境需将书籍数据放入 public/ 或通过 HTTP API 获取 |
| 4 | 超长章节一次排版全部行 | `breakTextIntoLines` 对整个章节文本一次性分所有行 | 对于超长章节（>10万字单章），可改为流式分行 |

---

## 7. 下一步计划

1. **添加单元测试** — 优先覆盖 LineBreaker（CJK 断行正确性）和 Paginator（边界情况）
2. **Worker 集成** — 将 layout.worker.ts 实际接入 useReader，真正实现离线程排版
3. **实际阅读测试** — 用爬虫已下载的小说进行多章节连续阅读测试
4. **移动端实地测试** — 在 iPhone/Android 真机上测试触摸手势和 PWA
5. **性能压测** — 百万字小说加载、连续翻页 100 页内存监控
