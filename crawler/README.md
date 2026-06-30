# 轻小说爬虫 (novel-crawler)

一个功能完整的轻小说爬虫框架，支持从 wenku8.net 自动下载小说，并提供 PostgreSQL 主存储、批量下载、FastAPI REST API 服务和多格式导出功能。

## ✨ 核心特性

- 🤖 **自动登录**：Playwright 无头浏览器 + Cookie 缓存（7天有效），403 自动刷新
- 🔍 **全站发现**：遍历排行榜，自动发现全站所有小说（当前 4123 本）
- ⭐ **评分筛选**：全站 4123 本评分全覆盖，支持 `--min-rating S/A/B/C` 范围筛选
- ⚡ **并发下载**：共享浏览器 + Semaphore 可调配速，断点续爬 + `--retry-failed` 批量重试
- 📊 **数据库存储**：PostgreSQL 主存储（8 张表），支持复杂查询和筛选
- 🖥️ **Web 管理后台**：React 18 + shadcn/ui，仪表盘/目录/下载/任务/日志/预览
- 🌐 **REST API**：FastAPI 服务（15+ 端点 + SSE 实时推送 + CORS）
- 📦 **多格式导出**：TXT / JSON / EPUB（含封面 + 插图嵌入）
- 🔄 **增量更新**：自动检测新章节，断点续爬
- 📝 **日志系统**：Python logging 模块 + 文件轮转 + 前端日志查看器

---

## 📋 目录结构

```
crawler/
├── core/                       # 核心引擎层
│   ├── database.py             #   PostgreSQL 连接管理 + Schema 初始化 + CRUD + 导出
│   ├── exporter.py             #   TXT / JSON / EPUB 多格式导出
│   └── logger.py               #   统一日志系统（文件轮转 + 内存缓冲 + API 查询）
│
├── fetch/                      # 数据抓取层
│   ├── auth.py                 #   Playwright 登录 + Cookie 缓存 + Cloudflare 绕过
│   ├── fetcher.py              #   Playwright 无头浏览器抓取（共享浏览器实例）
│   ├── cookie_utils.py         #   Cookie 字符串 ↔ 字典格式转换
│   ├── parser_book.py          #   书页解析器（14 个元数据字段）
│   ├── parser_catalog.py       #   目录页解析器（分卷章节列表提取）
│   └── parser_chapter.py       #   章节正文解析器（GBK→UTF-8 + 插图提取）
│
├── orchestrate/                # 编排层（CLI 入口）
│   ├── scraper.py              #   单本小说爬取编排器（Cookie 403 自动刷新）
│   ├── batch.py                #   批量下载（评分筛选 + 失败重试 + 断点续爬）
│   ├── discover.py             #   全站小说发现（遍历排行榜 / 分类列表）
│   ├── scan_metadata.py        #   元数据预扫描（书页 → rating/tags/status 回填）
│   ├── import_index.py         #   导入索引到数据库（JSON → site_novels 表）
│   ├── sync_downloaded.py      #   同步已下载小说到 site_novels（更新 is_downloaded）
│   ├── fix_metadata.py         #   修复 novels 表元数据不一致
│   └── repair_images.py        #   插图修复（下载缺失插图 + DB 写入）
│
├── server/                     # Web 服务层
│   └── api.py                  #   FastAPI（15+ 端点 + SSE + SPA 静态文件托管）
│
├── frontend/                   # Web 管理后台
│   ├── src/
│   │   ├── api/client.ts       #   API 客户端 + TanStack Query + SSE hooks
│   │   ├── components/         #   shadcn/ui 组件 + ChapterPreview
│   │   ├── pages/              #   仪表盘 / 目录 / 下载 / 任务 / 日志
│   │   └── App.tsx             #   侧边栏布局 + 路由
│   └── dist/                   #   构建产物（FastAPI 自动托管）
│
├── tests/                      # 测试脚本
│   ├── check_integrity.py      #   数据库关联完整性检查
│   ├── generate_report.py      #   生成详细关联关系报告
│   └── verify_site_novels.py   #   验证 site_novels 表数据导入
│
├── logs/                       # 日志文件（crawler.log，轮转 5MB × 3）
├── html_fetch.py               # 单页面 HTML 下载工具（调试用）
├── migrate.py                  # 旧格式数据迁移 v1 → v2
├── data_sources.json           # 数据源配置（当前：wenku8）
├── requirements.txt            # Python 依赖清单
├── README.md                   # 本文件（使用说明）
├── PROJECT_STATUS.md           # 项目状态报告
├── DATABASE_MIGRATION.md       # 数据库改造详细文档
└── INTEGRITY_REPORT.md         # 数据库完整性检查报告

# 数据输出目录
novels/
├── _site_index.json            # 全站索引（4123本，JSON 格式）
├── _site_checkpoint.json       # 站点级断点
├── _scan_checkpoint.json       # 元数据扫描断点
├── images/                     # 插图存储
│   ├── {novel_id}/             #   按小说 ID 分目录
│   │   └── {cid}/              #   按章节 ID 分目录
│   │       ├── 1.jpg           #   插图文件（顺序命名）
│   │       └── ...
│   └── ...
└── aid_{id}/                   # 每本小说的 JSON 导出
    ├── metadata.json           #   小说元数据
    ├── chapters.json           #   章节列表
    └── chapters/               #   章节内容
        ├── {cid}.json          #   单章 JSON（含 content）
        └── {cid}.txt           #   单章纯文本
```

---

## 🗄️ 数据库架构

### 8 张表结构

| 表 | 用途 | 关键字段 | 说明 |
|---|---|---|---|
| `data_sources` | 数据源配置 | id, name, url | 当前仅 wenku8（id=1） |
| `site_novels` | **全站索引** | data_source_aid, title, tags, is_downloaded | 4123本，支持筛选查询 |
| `novels` | 已下载小说元数据 | id, data_source_aid, title, author, ... | 包含完整元数据 |
| `novel_tags` | 标签（多对多） | novel_id, tag | 支持按标签筛选 |
| `volumes` | 分卷信息 | id, novel_id, name, sort_order | 分卷排序 |
| `chapters` | 章节正文 | id, novel_id, volume_id, data_source_cid, content | 包含导航和字数 |
| `chapter_images` | 插图元数据 | chapter_id, url, filename, local_path | 插图下载记录 |
| `crawl_progress` | 断点续爬 | novel_id, completed_source_cids(JSONB) | 已完成/失败的章节列表 |

### 连接信息

默认配置（可通过环境变量覆盖）：

```bash
PGHOST=localhost
PGPORT=5432
PGDATABASE=novels
PGUSER=postgres
PGPASSWORD=ty1235556
```

**使用环境变量覆盖：**
```bash
PGHOST=192.168.1.100 PGPORT=5433 python core/database.py --init
```

---

## 🔢 ID 体系

### 小说 ID

| 字段 | 含义 | 示例 | 说明 |
|------|------|------|------|
| `aid` | 本站小说 ID | `2` | novels.id，自增，唯一标识 |
| `data_source_aid` | 源站小说 ID | `3057` | wenku8.net 的小说 ID |
| `data_source` | 数据源 ID | `1` | 当前仅 wenku8（id=1） |

### 章节 ID

| 字段 | 含义 | 示例 | 说明 |
|------|------|------|------|
| `cid` | 本站章节 ID | `1` | chapters.sort_order，每本从 1 递增 |
| `data_source_cid` | 源站章节 ID | `125416` | wenku8.net 的章节 ID |

### 导航字段

| 字段 | 含义 | 示例 | 说明 |
|------|------|------|------|
| `data_source_prev_cid` | 上一章源站 ID | `125415` | 导出时翻译为本地 cid |
| `data_source_next_cid` | 下一章源站 ID | `125417` | 导出时翻译为本地 cid |

---

## 🚀 快速开始

### 1. 环境准备

#### 1.1 安装依赖

```bash
pip install -r requirements.txt
```

#### 1.2 安装 Playwright 浏览器

```bash
playwright install chromium
```

**可选**：安装 stealth 插件（绕过 Cloudflare 更稳定）

```bash
playwright install chromium
pip install playwright-stealth
```

#### 1.3 启动 PostgreSQL

确保 PostgreSQL 服务运行，并创建 `novels` 数据库：

```bash
# 登录 PostgreSQL
psql -U postgres

# 创建数据库
CREATE DATABASE novels;

# 退出
\q
```

---

### 2. 初始化数据库

```bash
python core/database.py --init
```

**执行后：**
- 创建 8 张表
- 创建索引
- 插入默认数据源（wenku8）

---

### 3. 首次使用

#### 3.1 发现全站小说

```bash
# 全量发现（约 14 分钟，发现 ~4123 本）
python orchestrate/discover.py

# 测试模式（仅前 10 页）
python orchestrate/discover.py --max-pages 10
```

**输出：**
- `novels/_site_index.json`：全站索引（JSON 格式）
- `site_novels` 表：全站索引（数据库）

#### 3.2 导入索引到数据库

如果已有 `_site_index.json`，直接导入：

```bash
python orchestrate/import_index.py
```

**验证导入：**

```python
python -c "from core.database import NovelDB; db = NovelDB(); print(db.get_site_novels_count()); db.close()"
```

输出：`{'total': 4123, 'downloaded': 6, 'pending': 4117}`

#### 3.3 下载小说

```bash
# 单本下载
python orchestrate/scraper.py --aid 3057 --username 账号 --password 密码

# 使用 Cookie 缓存（7 天内无需重新登录）
python orchestrate/scraper.py --aid 3057
```

**首次登录：**
- 需提供 `--username` 和 `--password`
- 登录成功后 Cookie 自动保存到 `.auth_cookies.json`（7 天有效）

---

### 4. 常用命令

#### 全站发现

```bash
# 全量发现
python orchestrate/discover.py

# 测试模式
python orchestrate/discover.py --max-pages 10

# 从分类列表发现
python orchestrate/discover.py --source articlelist

# 自定义输出路径
python orchestrate/discover.py --output novels/my_index.json
```

#### 批量下载

```bash
# 从数据库加载前 10 本
python orchestrate/batch.py --top 10

# 并发下载（小说内 3 并发）
python orchestrate/batch.py --top 10 --concurrent 3

# 按标签/状态筛选
python orchestrate/batch.py --tag 校园 --status 已完结 --top 20

# 断点续爬（跳过已完成）
python orchestrate/batch.py --resume

# 增量更新（重新发现 + 下载新增）
python orchestrate/batch.py --update

# 指定 aid 列表
python orchestrate/batch.py --aid 3057 --aid 1973

# 按最低评分筛选（需先执行 scan_metadata）
python orchestrate/batch.py --min-rating A --top 30

# 一键扫描元数据 + 评分筛选下载
python orchestrate/batch.py --scan --min-rating S --top 20
```

#### 元数据预扫描

```bash
# 扫描前 200 本小说的元数据（评分/标签/状态）
python orchestrate/scan_metadata.py --top 200 --concurrent 5

# 全量扫描（所有 rating 为空的行）
python orchestrate/scan_metadata.py --concurrent 5

# 断点续扫
python orchestrate/scan_metadata.py --resume

# 强制重新扫描（即使已有 rating）
python orchestrate/scan_metadata.py --force --top 100
```

#### 单本下载

```bash
# 基础用法
python orchestrate/scraper.py --aid 3057

# 并发加速
python orchestrate/scraper.py --aid 3057 --concurrent 3 --delay 1.5

# 失败重试
python orchestrate/scraper.py --aid 3057 --resume

# 增量更新（检测新章节）
python orchestrate/scraper.py --update novels/aid_1
```

#### 数据管理

```bash
# 同步已下载小说到 site_novels（更新 is_downloaded）
python orchestrate/sync_downloaded.py

# 修复 novels 元数据（total_chapters 不一致）
python orchestrate/fix_metadata.py

# 修复缺失插图
python orchestrate/repair_images.py novels/aid_1

# 仅检查（不下载）
python orchestrate/repair_images.py novels/aid_1 --dry-run
```

#### 数据导出

```bash
# 从数据库导出 JSON（兼容 novel-frontend）
python core/database.py --export 1

# 导出 TXT（合并单文件）
python core/exporter.py novels/aid_1 --format txt

# 导出 TXT（按卷分文件）
python core/exporter.py novels/aid_1 --format txt --split-by-volume

# 导出 JSON
python core/exporter.py novels/aid_1 --format json

# 导出 EPUB（含封面 + 插图）
python core/exporter.py novels/aid_1 --format epub

# 导出所有格式
python core/exporter.py novels/aid_1 --format all
```

#### 启动 API 服务

```bash
# 启动 FastAPI + 管理后台（端口 8080）
uvicorn server.api:app --port 8080
# 浏览器访问 http://localhost:8080 进入管理后台
```

#### 失败重试

```bash
# 批量重试所有有失败章节的小说
python orchestrate/batch.py --retry-failed

# 带并发加速
python orchestrate/batch.py --retry-failed --concurrent 3
```

#### Web 管理后台

```bash
# 开发模式（前后端分离）
cd crawler && uvicorn server.api:app --port 8080    # 后端
cd frontend && npm run dev                           # 前端 (localhost:5173)

# 生产模式（构建前端后单端口启动）
cd frontend && npm run build
cd .. && uvicorn server.api:app --port 8080          # localhost:8080
```

管理后台功能：
- 📊 **仪表盘**：统计卡片、评分分布饼图、实时下载进度
- 📚 **全站目录**：4123 本搜索/筛选/分页/一键下载
- 📥 **已下载**：卡片浏览 + 章节在线预览
- 🚀 **任务中心**：触发扫描/下载 + SSE 实时进度
- 📝 **系统日志**：按级别过滤 + 5 秒自动刷新

---

## 🔧 数据库查询示例

### Python 交互示例

```python
from core.database import NovelDB

# 连接数据库
db = NovelDB()

# 1. 获取统计信息
stats = db.get_site_novels_count()
print(f"总数: {stats['total']}, 已下载: {stats['downloaded']}, 待下载: {stats['pending']}")

# 2. 查询待下载小说（分页）
novels, total = db.get_site_novels(downloaded=False, offset=0, limit=20)
for n in novels:
    print(f"{n['data_source_aid']}: {n['title']}")

# 3. 按标签筛选
novels, total = db.get_site_novels(tags=["校园"], offset=0, limit=20)

# 4. 按状态/评级筛选
novels, total = db.get_site_novels(status="已完结", min_rating="S", offset=0, limit=20)

# 5. 获取小说详情
novel = db.get_novel_by_source(data_source_id=1, data_source_aid=3057)
print(novel['title'], novel['tags'])

# 6. 获取章节列表
chapters = db.get_novel_chapters(novel_id=1)
for ch in chapters:
    print(f"{ch['sort_order']}: {ch['title']}")

# 7. 关闭连接
db.close()
```

### psql 命令行查询

```bash
# 连接数据库
psql -U postgres -d novels

# 查看表大小
\dt+ site_novels

# 统计
SELECT COUNT(*) as total, is_downloaded FROM site_novels GROUP BY is_downloaded;

# 前 10 本小说
SELECT data_source_aid, title FROM site_novels ORDER BY id LIMIT 10;

# 查看已下载小说的章节数
SELECT n.id, n.title, COUNT(c.id) as chapter_count
FROM novels n
LEFT JOIN chapters c ON n.id = c.novel_id
GROUP BY n.id, n.title;

# 退出
\q
```

---

## 🛠️ 系统架构

### 数据流

```
1. 全站发现（discover.py）
   ├── 遍历排行榜 → 提取 aid/title/url
   ├── 保存 _site_index.json（兼容）
   └── 写入 site_novels 表（主索引）

1.5 元数据预扫描（scan_metadata.py）← 可选，按评分/标签筛选前执行
   ├── 从 site_novels 加载 rating 为空的小说
   ├── 轻量请求书页（~5KB/本，不下载章节）
   └── 回填 rating / tags / status 到 site_novels

2. 批量下载（batch.py）
   ├── （可选 --scan）先执行 scan_metadata
   ├── 从 site_novels 表加载待下载列表
   ├── 支持筛选（tags/status/rating）+ 分页
   └── 逐本调用 NovelScraper

3. 单本爬取（scraper.py）
   ├── 登录（Cookie 缓存优先）
   ├── 下载书页 + 目录 → 提取元数据
   ├── 插入 novels + volumes → PostgreSQL
   ├── 并发下载章节 → chapters 表
   │   └── 插图下载 → chapter_images 表
   ├── 更新元数据 + 导航翻译
   └── 导出 JSON → novels/aid_{id}/

4. 标记完成（batch.py）
   └── 更新 site_novels.is_downloaded = TRUE
```

### ID 映射关系

```
site_novels (4123本)
  └── data_source_aid = 3057
       └── [is_downloaded = TRUE]
            └── downloaded_aid = 1 → novels (已下载)
                ├── id = 1
                ├── data_source_aid = 3057
                ├── title, author, tags, ...
                │
                ├── volumes (分卷)
                │   └── novel_id = 1
                │
                └── chapters (章节)
                    ├── novel_id = 1
                    ├── data_source_cid = 125416 (源站 ID)
                    └── sort_order = 1 (本地 ID)
                        ├── content
                        └── chapter_images (插图)
                            └── chapter_id = chapters.id
```

---

## ⚙️ 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PGHOST` | `localhost` | PostgreSQL 主机 |
| `PGPORT` | `5432` | PostgreSQL 端口 |
| `PGDATABASE` | `novels` | 数据库名 |
| `PGUSER` | `postgres` | 数据库用户名 |
| `PGPASSWORD` | `ty1235556` | 数据库密码 |

### data_sources.json

```json
{
  "sources": [
    {
      "id": 1,
      "name": "wenku8",
      "cn_name": "文库8",
      "url": "https://www.wenku8.net",
      "description": "..."
    }
  ]
}
```

### 并发参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--concurrent` | `1` | 单本小说内章节并发数 |
| `--delay-novel` | `3.0` | 小说间延迟秒数（含 ±1s 随机抖动） |
| `--delay` | `1.5` | 章节间延迟秒数 |

**推荐配置：**
- 保守：`--concurrent 1 --delay-novel 3.0`（低风险）
- 平衡：`--concurrent 3 --delay-novel 2.0`（推荐）
- 激进：`--concurrent 5 --delay-novel 1.5`（需监控服务器负载）

---

## 🐛 故障排除

### 问题 1：数据库连接失败

**错误信息：**
```
psycopg2.OperationalError: connection to server at "localhost" (::1), port 5432 failed
```

**解决方案：**
1. 检查 PostgreSQL 是否运行：`pg_isready`
2. 检查配置：`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`
3. 确认数据库已创建：`CREATE DATABASE novels;`

---

### 问题 2：Playwright 浏览器未安装

**错误信息：**
```
executable doesn't exist at chromium
```

**解决方案：**
```bash
playwright install chromium
```

---

### 问题 3：登录失败或 Cloudflare 拦截

**错误信息：**
```
[X] Cloudflare 验证超时
```

**解决方案：**
1. 确保 Cookie 未过期（默认 7 天）
2. 手动删除 `.auth_cookies.json` 重新登录
3. 安装 `playwright-stealth`：`pip install playwright-stealth`
4. 检查网络或更换代理

---

### 问题 4：GBK 编码乱码

**现象：** bash 终端输出乱码

**解决方案：**
```bash
# Windows PowerShell
$env:PYTHONIOENCODING='utf-8'

# Linux/macOS
export PYTHONIOENCODING=utf-8
```

**不影响文件**，仅终端显示问题。

---

### 问题 5：章节 403 错误

**错误信息：**
```
[X] 获取章节失败: 403
```

**解决方案：**
1. 爬虫自动指数退避重试（最多 3 次）
2. 降低并发数：`--concurrent 1`
3. 增加延迟：`--delay 2.0`
4. 稍后重试：`python scraper.py --aid 3057 --resume`

---

## 📊 性能指标

### 已验证数据

| 指标 | 数值 |
|------|------|
| 全站索引 | 4,123 本（207 页） |
| 已下载 | 185+ 本 |
| 全站评分覆盖 | 100%（4123/4123） |
| 成功率 | 97%+（失败自动重试 + `--retry-failed`） |
| 最大单本 | 432 章 / 407 万字（在地下城寻求邂逅） |
| 并发性能 | 3 并发 ≈ 14 章/分钟 |
| 元数据扫描 | 500 本 / 6.7 分钟（5 并发） |
| API 端点 | 15+ 个，SSE 推送 + CORS |
| Web 管理后台 | React 18 + shadcn/ui，6 个页面 |

### 预估时间

| 任务 | 时间 |
|------|------|
| 全站发现（~4123本） | ~14 分钟 |
| 单本下载（平均 100 章） | ~5-10 分钟 |
| 批量下载 200 本 | ~10-17 小时 |
| 全量下载 4123 本 | ~8-14 天 |

---

## 📦 依赖版本

| 依赖 | 版本 | 说明 |
|------|------|------|
| Python | 3.8+ | 推荐 3.10+ |
| psycopg2-binary | 2.9+ | PostgreSQL 驱动 |
| playwright | 1.40+ | 无头浏览器 |
| beautifulsoup4 | 4.12+ | HTML 解析 |
| lxml | 4.9+ | XML/HTML 解析器 |
| uvicorn | 0.24+ | ASGI 服务器 |
| fastapi | 0.104+ | Web 框架 |

---

## 📚 相关文档

- [PROJECT_STATUS.md](PROJECT_STATUS.md) - 项目状态报告
- [DATABASE_MIGRATION.md](DATABASE_MIGRATION.md) - 数据库改造详细文档
- [INTEGRITY_REPORT.md](INTEGRITY_REPORT.md) - 数据库完整性检查报告
- [novel-frontend](../novel-frontend/README.md) - 配套阅读器项目

---

## 📝 许可证

本项目仅供学习交流使用，请遵守相关法律法规和目标网站的使用条款。
