# 轻小说阅读器 — UI 设计方案需求文档

> 请基于本文档，为该项目设计一套全新的、更美观的配色方案。
> 只需提供三套主题的色值定义即可直接生效，无需编写任何代码。

---

## 1. 项目简介

一个基于 **React + TypeScript + Canvas** 的 Web 轻小说阅读器，对标微信读书 / Kindle / Apple Books 的阅读体验。Canvas 原生渲染正文，React + shadcn/ui + Tailwind CSS 渲染 UI 层（导航栏、设置面板、书库等）。

## 2. 技术约束

### 2.1 设计实现方式

整个 UI 的颜色由 **三套 CSS 变量主题** 驱动，不需要改组件代码。你只需为「浅色 / 深色 / 护眼」三套主题各提供一组色值即可。

### 2.2 需要提供的色值

每套主题需要以下 **11 个色值**（其中 9 个是 CSS 变量名对应的 UI 色，2 个是 Canvas 阅读区色）：

| 变量名 / 属性 | 用途 | 说明 |
|---------------|------|------|
| `backgroundColor` | Canvas 阅读区背景色 | 读者看文字时的底色 |
| `textColor` | Canvas 阅读区文字色 | 正文颜色 |
| `textColorSecondary` | Canvas 次要文字色 | 页眉页脚、进度条文字 |
| `accentColor` | Canvas 强调色 | 选中文字高亮、进度条填充 |
| `selectionColor` | Canvas 选中色 | 文字选中时的半透明遮罩 |
| `ui-background` | 页面/面板主背景 | 首页、设置面板底色 |
| `ui-background-secondary` | 卡片/次级区域背景 | 书单卡片、标签背景 |
| `ui-text` | 主文字色 | 标题、正文 |
| `ui-text-secondary` | 次文字色 | 辅助说明、时间戳 |
| `ui-border` | 边框/分割线 | 卡片边框、列表分割 |
| `ui-accent` | 品牌强调色 | 按钮、选中态、链接、进度条 |
| `ui-overlay` | 悬浮层背景 | hover 态、选中态底色 |
| `ui-danger` | 危险/删除色 | 删除按钮、错误提示 |
| `ui-slider-track` | 滑块轨道色 | 设置面板滑块未填充部分 |
| `ui-slider-fill` | 滑块填充色 | 设置面板滑块已填充部分 |

### 2.3 技术要求

- 所有色值使用 **十六进制**（如 `#FB7299`），`ui-overlay` 和 `selectionColor` 使用 **rgba**
- Canvas 阅读区背景和 UI 背景应有所区分（不能完全一样），否则阅读区和面板边界模糊
- 深色模式下 `ui-accent` 应比浅色模式稍亮（暗底上同色会显得暗淡）
- 护眼模式底色应为暖黄色系，但不能丢失品牌感
- 三套主题之间切换应该能明显感知变化

## 3. 当前配色（bilibili 风格）

供参考，你可以完全推翻重来。

### 浅色模式
```
backgroundColor:          '#F6F7F8'
textColor:                '#18191C'
textColorSecondary:       '#9499A0'
accentColor:              '#FB7299'   (bilibili 粉)
selectionColor:           'rgba(251, 114, 153, 0.25)'
ui-background:            '#FFFFFF'
ui-background-secondary:  '#F6F7F8'
ui-text:                  '#18191C'
ui-text-secondary:        '#9499A0'
ui-border:                '#E3E5E7'
ui-accent:                '#FB7299'
ui-overlay:               'rgba(251, 114, 153, 0.06)'
ui-danger:                '#F85A5A'
ui-slider-track:          '#E3E5E7'
ui-slider-fill:           '#FB7299'
```

### 深色模式
```
backgroundColor:          '#1A1A1C'
textColor:                '#E8E8EA'
textColorSecondary:       '#9499A0'
accentColor:              '#FC8CAC'
selectionColor:           'rgba(252, 140, 172, 0.25)'
ui-background:            '#1E1E20'
ui-background-secondary:  '#28282C'
ui-text:                  '#E8E8EA'
ui-text-secondary:        '#9499A0'
ui-border:                '#38383C'
ui-accent:                '#FC8CAC'
ui-overlay:               'rgba(255, 255, 255, 0.06)'
ui-danger:                '#F85A5A'
ui-slider-track:          '#38383C'
ui-slider-fill:           '#FC8CAC'
```

### 护眼模式
```
backgroundColor:          '#F5F0E8'
textColor:                '#4A4036'
textColorSecondary:       '#8C8276'
accentColor:              '#FB7299'
selectionColor:           'rgba(251, 114, 153, 0.25)'
ui-background:            '#EDE8DE'
ui-background-secondary:  '#E3DDD2'
ui-text:                  '#4A4036'
ui-text-secondary:        '#8C8276'
ui-border:                '#D4C9B8'
ui-accent:                '#FB7299'
ui-overlay:               'rgba(180, 160, 140, 0.10)'
ui-danger:                '#C0392B'
ui-slider-track:          '#D4C9B8'
ui-slider-fill:           '#FB7299'
```

## 4. UI 界面截图说明

由于无法提供截图，以下是各页面的文字描述：

### 4.1 首页（HomePage）
- 顶部大标题「📖 轻小说」+ 副标题
- 「最近阅读」区域：横向卡片列表，每张卡片包含封面首字占位、书名、作者、阅读进度条
- 「探索发现」区域：3×2 网格的分类入口卡片（全部作品 / 连载中 / 已完结 / 校园 / 奇幻 / 恋爱），每张卡片包含 emoji 图标 + 文字
- 「精品推荐」区域：纵向书籍卡片列表

### 4.2 书库页（LibraryPage）
- 左侧 220px 筛选面板：分组垂直排列（完结状态 / 下载状态 / 评分 / 题材），每组由标题 + 选项芯片组成
- 右侧书籍卡片列表
- 顶部可横向滚动的激活筛选标签行

### 4.3 书籍详情页（BookDetailPage）
- 居中封面首字占位（80×110px）
- 书名、作者
- 字数 / 章节数 / 状态 信息行
- 标签横向排列
- 简介灰色圆角卡片
- 全宽「开始阅读」按钮
- 按分卷分组的章节目录列表

### 4.4 搜索页（SearchPage）
- 搜索输入框 + 搜索按钮
- 搜索结果列表（复用书籍卡片）
- 未搜索时显示提示文案

### 4.5 阅读器界面（ReaderShell）
- **全屏 Canvas 渲染正文**（这是核心，占据 100% 视口）
- 顶部工具栏：半透明玻璃质感背景（`backdrop-filter: blur(12px)`），左箭头 + 分卷·章节名
- 底部工具栏：半透明玻璃质感背景，4 个图标按钮（目录 / 设置 / 书签 / 搜索）
- 设置面板：底部滑出，包含字号滑块、行距滑块、页边距按钮、主题切换、翻页动画选择、阅读模式选择、开关项
- 目录面板：底部滑出，按分卷分组的章节列表，当前章节高亮（左边框强调色）

### 4.6 底部导航栏（BottomNav）
- 玻璃质感背景，4 个入口：首页 / 书库 / 历史 / 设置
- 选中态使用 `ui-accent`，未选中使用 `ui-text-secondary`

### 4.7 设置页（SettingsPage）
- 三个主题按钮水平排列，每个按钮背景色为该主题的实际 `backgroundColor`，文字色为该主题的 `textColor`，边框为 `ui-accent`（选中）或 `ui-border`（未选中）
- 关于信息

## 5. 设计方向建议

以下方向供参考，请选择其一或自由发挥：

### 方向 A：Apple Books 风格
- 极简、大量留白、SF 字体质感
- 浅色：暖白底 + 深灰文字 + San Francisco 蓝（`#007AFF`）
- 深色：纯黑底 + 高对比度白字

### 方向 B：Kindle 风格
- 纸张质感、暖色调、仿书体验
- 浅色：米白底 + 深棕文字 + 暗蓝强调（`#4A6FA5`）
- 深色：深灰底

### 方向 C：Notion 风格
- 现代简约、低对比度、黑白灰为主
- 强调色使用柔和蓝/紫
- 大量使用灰度层次

### 方向 D：Material You (Google)
- 动态取色、柔和圆角、高可读性
- 浅色：浅色表面 + 深色文字 + 从封面提取的动态强调色

### 方向 E：自定义
- 你可自由设计任何风格，只需提供三套主题的 11+ 色值即可

## 6. 提交格式

请按以下格式提交你的设计方案：

```
## 设计方案名称：[给这套方案起个名字]

### 设计理念
[2-3 句话说明设计思路和灵感来源]

### 浅色模式 (light)
backgroundColor:          '#xxxxxx'
textColor:                '#xxxxxx'
textColorSecondary:       '#xxxxxx'
accentColor:              '#xxxxxx'
selectionColor:           'rgba(x, x, x, x.xx)'
ui-background:            '#xxxxxx'
ui-background-secondary:  '#xxxxxx'
ui-text:                  '#xxxxxx'
ui-text-secondary:        '#xxxxxx'
ui-border:                '#xxxxxx'
ui-accent:                '#xxxxxx'
ui-overlay:               'rgba(x, x, x, x.xx)'
ui-danger:                '#xxxxxx'
ui-slider-track:          '#xxxxxx'
ui-slider-fill:           '#xxxxxx'

### 深色模式 (dark)
[同上格式]

### 护眼模式 (sepia)
[同上格式]
```

## 7. 注意事项

- Canvas 阅读区（`backgroundColor` + `textColor`）是最核心的，**阅读舒适度优先于美观**：正文与背景的对比度要足够（WCAG AA 标准：至少 4.5:1）
- UI 面板的 `ui-background` 一般比 Canvas 的 `backgroundColor` 更亮/更白一点（浅色模式下），形成层次感
- 深色模式不要用纯黑 `#000000`，用深灰（如 `#1A1A1C`），减少眼睛疲劳
- `ui-accent` 是品牌的灵魂色，所有按钮、链接、选中态、进度条都用它
- 护眼模式的底色用暖色调（米黄/羊皮纸色），但 UI 面板仍保持可读性
