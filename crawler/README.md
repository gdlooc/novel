# 轻小说爬虫 (novel-crawler)

从 wenku8.net 自动下载小说内容的 Python 爬虫工具，支持 PostgreSQL 存储和多格式导出。

## 快速开始

```bash
# 安装依赖
pip install -r requirements.txt

# 安装 Playwright 浏览器（首次使用）
playwright install chromium

# 下载一本小说
python orchestrate/scraper.py --aid 3057 --username 账号 --password 密码

# 断点续爬
python orchestrate/scraper.py --aid 3057 --resume

# 并发下载（3线程）
python orchestrate/scraper.py --aid 3057 --concurrent 3 --delay 1.5
```

## 项目结构

```
crawler/
├── core/                       # 核心引擎
│   ├── database.py             #   PostgreSQL 连接管理 + Schema + CRUD
│   └── exporter.py             #   导出 TXT / JSON / EPUB
│
├── fetch/                      # 抓取 + 解析
│   ├── auth.py                 #   Playwright 登录 + Cookie 缓存（7天有效）
│   ├── fetcher.py              #   Playwright 无头浏览器抓取（绕过 Cloudflare）
│   ├── cookie_utils.py         #   Cookie 字符串 ↔ 字典格式转换
│   ├── parser_book.py          #   书页解析（14个元数据字段）
│   ├── parser_catalog.py       #   目录页解析（分卷章节列表）
│   └── parser_chapter.py       #   章节正文解析（GBK→UTF-8） + 插图提取
│
├── orchestrate/                # 编排层（CLI 入口）
│   ├── scraper.py              #   单本小说爬取编排器
│   ├── batch.py                #   批量下载（基于站点索引）
│   ├── discover.py             #   全站小说发现（遍历排行榜）
│   └── repair_images.py        #   插图修复工具
│
├── html_fetch.py               # 单页面 HTML 下载（调试用）
├── migrate.py                  # 旧格式数据迁移 v1 → v2
├── data_sources.json           # 数据源配置
├── requirements.txt            # Python 依赖
└── novels/                     # 输出数据（JSON 导出 + 插图）
```

## 数据存储

### 主存储：PostgreSQL

连接信息（环境变量可覆盖）：
```
PGHOST=localhost  PGPORT=5432  PGDATABASE=novels  PGUSER=postgres  PGPASSWORD=ty1235556
```

首次使用需初始化：
```bash
python core/database.py --init
```

6 张表：`data_sources` / `novels` / `novel_tags` / `volumes` / `chapters` / `chapter_images` / `crawl_progress`

### 导出：JSON 文件（canvas-reader 兼容）

每次爬取完成后自动导出到 `novels/aid_{id}/`，生成和之前文件系统模式完全兼容的结构：
```
novels/aid_2/
├── metadata.json          # 小说元数据
├── chapters.json          # 章节列表
└── chapters/              # 章节正文（{cid}.json + {cid}.txt）
```

也可手动导出：
```bash
python core/database.py --export 2
```

## ID 体系

| 字段 | 含义 | 示例 |
|------|------|------|
| `aid` | 本站小说 ID（自增） | `2` |
| `data_source_aid` | 源站小说 ID | `3057` |
| `cid` | 本站章节 ID（每本从1递增） | `1` |
| `data_source_cid` | 源站章节 ID | `125416` |
| `data_source` | 数据源 ID（1=文库8） | `1` |

## 常用命令

```bash
# ── 全站发现 ──
python orchestrate/discover.py                    # 遍历排行榜，保存索引
python orchestrate/discover.py --max-pages 10     # 仅前10页（测试）

# ── 批量下载 ──
python orchestrate/batch.py --top 10              # 下载前10本
python orchestrate/batch.py --tag 校园 --top 20   # 按标签过滤
python orchestrate/batch.py --status 已完结       # 只下载已完结
python orchestrate/batch.py --resume              # 断点续爬
python orchestrate/batch.py --update              # 增量更新

# ── 并发控制 ──
python orchestrate/scraper.py --aid 3057 --concurrent 3   # 小说内3并发
python orchestrate/batch.py --top 50 --concurrent 1       # 小说间串行

# ── 插图修复 ──
python orchestrate/repair_images.py novels/aid_2          # 下载缺失插图
python orchestrate/repair_images.py novels/aid_2 --dry-run # 仅检查

# ── 数据导出 ──
python core/database.py --export 2                        # 从 DB 导出 JSON
python core/exporter.py novels/aid_2 --format txt         # 导出 TXT
python core/exporter.py novels/aid_2 --format epub        # 导出 EPUB

# ── 增量更新已有小说 ──
python orchestrate/scraper.py --update novels/aid_2
```

## 导出格式

```bash
python core/exporter.py novels/aid_2 --format txt                     # 合并单文件
python core/exporter.py novels/aid_2 --format txt --split-by-volume   # 按卷分文件
python core/exporter.py novels/aid_2 --format json                    # 结构化 JSON
python core/exporter.py novels/aid_2 --format epub                    # 电子书（含插图）
python core/exporter.py novels/aid_2 --format all                     # 全部格式
```

## 配置

认证信息优先从缓存加载，7天内有效。首次使用需提供账密，后续自动从 `.auth_cookies.json` 读取。

数据源配置在 `data_sources.json`，当前仅支持 wenku8。
