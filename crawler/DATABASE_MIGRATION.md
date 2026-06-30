# 数据库改造总结

> 改造日期: 2026-06-27
> 目标: 统一数据存储到数据库，减少临时 JSON 文件依赖

---

## 一、新增数据库表

### site_novels（全站索引表）

存储全站发现的所有小说（4123本），与已下载小说解耦。

**表结构：**

```sql
CREATE TABLE site_novels (
    id               SERIAL PRIMARY KEY,
    data_source_aid  INTEGER NOT NULL UNIQUE,  -- 源站小说 ID（wenku8）
    title            TEXT NOT NULL,
    url              TEXT DEFAULT '',
    tags             TEXT[],           -- 标签数组
    status           TEXT DEFAULT '',  -- 状态（连载中/已完结）
    rating           TEXT DEFAULT '',  -- 评级（S/A/B/C/D）
    is_downloaded    BOOLEAN DEFAULT FALSE,   -- 是否已下载
    downloaded_aid   INTEGER REFERENCES novels(id),  -- 关联本站 ID
    discovered_at    TIMESTAMPTZ DEFAULT NOW(),
    last_checked     TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_site_novels_aid ON site_novels(data_source_aid);
CREATE INDEX idx_site_novels_downloaded ON site_novels(is_downloaded);
CREATE INDEX idx_site_novels_tags ON site_novels USING GIN(tags);
```

---

## 二、改造内容

### 1. discover.py（小说发现器）

**改造前：**
```
discover.py → _site_index.json（仅保存到 JSON）
```

**改造后：**
```
discover.py → _site_index.json（保留兼容）
       ↓
       → site_novels 表（新增：双写数据库）
```

**新增方法：**
- `NovelDiscoverer.save_to_database(novels)` — 批量写入 site_novels 表

**调用位置：**
- `discover.py` 的 `main()` 函数中，保存 JSON 后立即写入数据库

---

### 2. batch.py（批量下载编排器）

**改造前：**
```
batch.py → 从 _site_index.json 加载小说列表
       ↓
     逐本下载
```

**改造后：**
```
batch.py → 优先从 site_novels 表加载（支持筛选/分页）
       ↓
     数据库无数据则回退到 JSON
       ↓
     逐本下载
```

**新增方法：**
- `BatchScraper._load_novels_from_database()` — 从数据库加载待下载列表
- 支持筛选：`tags` / `status` / `rating`
- 支持分页：`top`（前 N 本）
- 支持断点续爬：`resume`（仅加载未完成的）

**新增参数：**
- `--use-db`（默认启用）：优先从数据库加载
- `--no-use-db`：仅从 JSON 文件加载

**示例：**

```bash
# 从数据库加载前 50 本（支持筛选）
python batch.py --top 50 --tag 校园 --status 已完结

# 仅从 JSON 加载（兼容旧模式）
python batch.py --top 50 --no-use-db

# 增量更新（自动双写数据库）
python batch.py --update
```

---

### 3. database.py（数据库模块）

**新增 CRUD 方法：**

| 方法 | 功能 |
|------|------|
| `upsert_site_novel(aid, title, url)` | 插入/更新单条全站索引 |
| `batch_upsert_site_novels(novels)` | 批量插入/更新 |
| `mark_site_novel_downloaded(aid, novel_id)` | 标记为已下载 |
| `get_site_novel(aid)` | 查询单条 |
| `get_site_novels(tags, status, rating, offset, limit)` | 分页查询（支持筛选） |
| `get_all_site_novels(downloaded_only)` | 获取所有（或仅已下载） |
| `get_site_novels_count()` | 统计信息（总数/已下载/待下载） |

---

### 4. 移除爬取中间过程的 JSON 临时文件

**删除的 to_json 方法：**

- `fetch/parser_book.py::to_json()` — 从未被调用
- `fetch/parser_catalog.py::to_json()` — 从未被调用
- `fetch/parser_chapter.py::to_json()` — 从未被调用

**保留的 JSON 文件：**

| 文件 | 理由 |
|------|------|
| `_site_index.json` | 兼容旧模式，discover.py 仍然生成 |
| `_site_checkpoint.json` | 站点级断点，快速检查点 |
| `novels/aid_*/*.json` | novel-frontend 兼容导出 |
| `novels/aid_*/*.txt` | 用户可见输出 |
| `data_sources.json` | 配置文件 |
| `.auth_cookies.json` | Cookie 缓存 |

---

## 三、数据流对比

### 改造前

```
用户
 ↓
discover.py ──→ _site_index.json（唯一索引）
 ↓
batch.py（从 JSON 加载）
 ↓
scraper.py ──→ novels/aid_*/*.json ──→ PostgreSQL（详细数据）
```

### 改造后

```
用户
 ↓
discover.py ──→ _site_index.json（兼容） + site_novels 表（主索引）
 ↓
batch.py（优先从数据库加载）
 ↓
scraper.py ──→ novels/aid_*/*.json（导出） + PostgreSQL（主存储）
 ↓
mark_site_novel_downloaded() ──→ 更新 is_downloaded=TRUE
```

---

## 四、快速开始

### 1. 初始化数据库

```bash
python crawler/core/database.py --init
```

### 2. 同步已下载小说到 site_novels

```bash
python crawler/orchestrate/sync_downloaded.py
```

### 3. 重新发现全站索引（双写数据库）

```bash
python crawler/orchestrate/discover.py --max-pages 10  # 测试前10页
python crawler/orchestrate/discover.py                 # 全量
```

### 4. 批量下载（从数据库加载）

```bash
# 从数据库加载前 50 本
python crawler/orchestrate/batch.py --top 50 --concurrent 3

# 按标签/状态筛选
python crawler/orchestrate/batch.py --tag 校园 --status 已完结

# 断点续爬
python crawler/orchestrate/batch.py --resume

# 增量更新
python crawler/orchestrate/batch.py --update
```

---

## 五、数据库查询示例

### 查看全站索引统计

```python
from core.database import NovelDB

db = NovelDB()
stats = db.get_site_novels_count()
print(f"总数: {stats['total']}, 已下载: {stats['downloaded']}, 待下载: {stats['pending']}")
db.close()
```

### 分页查询待下载小说

```python
db = NovelDB()
novels, total = db.get_site_novels(downloaded=False, offset=0, limit=20)
for n in novels:
    print(f"{n['data_source_aid']}: {n['title']}")
db.close()
```

### 按标签筛选

```python
db = NovelDB()
novels, total = db.get_site_novels(tags=["校园"], offset=0, limit=20)
db.close()
```

---

## 六、注意事项

### 1. 数据库优先策略

- `discover.py` 现在**双写**：JSON + 数据库
- `batch.py` **优先从数据库加载**，失败才回退 JSON
- 可以通过 `--no-use-db` 强制使用 JSON

### 2. site_novels 与 novels 表的关系

| 字段 | site_novels | novels |
|------|-------------|--------|
| **用途** | 全站索引（未下载） | 已下载小说详细数据 |
| **data_source_aid** | ✅ 唯一 | ✅ 唯一（与 data_source_id 联合） |
| **tags/status/rating** | ✅ 可能有 | ✅ 一定有 |
| **chapters/content** | ❌ 无 | ✅ 有 |
| **is_downloaded** | ✅ 标记状态 | ❌ 不适用 |

### 3. 标签/状态/评级数据来源

`site_novels` 表的 `tags`、`status`、`rating` 字段在发现阶段为空。
下载完成后，从 `novels` 表反向更新：

```python
# 下载完成后
novel = db.get_novel_by_source(1, data_source_aid)
db.upsert_site_novel(
    data_source_aid=data_source_aid,
    title=novel["title"],
    tags=novel["tags"],
    status=novel["status"],
    rating=novel["rating"],
)
```

**TODO：** 可以在 `scraper.py` 下载完成后自动反向更新 site_novels。

---

## 七、验证清单

- [x] site_novels 表创建成功
- [x] discover.py 双写数据库成功
- [x] batch.py 从数据库加载成功
- [x] 已下载 6 本小说同步到 site_novels
- [x] CRUD 方法测试通过
- [x] 移除 parser 的 to_json 方法
- [ ] TODO: scraper.py 下载完成后自动反向更新 site_novels
- [ ] TODO: FastAPI 新增全站索引查询端点
