# 项目状态报告

> 生成日期: 2026-05-30
> 更新日期: 2026-06-30 (管理后台开发 + 评分筛选 + 健壮性优化)

---

## 1. 项目目标

开发一个**通用轻小说爬虫框架**，支持多数据源扩展，当前实现 wenku8.net 的完整爬取链路：

- 自动登录 + Cookie 缓存（Playwright 无头浏览器，绕过 Cloudflare）
- 小说发现（全站排行榜遍历，~4600 本）
- 单本/批量下载 + 断点续爬
- 并发下载（共享浏览器 + Semaphore，可调配速）
- 增量更新（`--update` 自动检测新章节）
- PostgreSQL 主存储 + JSON 文件导出（兼容 novel-frontend）
- 导出 TXT / JSON / EPUB（含封面 + 插图嵌入）

---

## 2. 项目结构

```
crawler/
├── core/                       # 核心引擎
│   ├── database.py             #   PostgreSQL 连接 + Schema + CRUD + 导出
│   ├── exporter.py             #   TXT / JSON / EPUB 导出
│   └── logger.py               #   统一日志系统（文件轮转 + 内存缓冲）
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
│   ├── scraper.py              #   单本小说爬取编排器（Cookie 过期自动刷新）
│   ├── batch.py                #   批量下载（支持评分筛选 + 失败重试）
│   ├── discover.py             #   全站小说发现（遍历排行榜）
│   ├── scan_metadata.py        #   元数据预扫描（书页 → rating/tags/status 回填）
│   ├── import_index.py         #   导入索引到数据库
│   ├── sync_downloaded.py      #   同步已下载小说到 site_novels
│   ├── fix_metadata.py         #   修复 novels 表元数据不一致
│   └── repair_images.py        #   插图修复（下载 + DB 写入）
│
├── server/                     # Web 服务
│   └── api.py                  #   FastAPI（novel-frontend + 管理后台，15+ 端点 + SSE）
│
├── frontend/                   # Web 管理后台
│   ├── src/
│   │   ├── api/client.ts       #   API 客户端 + TanStack Query hooks
│   │   ├── components/ui/      #   shadcn/ui 组件（Button/Card/Badge/Progress...）
│   │   ├── components/         #   ChapterPreview 章节预览
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx   #   仪表盘（统计卡片 + 评分饼图）
│   │   │   ├── Catalog.tsx     #   全站目录（搜索/筛选/下载）
│   │   │   ├── Downloads.tsx   #   已下载管理（章节预览）
│   │   │   ├── Tasks.tsx       #   任务中心（扫描/下载触发）
│   │   │   └── Logs.tsx        #   系统日志查看器
│   │   └── App.tsx             #   侧边栏布局 + 路由
│   └── dist/                   #   构建产物（FastAPI 挂载）
│
├── tests/                      # 测试脚本
│   ├── check_integrity.py      #   数据库关联完整性检查
│   ├── generate_report.py      #   生成详细关联关系报告
│   └── test_site_novels.py     #   site_novels 表 CRUD 测试
│
├── logs/                       # 日志文件（crawler.log，轮转 5MB × 3）
├── html_fetch.py               # 单页面 HTML 下载（调试用）
├── migrate.py                  # v1 → v2 ID 体系迁移
├── data_sources.json           # 数据源配置
├── requirements.txt            # Python 依赖
├── README.md                   # 使用说明
├── PROJECT_STATUS.md           # 项目状态报告（本文件）
├── DATABASE_MIGRATION.md       # 数据库改造文档
├── INTEGRITY_REPORT.md         # 数据库完整性检查报告
└── novels/                     # 输出数据
    ├── _site_index.json        #   全站索引（4123本）
    ├── _site_checkpoint.json   #   站点级断点
    ├── _scan_checkpoint.json   #   元数据扫描断点
    ├── images/                 #   插图（按 novel_id/cid 分目录）
    └── aid_{id}/               #   JSON 导出（novel-frontend 兼容）
```

---

## 3. 数据库 Schema

PostgreSQL `novels` 数据库，**8 张表**：

| 表 | 用途 | 关键字段 |
|------|------|------|
| `data_sources` | 数据源配置 | id, name, url |
| `site_novels` | 全站索引 | data_source_aid, title, tags, is_downloaded |
| `novels` | 小说元数据 | id（本站aid）, data_source_aid, title, author... |
| `novel_tags` | 标签（多对多） | novel_id, tag |
| `volumes` | 分卷 | id, novel_id, name, sort_order |
| `chapters` | 章节正文 | id, novel_id, volume_id, data_source_cid, sort_order（本地cid）, content |
| `chapter_images` | 插图元数据 | chapter_id, url, filename（1.jpg...）, local_path |
| `crawl_progress` | 断点续爬 | novel_id, completed_source_cids(JSONB), failed_source_cids(JSONB) |

**数据库改造（2026-06-27）：**
- 新增 `site_novels` 表存储全站索引（4123本）
- discover.py 双写：JSON + 数据库
- batch.py 优先从数据库加载（支持筛选、分页）
- 移除爬取中间过程的临时 JSON 文件

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
| 登录认证 | Playwright 无头浏览器 + Cookie 缓存（7天）+ 403 自动刷新 | ✅ |
| 抓取引擎 | 共享浏览器 + 独立 Context，绕过 Cloudflare | ✅ |
| 书页解析 | 14 个元数据字段（标题/作者/标签/评级/简介等） | ✅ |
| 目录解析 | 分卷章节列表 + 分卷信息持久化 | ✅ |
| 章节解析 | 正文净化 + GBK→UTF-8 + 插图 URL 提取 + 所属卷匹配 | ✅ |
| 断点续爬 | DB `crawl_progress` 表，失败章节自动重试 + 成功自动清理 | ✅ |
| 失败批量重试 | `--retry-failed` 自动查出所有失败章节并重试 | ✅ |
| 并发下载 | 共享浏览器 + Semaphore，可调配速 | ✅ |
| 增量更新 | `--update` 自动检测新章节 | ✅ |
| 插图下载 | Referer 防盗链绕过 + Playwright 回退 | ✅ |
| 图片命名 | `1.jpg, 2.jpg...` 顺序命名，目录 `images/{novel_id}/{cid}/` | ✅ |
| 全站发现 | 遍历排行榜 207 页，4123 本小说 | ✅ |
| 元数据预扫描 | `scan_metadata.py`，轻量请求书页回填 rating/tags/status | ✅ |
| 评分筛选下载 | `--min-rating S/A/B/C`，支持 S 级以上范围查询 | ✅ |
| 批量下载 | 基于站点索引 + 标签/状态/评分过滤 + 分页 | ✅ |
| 全站索引数据库 | `site_novels` 表，discover/batch 双写，支持筛选查询 | ✅ |
| TXT 导出 | 合并单文件 + 按卷分文件 | ✅ |
| JSON 导出 | 结构化 + DB 导出兼容 novel-frontend | ✅ |
| EPUB 导出 | 封面嵌入 + 插图嵌入 | ✅ |
| 插图修复 | 独立脚本，requests/Playwright 双策略 | ✅ |
| 数据迁移 | v1 → v2 ID 体系迁移脚本 | ✅ |
| REST API | FastAPI 服务（15+ 端点 + CORS + SSE 推送） | ✅ |
| Web 管理后台 | React 18 + shadcn/ui（6 页面：仪表盘/目录/下载/任务/日志/预览） | ✅ |
| 实时推送 | SSE 端点 `/api/admin/events`，任务状态实时同步前端 | ✅ |
| 章节预览 | 已下载小说在线浏览正文（左侧目录 + 右侧内容） | ✅ |
| 日志系统 | Python logging 模块 + 文件轮转 + 内存缓冲 + 前端查看器 | ✅ |
| novel-frontend 适配 | ApiAdapter（HTTP API 适配器），文件/API 双模式共存 | ✅ |

---

## 6. 已验证数据

### 全站发现

| 指标 | 数值 |
|------|------|
| 总页数 | 207 页 |
| 发现小说 | **4123 本** |
| 耗时 | 14.2 分钟 |
| 索引文件 | `novels/_site_index.json` + `site_novels` 表 |

### 数据库状态（2026-06-30）

| 指标 | 数值 |
|------|------|
| **site_novels 总数** | **4123** |
| 已下载 | 185+ |
| 待下载 | ~3938 |
| 全站评分覆盖 | 100%（4123/4123） |
| S 级小说 | 100 本 |
| A 级以上 | 262 本 |

### 评分分布

| 等级 | 数量 | 占比 |
|------|------|------|
| S 级 | 100 | 2.4% |
| A 级 | 162 | 3.9% |
| B 级 | 371 | 9.0% |
| C 级 | 868 | 21.1% |
| D 级 | 1011 | 24.5% |
| E 级 | 1611 | 39.1% |

### 关联完整性检查

| 检查项 | 状态 |
|--------|------|
| site_novels -> novels | ✅ 通过 |
| novels -> volumes | ✅ 通过 |
| novels -> chapters | ✅ 通过 |
| chapters -> volumes | ✅ 通过 |
| chapters -> chapter_images | ✅ 通过 |
| novels -> novel_tags | ✅ 通过 |
| 孤儿记录 | ✅ 无 |

**详细报告**: [INTEGRITY_REPORT.md](INTEGRITY_REPORT.md)

### 批量下载

| aid | 书名 | 章节 | 字数 | 插图 |
|-----|------|------|------|------|
| 1 | 败北女角太多了！ | 215 | 115万 | 202张 |
| 2 | 农林 | 172 | 128万 | ~290张 |
| 3 | 废墟巡游 | 10 | 11万 | 16张 |
| 4 | 黑白二重唱 | 8 | 9万 | 1张 |
| 5 | 取代江户花魁后 | 13 | 10万 | 2张 |
| 6 | 男女比1:5的世界 | 18 | 16万 | 36张 |

- **成功率**: 6/6 本，436 章，1 次失败自动重试成功
- **存储**: PostgreSQL 8 表 + `novels/aid_{id}/` JSON 导出

---

## 7. 数据流

```
用户输入 (--aid 或 --update)
    │
    ▼
orchestrate/discover.py（全站发现）
    ├── 遍历排行榜 → 提取 4123 本小说 aid/title/url
    ├── 保存 _site_index.json（兼容）
    └── 写入 site_novels 表（主索引）← 新增
                │
                ▼
        site_novels 表（4123本）+ novels 表（已下载详细数据）

用户输入 (--top/--tag/--resume)
    │
    ▼
orchestrate/batch.py（批量下载）
    ├── 1. 从 site_novels 表加载待下载列表（支持筛选/分页）
    ├── 2. 逐本调用 NovelScraper
    │       └── orchestrator/scraper.py
    │           ├── 登录（缓存优先）       → fetch/auth.py
    │           ├── 下载书页 + 目录        → fetch/parser_*.py
    │           ├── 插入 novel + volumes     → core/database.py → novels 表
    │           ├── 并发下载章节            → fetch/fetcher.py + parser_chapter.py
    │           │   └── 插图下载 + DB 写入  → core/database.py chapter_images
    │           ├── 清理失败列表 + 更新元数据 + 导航翻译
    │           └── 导出 JSON（含分卷信息） → core/database.py export_to_json()
    │               │
    │               ▼
    │       novels/aid_{id}/  ← novel-frontend (WenkuAdapter)
    │
    └── 3. 标记 site_novels.is_downloaded = TRUE ← 新增
```

**关键变化：**
- 全站索引统一存入 `site_novels` 表
- `batch.py` 优先从数据库加载（支持筛选、分页）
- `discover.py` 双写：JSON + 数据库
- 爬取中间过程不再保存临时 JSON 文件

---

## 8. 待完成任务

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P2 | 全站遍历爬取 | 🏃 185+ 本已下载，正在进行 S 级批量下载 |
| P2 | 任务进度持久化 | 当前 TaskManager 纯内存，重启丢失 |
| P2 | 全文搜索 | PostgreSQL `chapters.content` 字段已可建 GIN 索引 |
| P3 | Docker 打包 | PostgreSQL + Python + API + 前端一键部署 |
| P3 | 多数据源接入 | data_sources.json 已预留，待接入第2个源 |
| P3 | 深色模式 | shadcn/ui 原生支持 dark mode |
| P4 | 移动端适配 | 响应式侧边栏（小屏幕 Sheet 抽屉式） |
| P4 | 前端导出功能 | Downloads 页导出按钮接入 exporter.py |

> ✅ 已完成：Web UI、评分筛选、Cookie 自动刷新、失败重试、SSE 实时推送、章节预览、日志系统

---

## 9. 已知问题

| # | 问题 | 影响 | 状态 |
|------|------|------|------|
| 1 | GBK 编码终端乱码 | bash 终端输出乱码（不影响文件） | 设 `PYTHONIOENCODING=utf-8` 缓解 |
| 2 | playwright_stealth 未安装 | 不影响，Cloudflare Turnstile 自动通过 | 可选安装 |
| 3 | 偶发章节 403 | 极少数章节可能触发临时保护 | Cookie 自动刷新 + 指数退避重试 + `--retry-failed` |
| 4 | DB SERIAL 跨小说跳跃 | 不影响业务（导出用 sort_order） | 可接受 |
