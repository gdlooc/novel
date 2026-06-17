# 项目状态报告

> 生成日期: 2026-05-30
> 更新日期: 2026-06-17 (并发下载 + 插图修复 + 增量更新模式)

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
|------|------|------|------|
| HTML 下载器 | `html_fetch.py` | CLI 工具，支持手动填 URL + Cookie，双模式抓取 | ✅ |
| 登录认证 | `auth.py` | Playwright 无头浏览器登录 + Cookie 缓存（7 天有效）+ stealth 伪装 | ✅ |
| 底层抓取引擎 | `fetcher.py` | PlaywrightFetcher（无头浏览器），支持 Cookie 注入 | ✅ |
| Cookie 工具 | `cookie_utils.py` | Cookie 字符串解析，requests/playwright 格式互转 | ✅ |
| 目录解析器 | `parser_catalog.py` | 解析 `/novel/{group}/{aid}/index.htm`，提取分卷章节列表 | ✅ |
| 章节解析器 | `parser_chapter.py` | 解析 `/novel/{group}/{aid}/{cid}.htm`，提取净化正文 + 导航信息 | ✅ |
| 书页解析器 | `parser_book.py` | 解析 `/book/{aid}.htm`，提取书名、作者、标签、简介、封面等 14 个字段 | ✅ |
| 爬取编排器 | `scraper.py` | 串联书页→目录→章节全流程，断点续爬，限速，重试，**并发下载**，**增量更新** | ✅ |
| 导出器 | `exporter.py` | TXT / JSON / EPUB 导出，支持合并/分卷两种模式 | ✅ |
| 插图提取 | `parser_chapter.py` | 从 `#content` 提取 `div.divimage` 插图 URL，过滤广告图片 | ✅ |
| 插图下载 | `scraper.py` | 自动下载章节插图到本地 `images/{cid}/`，**含防盗链 Referer 绕过** | ✅ |
| 插图修复工具 | `repair_images.py` | 独立脚本，重新下载之前失败的插图，支持 requests/Playwright 双策略 | ✅ |
| EPUB 图片嵌入 | `exporter.py` | EPUB 自动嵌入本地图片 + 封面图 | ✅ |
| 内容解析优化 | `parser_chapter.py` | 基于 `#content` div 提取正文，避免导航栏/阅读器UI文字混入 | ✅ |
| 依赖管理 | `requirements.txt` | requests, beautifulsoup4, playwright, rich, ebooklib | ✅ |

### 已验证的功能

- [x] 无 Cookie 访问公开页面（书页、目录、章节正文）
- [x] 带 Cookie 访问需登录页面（分类列表 articlelist.php）
- [x] 无头浏览器模式（Playwright + Chromium）
- [x] 目录解析：215 章正确提取（aid=3057）
- [x] 章节正文提取：固定文字清除、段落保留、编码 GBK→UTF-8
- [x] 书页元数据：标签(6个)、评级(S级)、简介、封面 URL 全部正确
- [x] 断点续爬：checkpoint.json 记录已完成 cid
- [x] TXT 导出：单文件合并 + 按卷分文件（`--split-by-volume`）
- [x] **aid=3057 完整下载**：215/215 章，约 115 万字
- [x] **插图提取与下载**：10 卷共 202 张插图全部下载成功（35MB）
- [x] **插图防盗链修复**：添加 Referer + Origin 头绕过 CDN 保护
- [x] **并发下载**：共享浏览器 + asyncio.Semaphore(3)，吞吐量提升 50%
- [x] **增量更新**：`--update novels/aid_3057` 一行命令检测并下载新章节
- [x] **Cookie 缓存**：7 天有效期内免登录，`--update` 自动复用

---

## 3. 文件变更清单

### 本次会话新增/修改的文件

| 文件 | 变更说明 |
|------|---------|
| `scraper.py` | 新增并发下载（`_download_chapters_async`、`_fetch_page_async`，共享浏览器 + Semaphore）；新增 `--update` 增量更新模式；新增 `--concurrent` CLI 参数；`_download_images` 添加 Referer/Origin 防盗链绕过；Playwright 回退策略 |
| `repair_images.py` | **新增**：独立插图修复脚本，支持 `--dry-run` 检查模式和 requests/Playwright 双策略下载 |
| `PROJECT_STATUS.md` | 本文件，更新至最新状态 |

### 本次会话之前的文件

| 文件 | 说明 |
|------|------|
| `requirements.txt` | Python 依赖声明 |
| `auth.py` | 登录认证 + Cookie 缓存管理 |
| `cookie_utils.py` | Cookie 解析 + 格式转换 |
| `fetcher.py` | Playwright 抓取引擎 |
| `parser_catalog.py` | 目录页解析器 |
| `parser_chapter.py` | 章节正文 + 插图解析器 |
| `parser_book.py` | 书页元数据解析器 |
| `exporter.py` | 多格式导出器（含 EPUB 图片嵌入） |
| `html_fetch.py` | 单页面 HTML 下载工具 |

---

## 4. 当前架构

```
f:\project\novel\crawler\
│
├── scraper.py             # 主入口：批量爬取（并发 + 增量更新 + 断点续爬）
├── exporter.py            # 导出入口：TXT / JSON / EPUB
├── html_fetch.py          # 工具入口：单页 HTML 下载
├── repair_images.py       # 工具入口：插图修复/补下载
│
├── auth.py                # 登录层：Playwright 登录 + Cookie 缓存
├── fetcher.py             # 抓取层：PlaywrightFetcher（无头浏览器）
├── cookie_utils.py        # 工具层：Cookie 字符串 ↔ dict / playwright 格式
│
├── parser_catalog.py      # 解析层：目录页 → 章节列表
├── parser_chapter.py      # 解析层：章节页 → 正文内容 + 插图 URL
├── parser_book.py         # 解析层：书页   → 元数据(标签、简介等)
│
├── .auth_cookies.json     # Cookie 缓存（7 天有效）
├── requirements.txt       # 依赖声明
├── PROJECT_STATUS.md      # 本文件
│
└── novels/                # 爬取结果输出
    └── aid_3057/           # 败北女角太多了！
        ├── metadata.json           # 元数据（14 个字段）
        ├── chapters.json           # 章节列表（215 章 + 分卷信息）
        ├── .checkpoint.json        # 断点文件
        ├── chapters/               # 章节数据
        │   ├── {cid}.txt           #   215 个纯文本文件
        │   ├── {cid}.json          #   215 个结构化 JSON
        │   └── {cid}_images.json   #   10 个插图元数据文件
        └── images/                 # 插图（10 卷 × 202 张，35MB）
            ├── 125425/             #   第一卷（20 张）
            ├── 139086/             #   第二卷（18 张）
            └── ...
```

### 数据流

```
用户输入 (aid + cookie 或 --update)
    │
    ▼
scraper.py
    ├── 1. 下载书页    /book/{aid}.htm       → parser_book   → metadata (14个字段)
    ├── 2. 下载目录页  /novel/{g}/{aid}/index → parser_catalog → chapters list
    ├── 3. 下载章节 ── 并发模式（共享浏览器 + Semaphore）或串行模式
    │       └── /novel/{g}/{aid}/{cid}       → parser_chapter → 正文 .txt + .json
    │       └── 插图下载（requests + Referer → Playwright 回退）
    └── 4. 保存 metadata.json + chapters.json + checkpoint.json
                │
                ▼
exporter.py  ← 读取 novels/aid_{aid}/
    ├── --format txt                    → 合并单文件
    ├── --format txt --split-by-volume  → 按卷分文件
    ├── --format json                   → 结构化 JSON
    └── --format epub                   → 电子书（含封面 + 插图嵌入）
```

### 并发下载架构

```
asyncio.run() ── 单事件循环
    │
    ├── Semaphore(3) ── 控制并发槽位
    │
    └── 共享 Chromium 浏览器
        ├── Context 1 (独立 cookie + viewport) → 章节 A
        ├── Context 2 (独立 cookie + viewport) → 章节 B
        └── Context 3 (独立 cookie + viewport) → 章节 C
                    │
                    ├── 每章: goToURL → wait → getHTML → closeContext
                    ├── 解析 + 保存（同步）
                    └── asyncio.Lock → 写断点文件
```

### URL 规则

```
书页:       /book/{aid}.htm
目录页:     /novel/{group}/{aid}/index.htm      (group = aid // 1000)
章节页:     /novel/{group}/{aid}/{cid}.htm       (cid 全局唯一)
插图 CDN:   https://pic.777743.xyz/{group}/{aid}/{cid}/{filename}.jpg
排行榜:     /modules/article/toplist.php?sort=... (需登录)
分类列表:   /modules/article/articlelist.php     (需登录)
```

---

## 5. 待完成任务

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P1 | 全站遍历爬取 | 从排行榜/分类列表获取全部小说 ID，批量下载 |
| P2 | Web UI | 提供浏览器界面，方便非技术用户使用 |
| P2 | 更新日志输出 | 增量更新时显示"新增 X 章"对比信息，而非仅总数 |
| P3 | Docker 打包 | 方便一键部署 |
| P3 | 失败章节自动归档 | 将失败 cid 写入独立文件，方便后续批量重试 |

---

## 6. 已知问题

| # | 问题 | 影响 | 解决方案 |
|------|------|------|---------|
| 1 | **列表页需登录** | `articlelist.php` 和 `toplist.php` 必须带有效 cookie | 全站遍历功能依赖登录态 |
| 2 | **GBK 编码终端乱码** | bash 终端输出中文显示为乱码（不影响文件内容） | 文件内容保存正确（UTF-8），设置 `PYTHONIOENCODING=utf-8` 改善 |
| 3 | **最新章的 next_cid** | 最新章节的 JS 变量 `next_page` 指向特殊 URL 而非 cid | `parser_chapter.py` 正确保留为原始值，调用方需判断是否为纯数字 |
| 4 | **部分章节偶发 403** | 少数章节（如 cid=135745）可能触发临时保护 | 已设置并发延迟 + 指数退避重试；失败章节可用 `--resume` 单独重试 |
| 5 | **playwright_stealth 未安装** | stealth 伪装不可用，但不影响正常登录和下载 | 可选安装：`pip install playwright-stealth` |
| 6 | **插图 CDN 防盗链** | CDN (pic.777743.xyz) 要求 Referer 头 | ✅ 已修复：`_download_images` 添加 Referer + Origin 头 |

---

## 7. 下一步计划

1. **全站遍历爬取** — 从排行榜/分类列表批量获取小说 ID 列表，自动下载
2. **Web UI** — 提供浏览器界面，方便非技术用户操作
3. **Docker 打包** — 方便一键部署到服务器
4. **智能更新** — 增量更新时展示"新增 X 章"的更友好输出
