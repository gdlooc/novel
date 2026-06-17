# 项目状态报告

> 生成日期: 2026-05-30
> 更新日期: 2026-06-18 (PostgreSQL 存储 + 目录重构 + ID 体系 v2 + 图片顺序命名)

---

## 1. 项目目标

开发一个**通用轻小说爬虫框架**，支持多数据源扩展，当前实现 wenku8.net 的完整爬取链路：

- 自动登录 + Cookie 缓存（Playwright 无头浏览器，绕过 Cloudflare）
- 小说发现（全站排行榜遍历，~4600 本）
- 单本/批量下载 + 断点续爬
- 并发下载（共享浏览器 + Semaphore，可调配速）
- 增量更新（`--update` 自动检测新章节）
- PostgreSQL 主存储 + JSON 文件导出（兼容 canvas-reader）
- 导出 TXT / JSON / EPUB（含封面 + 插图嵌入）

---

## 2. 项目结构

```
crawler/
├── core/                       # 核心引擎
│   ├── database.py             #   PostgreSQL 连接 + Schema + CRUD + 导出
│   └── exporter.py             #   TXT / JSON / EPUB 导出
│
├── fetch/                      # 抓取 + 解析
│   ├── auth.py                 #   Playwright 登录 + Cookie 缓存
│   ├── fetcher.py              #   Playwright 无头浏览器抓取
│   ├── cookie_utils.py         #   Cookie 格式转换
│   ├── parser_book.py          #   书页解析（14 个元数据字段）
│   ├── parser_catalog.py       #   目录页解析（分卷章节列表）
│   └── parser_chapter.py       #   章节正文解析 + 插图提取
│
├── orchestrate/                # 编排层（CLI 入口）
│   ├── scraper.py              #   单本小说爬取编排器
│   ├── batch.py                #   批量下载（基于站点索引）
│   ├── discover.py             #   全站小说发现（遍历排行榜）
│   └── repair_images.py        #   插图修复（下载 + DB 写入）
│
├── html_fetch.py               # 单页面 HTML 下载（调试用）
├── migrate.py                  # v1 → v2 ID 体系迁移
├── data_sources.json           # 数据源配置
├── requirements.txt            # Python 依赖
├── README.md                   # 使用说明
└── novels/                     # 输出数据
    └── aid_{id}/               #   JSON 导出（canvas-reader 兼容）
```

---

## 3. 数据库 Schema

PostgreSQL `novels` 数据库，6 张表：

| 表 | 用途 | 关键字段 |
|------|------|------|
| `data_sources` | 数据源配置 | id, name, url |
| `novels` | 小说元数据 | id（本站aid）, data_source_aid（源站aid）, title, author, tags... |
| `novel_tags` | 标签（多对多） | novel_id, tag |
| `volumes` | 卷 | novel_id, name, sort_order |
| `chapters` | 章节正文 | id（DB串行）, novel_id, data_source_cid, sort_order（本地cid）, content |
| `chapter_images` | 插图元数据 | chapter_id, url, filename（1.jpg...）, local_path |
| `crawl_progress` | 断点 | novel_id, completed_source_cids(JSONB), failed_source_cids(JSONB) |

---

## 4. ID 体系 v2

| 字段 | 含义 | 示例 |
|------|------|------|
| `aid` | 本站小说 ID（自增） | `2` |
| `data_source_aid` | 源站小说 ID | `3057` |
| `data_source` | 数据源 ID（1=wenku8） | `1` |
| `cid` | 本站章节 ID（sort_order，每本从1递增） | `1` |
| `data_source_cid` | 源站章节 ID | `125416` |
| `prev_cid` / `next_cid` | 导航：本站章节 ID（导出时翻译） | `1` / `3` |

---

## 5. 已完成功能

| 模块 | 功能 | 状态 |
|------|------|------|
| 登录认证 | Playwright 无头浏览器 + Cookie 缓存（7天） | ✅ |
| 抓取引擎 | 共享浏览器 + 独立 Context，绕过 Cloudflare | ✅ |
| 书页解析 | 14 个元数据字段（标题/作者/标签/评级/简介等） | ✅ |
| 目录解析 | 分卷章节列表，正确提取 215 章 | ✅ |
| 章节解析 | 正文净化 + GBK→UTF-8 + 插图 URL 提取 | ✅ |
| 断点续爬 | DB `crawl_progress` 表，支持 Ctrl+C 恢复 | ✅ |
| 并发下载 | 共享浏览器 + Semaphore，可调配速 | ✅ |
| 增量更新 | `--update` 自动检测新章节 | ✅ |
| 插图下载 | Referer 防盗链绕过 + Playwright 回退 | ✅ |
| 图片命名 | `1.jpg, 2.jpg...` 顺序命名，目录 `images/{novel_id}/{cid}/` | ✅ |
| 全站发现 | 遍历排行榜 ~230 页，~4600 本小说 | ✅ |
| 批量下载 | 基于站点索引 + 标签/状态过滤 | ✅ |
| TXT 导出 | 合并单文件 + 按卷分文件 | ✅ |
| JSON 导出 | 结构化 + DB 导出兼容 canvas-reader | ✅ |
| EPUB 导出 | 封面嵌入 + 插图嵌入 | ✅ |
| 插图修复 | 独立脚本，requests/Playwright 双策略 | ✅ |
| 数据迁移 | v1 → v2 ID 体系迁移脚本 | ✅ |

---

## 6. 已验证数据

| 指标 | aid_1（黑白二重唱） | aid_2（败北女角太多了！） |
|------|---------------------|--------------------------|
| 源站 aid | 4290 | 3057 |
| 章节数 | 8 | 215 |
| 插图数 | 1 | 202 |
| 下载耗时 | ~30s | ~16min（3并发） |
| 失败 | 0 | 0 |

---

## 7. 数据流

```
用户输入 (--aid 或 --update)
    │
    ▼
orchestrate/scraper.py
    ├── 1. 登录（缓存优先）       → fetch/auth.py
    ├── 2. 下载书页 + 目录        → fetch/parser_*.py
    ├── 3. 插入 novel 记录         → core/database.py → PostgreSQL
    ├── 4. 并发下载章节            → fetch/fetcher.py + parser_chapter.py
    │       └── 插图下载 + DB 写入  → core/database.py chapter_images
    ├── 5. 更新元数据 + 导航翻译   → core/database.py
    └── 6. 导出 JSON               → core/database.py export_to_json()
                │
                ▼
        novels/aid_{id}/  ← canvas-reader (WenkuAdapter)
```

---

## 8. 待完成任务

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P2 | 全站遍历爬取 | 已实现 discover + batch，待大规模运行验证 |
| P2 | Web UI | 浏览器界面，方便非技术用户使用 |
| P2 | 失败章节自动重试 | 归档失败列表，批量重试 |
| P3 | Docker 打包 | PostgreSQL + Python 一键部署 |
| P3 | 多数据源接入 | data_sources.json 已预留，待接入第2个源 |

---

## 9. 已知问题

| # | 问题 | 影响 | 状态 |
|------|------|------|------|
| 1 | GBK 编码终端乱码 | bash 终端输出乱码（不影响文件） | 设 `PYTHONIOENCODING=utf-8` 缓解 |
| 2 | playwright_stealth 未安装 | 不影响，Cloudflare Turnstile 自动通过 | 可选安装 |
| 3 | 偶发章节 403 | 极少数章节可能触发临时保护 | 指数退避重试 + `--resume` 单独重试 |
| 4 | DB SERIAL 跨小说跳跃 | 不影响业务（导出用 sort_order） | 可接受 |
