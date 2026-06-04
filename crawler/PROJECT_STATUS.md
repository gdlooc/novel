# 项目状态报告

> 生成日期: 2026-05-30
> 更新日期: 2026-05-30 (插图支持 + 内容解析优化)

---

## 1. 项目目标

开发一个 **轻小说网站 (wenku8.net) 爬虫**，实现从该网站自动下载小说内容，支持：

- 手动指定目标 URL / 小说 ID
- 手动填写 Cookie 登录凭证
- 下载整本小说的所有章节
- 导出为 TXT / JSON / EPUB 格式
- 支持按卷分文件导出
- 提取完整的小说元数据（标签、简介、封面等）

---

## 2. 已完成工作

| 模块 | 文件 | 功能 | 状态 |
|---|---|---|---|
| HTML 下载器 | `html_fetch.py` | CLI 工具，支持手动填 URL + Cookie，双模式抓取 | ✅ |
| 底层抓取引擎 | `fetcher.py` | RequestsFetcher（HTTP 直连）+ PlaywrightFetcher（无头浏览器） | ✅ |
| Cookie 工具 | `cookie_utils.py` | Cookie 字符串解析，requests/playwright 格式互转 | ✅ |
| 目录解析器 | `parser_catalog.py` | 解析 `/novel/{group}/{aid}/index.htm`，提取分卷章节列表 | ✅ |
| 章节解析器 | `parser_chapter.py` | 解析 `/novel/{group}/{aid}/{cid}.htm`，提取净化正文 + 导航信息 | ✅ |
| 书页解析器 | `parser_book.py` | 解析 `/book/{aid}.htm`，提取书名、作者、标签、简介、封面等 14 个字段 | ✅ |
| 爬取编排器 | `scraper.py` | 串联书页→目录→章节全流程，断点续爬，限速，重试 | ✅ |
| 导出器 | `exporter.py` | TXT / JSON / EPUB 导出，支持合并/分卷两种模式 | ✅ |
| 插图提取 | `parser_chapter.py` | 从 `#content` 提取 `div.divimage` 插图 URL，过滤广告图片 | ✅ |
| 插图下载 | `scraper.py` | 自动下载章节插图到本地 `images/{cid}/` | ✅ |
| EPUB 图片嵌入 | `exporter.py` | EPUB 自动嵌入本地图片 + 封面图 | ✅ |
| 内容解析优化 | `parser_chapter.py` | 基于 `#content` div 提取正文，避免导航栏/阅读器UI文字混入 | ✅ |
| 依赖管理 | `requirements.txt` | requests, beautifulsoup4, playwright, rich, ebooklib | ✅ |

### 已验证的功能

- [x] 无 Cookie 访问公开页面（书页、目录、章节正文）
- [x] 带 Cookie 访问需登录页面（分类列表 articlelist.php）
- [x] 无头浏览器模式（Playwright + Chromium）
- [x] 目录解析：35 卷 / 499 章正确提取
- [x] 章节正文提取：固定文字清除、段落保留、编码 GBK→UTF-8
- [x] 书页元数据：标签(5个)、评级、简介、封面 URL 全部正确
- [x] 断点续爬：checkpoint.json 记录已完成 cid
- [x] TXT 导出：单文件合并 + 按卷分文件（`--split-by-volume`）
- [x] 用户实际下载了 aid=3057（败北女角太多了！）大量章节
- [x] **插图提取**：15 张插图全部正确提取，广告图片（609999.xyz）正确过滤
- [x] **插图下载**：从 CDN (pic.777743.xyz) 下载到本地 `images/{cid}/`
- [x] **EPUB 图片嵌入**：3 张测试图正确嵌入 EPUB，`<img>` 标签生成正确
- [x] **内容解析优化**：不再混入阅读器 UI 文字（背景颜色/字体大小等），内容更干净

---

## 3. 文件变更清单

### 本次会话创建的文件

| 文件 | 说明 |
|---|---|
| `requirements.txt` | Python 依赖声明 |
| `cookie_utils.py` | Cookie 解析 + 格式转换 |
| `fetcher.py` | 双模式抓取引擎 |
| `parser_catalog.py` | 目录页解析器 |
| `parser_chapter.py` | 章节正文 + 插图解析器 |
| `parser_book.py` | 书页元数据解析器 |
| `scraper.py` | 爬取编排器（含图片下载） |
| `exporter.py` | 多格式导出器（含 EPUB 图片嵌入） |

### 最后更新修改的文件

| 文件 | 变更说明 |
|---|---|
| `parser_chapter.py` | 新增 `_extract_images()` 插图提取；重写 `_extract_content()` 基于 `#content` div；新增 `images`/`has_images` 字段 |
| `scraper.py` | 新增 `_download_images()` 下载插图到本地；`_save_chapter()` 保存 `{cid}_images.json`；进度显示图片下载数 |
| `exporter.py` | 新增 `_embed_images_in_html()` 将 `[插图: xxx]` 替换为 `<img>` 标签并嵌入 EPUB；新增 `_add_cover_image()` 封面图支持；JSON 导出包含图片字段 |

### 用户创建/修改的文件

| 文件 | 说明 |
|---|---|
| `html_fetch.py` | 用户从 `novel_fetch.py` 重命名并修改，加入了默认 Cookie 和双模式支持 |
| `cookie_utils.py` | 用户/linter 优化了 `domain` 参数处理 |

### 已删除的文件

| 文件 | 原因 |
|---|---|
| `analyzer.py` | 用户要求移除 HTML 分析功能，精简为只下载 |
| `novel_fetch.py` | 重命名为 `html_fetch.py` |
| `SCRAPING_PLAN.md` | 数据丢失（不在此次会话中持久化） |

---

## 4. 当前架构

```
f:\project\novel\
│
├── html_fetch.py          # 入口1: 单独下载任意页面 HTML
├── scraper.py             # 入口2: 批量爬取整本小说
├── exporter.py            # 入口3: 导出已有数据为 TXT/JSON/EPUB
│
├── fetcher.py             # 抓取层: RequestsFetcher + PlaywrightFetcher
├── cookie_utils.py        # 工具层: Cookie 字符串 → dict / playwright 格式
│
├── parser_catalog.py      # 解析层: 目录页 → 章节列表
├── parser_chapter.py      # 解析层: 章节页 → 正文内容
├── parser_book.py         # 解析层: 书页   → 元数据(标签、简介等)
│
├── requirements.txt       # 依赖声明
├── PROJECT_STATUS.md      # 本文件
│
├── output/                # html_fetch.py 下载的原始 HTML
├── output/analysis/       # 分析用的中间文件 (catalog.html, chapter.html, etc.)
│
└── novels/                # 爬取结果输出
    ├── aid_1973/           # 欢迎来到实力至上主义的教室
    │   ├── metadata.json
    │   ├── chapters.json
    │   ├── chapters/       # 章节 .txt + .json + _images.json
    │   └── images/         # 插图 (已下载3张测试)
    │       └── 69759/      #   按 cid 分目录
    └── aid_3057/           # 败北女角太多了！(用户实际下载: ~63章)
```

### 数据流

```
用户输入 (aid + cookie)
    │
    ▼
scraper.py
    ├── 1. 下载书页    /book/{aid}.htm       → parser_book   → metadata (14个字段)
    ├── 2. 下载目录页  /novel/{g}/{aid}/index → parser_catalog → chapters list
    ├── 3. 遍历下载章节 /novel/{g}/{aid}/{cid} → parser_chapter → 正文 .txt
    └── 4. 保存 metadata.json + chapters.json + checkpoint.json
                │
                ▼
exporter.py  ← 读取 novels/aid_{aid}/
    ├── --format txt                    → 合并单文件
    ├── --format txt --split-by-volume  → 按卷分文件
    ├── --format json                   → 结构化 JSON
    └── --format epub                   → 电子书
```

### URL 规则

```
书页:       /book/{aid}.htm
目录页:     /novel/{group}/{aid}/index.htm      (group = aid // 1000)
章节页:     /novel/{group}/{aid}/{cid}.htm       (cid 全局唯一)
排行榜:     /modules/article/toplist.php?sort=... (需登录)
分类列表:   /modules/article/articlelist.php     (需登录)
```

---

## 5. 待完成任务

| 优先级 | 任务 | 说明 |
|---|---|---|
| P1 | 全站遍历爬取 | 从排行榜/分类列表获取全部小说 ID，批量下载 |
| ~~P2~~ | ~~EPUB 封面嵌入~~ | ✅ 已实现：`_add_cover_image()` 会自动下载并嵌入封面图 |
| ~~—~~ | ~~插图提取与保存~~ | ✅ 新增：parser 提取 → scraper 下载 → exporter 嵌入 EPUB |
| P2 | 并发下载 | 使用 asyncio 并行下载章节，提升速度 |
| P2 | Web UI | 提供浏览器界面，方便非技术用户使用 |
| P3 | Docker 打包 | 方便一键部署 |

---

## 6. 已知问题

| # | 问题 | 影响 | 解决方案 |
|---|---|---|---|
| 1 | **列表页需登录** | `articlelist.php` 和 `toplist.php` 必须带有效 cookie | 全站遍历功能依赖登录态 |
| 2 | **GBK 编码终端乱码** | bash 终端输出中文显示为乱码（不影响文件内容） | 文件内容保存正确（UTF-8），终端显示问题可通过 `chcp 65001` 改善 |
| 3 | **最新章的 next_cid** | 最新章节的 JS 变量 `next_page` 指向特殊 URL 而非 cid | `parser_chapter.py` 正确保留为原始值，调用方需判断是否为纯数字 |
| 4 | **cookie_utils domain 修复** | 之前 `domain` 硬编码为完整 URL，Playwright 不认 | 已修复为从 URL 动态提取纯域名 |
| 5 | **部分章节可能 CF 拦截** | 高频请求可能触发 Cloudflare 验证 | 已设置 2s 默认延时 + 随机抖动 + 指数退避重试 |
| 6 | **已修复: 插图被忽略** | 旧版 `_extract_content()` 使用 `body.get_text()` 丢弃 `<img>` 标签，插图章节内容为空 | 改为基于 `#content` div 提取，`div.divimage` 替换为 `[插图: xxx]` 标记，图片自动下载到本地 |

---

## 7. 下一步计划

1. **实现小说发现功能** — 从排行榜/分类列表批量获取小说 ID 列表
2. **并发优化** — 用 asyncio 并行下载章节，下载 499 章可节省大量时间
