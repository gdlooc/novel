"""数据库模块 — PostgreSQL 连接管理 + Schema + CRUD

使用 psycopg2 连接 PostgreSQL，管理小说数据的完整生命周期。

用法:
  from database import NovelDB
  db = NovelDB()
  db.init_schema()
  aid = db.insert_novel({...})
  db.close()
"""

import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import psycopg2
import psycopg2.extras

# ═══════════════════════════════════════════════════════════════
# 配置
# ═══════════════════════════════════════════════════════════════

# 评分等级映射：wenku8 热度评级 → 数字（越小越高）
# 用于范围查询——"A级以上"匹配 S级 和 A级
# 注意：键值带"级"后缀，与 parser_book.py 提取的值（"S级"/"A级"等）一致
RATING_ORDER = {"S级": 1, "A级": 2, "B级": 3, "C级": 4, "D级": 5, "E级": 6}

# 默认连接参数（从环境变量读取，无则用默认）
_DEFAULT_CONFIG = {
    "host": os.environ.get("PGHOST", "localhost"),
    "port": int(os.environ.get("PGPORT", "5432")),
    "dbname": os.environ.get("PGDATABASE", "novels"),
    "user": os.environ.get("PGUSER", "postgres"),
    "password": os.environ.get("PGPASSWORD", "ty1235556"),
}

# ═══════════════════════════════════════════════════════════════
# 数据库管理类
# ═══════════════════════════════════════════════════════════════

class NovelDB:
    """小说数据库管理

    封装所有数据库操作，对外提供简洁的方法接口。
    内部使用 psycopg2 连接池模式（autocommit + 每次操作获取 cursor）。
    """

    def __init__(self, config: Optional[Dict] = None):
        """
        Args:
            config: psycopg2 连接参数字典，默认使用 _DEFAULT_CONFIG
        """
        cfg = {**_DEFAULT_CONFIG, **(config or {})}
        self._conn = psycopg2.connect(**cfg)
        # 使用 RealDictCursor，查询结果可直接当 dict 用
        self._conn.cursor_factory = psycopg2.extras.RealDictCursor
        # 自动提交：每个 SQL 语句自动 commit，避免并发任务间的事务冲突
        self._conn.autocommit = True

    # ─── Schema 初始化 ───

    def init_schema(self):
        """创建所有表 + 索引 + 初始数据源"""
        with self._conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS data_sources (
                    id          SERIAL PRIMARY KEY,
                    name        TEXT NOT NULL UNIQUE,
                    cn_name     TEXT,
                    url         TEXT,
                    description TEXT
                );

                CREATE TABLE IF NOT EXISTS novels (
                    id                  SERIAL PRIMARY KEY,
                    data_source_id      INTEGER NOT NULL REFERENCES data_sources(id),
                    data_source_aid     INTEGER NOT NULL,
                    title               TEXT NOT NULL,
                    author              TEXT DEFAULT '',
                    publisher           TEXT DEFAULT '',
                    status              TEXT DEFAULT '',
                    is_completed        BOOLEAN DEFAULT FALSE,
                    last_update         TEXT DEFAULT '',
                    word_count          TEXT DEFAULT '',
                    rating              TEXT DEFAULT '',
                    description         TEXT DEFAULT '',
                    cover_url           TEXT DEFAULT '',
                    total_chapters      INTEGER DEFAULT 0,
                    completed_chapters  INTEGER DEFAULT 0,
                    data_source_catalog_url TEXT DEFAULT '',
                    data_source_book_url    TEXT DEFAULT '',
                    created_at          TIMESTAMPTZ DEFAULT NOW(),
                    updated_at          TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(data_source_id, data_source_aid)
                );

                CREATE TABLE IF NOT EXISTS novel_tags (
                    novel_id    INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
                    tag         TEXT NOT NULL,
                    PRIMARY KEY (novel_id, tag)
                );

                CREATE TABLE IF NOT EXISTS volumes (
                    id          SERIAL PRIMARY KEY,
                    novel_id    INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
                    name        TEXT NOT NULL,
                    sort_order  INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS chapters (
                    id                      SERIAL PRIMARY KEY,
                    novel_id                INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
                    data_source_cid         INTEGER NOT NULL,
                    volume_id               INTEGER REFERENCES volumes(id),
                    title                   TEXT NOT NULL,
                    content                 TEXT DEFAULT '',
                    book_title              TEXT DEFAULT '',
                    has_images              BOOLEAN DEFAULT FALSE,
                    data_source_prev_cid    TEXT DEFAULT '',
                    data_source_next_cid    TEXT DEFAULT '',
                    data_source_index_url   TEXT DEFAULT '',
                    data_source_chapter_url TEXT DEFAULT '',
                    sort_order              INTEGER DEFAULT 0,
                    char_count              INTEGER DEFAULT 0,
                    created_at              TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(novel_id, data_source_cid)
                );

                CREATE TABLE IF NOT EXISTS chapter_images (
                    id          SERIAL PRIMARY KEY,
                    chapter_id  INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
                    url         TEXT NOT NULL,
                    filename    TEXT NOT NULL,
                    local_path  TEXT DEFAULT '',
                    downloaded  BOOLEAN DEFAULT FALSE
                );

                CREATE TABLE IF NOT EXISTS crawl_progress (
                    novel_id              INTEGER PRIMARY KEY REFERENCES novels(id),
                    completed_source_cids JSONB DEFAULT '[]',
                    failed_source_cids    JSONB DEFAULT '[]',
                    updated_at            TIMESTAMPTZ DEFAULT NOW()
                );

                -- ═══════════════════════════════════════════════════════════════
                -- 全站索引表：存储发现的所有小说（尚未全部下载）
                -- ═══════════════════════════════════════════════════════════════
                CREATE TABLE IF NOT EXISTS site_novels (
                    id               SERIAL PRIMARY KEY,
                    data_source_aid  INTEGER NOT NULL UNIQUE,  -- 源站小说 ID（wenku8）
                    title            TEXT NOT NULL,
                    url              TEXT DEFAULT '',
                    tags             TEXT[],           -- 标签数组（初始为空，下载后补充）
                    status           TEXT DEFAULT '',  -- 状态（连载中/已完结）
                    rating           TEXT DEFAULT '',  -- 评级（S/A/B/C/D）
                    is_downloaded    BOOLEAN DEFAULT FALSE,   -- 是否已下载
                    downloaded_aid   INTEGER REFERENCES novels(id),  -- 关联已下载的小说 ID
                    discovered_at    TIMESTAMPTZ DEFAULT NOW(),
                    last_checked     TIMESTAMPTZ DEFAULT NOW()
                );
            """)

            # 索引
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_chapters_novel_id ON chapters(novel_id);
                CREATE INDEX IF NOT EXISTS idx_chapters_sort ON chapters(novel_id, sort_order);
                CREATE INDEX IF NOT EXISTS idx_chapter_images_chapter ON chapter_images(chapter_id);
                CREATE INDEX IF NOT EXISTS idx_novel_tags_novel ON novel_tags(novel_id);
                CREATE INDEX IF NOT EXISTS idx_novels_source ON novels(data_source_id, data_source_aid);
                CREATE INDEX IF NOT EXISTS idx_site_novels_aid ON site_novels(data_source_aid);
                CREATE INDEX IF NOT EXISTS idx_site_novels_downloaded ON site_novels(is_downloaded);
                CREATE INDEX IF NOT EXISTS idx_site_novels_tags ON site_novels USING GIN(tags);
            """)

            # 插入默认数据源（wenku8）
            cur.execute("""
                INSERT INTO data_sources (id, name, cn_name, url, description)
                VALUES (1, 'wenku8', '文库8', 'https://www.wenku8.net',
                        '文库8是一个提供免费在线小说阅读的平台，拥有丰富的小说资源。')
                ON CONFLICT (id) DO NOTHING;
            """)

        self._conn.commit()

    # ─── 小说 CRUD ───

    def insert_novel(self, meta: Dict) -> int:
        """插入小说元数据，返回本站 aid

        Args:
            meta: 包含 title, author, data_source_id, data_source_aid 等字段的字典

        Returns:
            本站小说 ID
        """
        tags = meta.pop("tags", []) or []
        volumes_data = meta.pop("_volumes", []) or []

        with self._conn.cursor() as cur:
            cur.execute("""
                INSERT INTO novels (
                    data_source_id, data_source_aid, title, author,
                    publisher, status, is_completed, last_update,
                    word_count, rating, description, cover_url,
                    total_chapters, completed_chapters,
                    data_source_catalog_url, data_source_book_url
                ) VALUES (
                    %(data_source_id)s, %(data_source_aid)s, %(title)s, %(author)s,
                    %(publisher)s, %(status)s, %(is_completed)s, %(last_update)s,
                    %(word_count)s, %(rating)s, %(description)s, %(cover_url)s,
                    %(total_chapters)s, %(completed_chapters)s,
                    %(data_source_catalog_url)s, %(data_source_book_url)s
                )
                RETURNING id
            """, meta)
            novel_id = cur.fetchone()["id"]

            # 标签
            if tags:
                self._add_tags(cur, novel_id, tags)

            # 卷
            if volumes_data:
                self._insert_volumes(cur, novel_id, volumes_data)

        self._conn.commit()
        return novel_id

    def update_novel(self, novel_id: int, meta: Dict):
        """更新小说元数据和标签"""
        tags = meta.pop("tags", None)
        volumes_data = meta.pop("_volumes", None)

        with self._conn.cursor() as cur:
            sets = []
            params = {"novel_id": novel_id}
            for key in ["title", "author", "publisher", "status", "is_completed",
                         "last_update", "word_count", "rating", "description",
                         "cover_url", "total_chapters", "completed_chapters",
                         "data_source_catalog_url", "data_source_book_url"]:
                if key in meta:
                    sets.append(f"{key} = %({key})s")
                    params[key] = meta[key]

            if sets:
                sets.append("updated_at = NOW()")
                cur.execute(f"UPDATE novels SET {', '.join(sets)} WHERE id = %(novel_id)s", params)

            if tags is not None:
                cur.execute("DELETE FROM novel_tags WHERE novel_id = %(novel_id)s", params)
                self._add_tags(cur, novel_id, tags)

            if volumes_data is not None:
                cur.execute("DELETE FROM volumes WHERE novel_id = %(novel_id)s", params)
                self._insert_volumes(cur, novel_id, volumes_data)

        self._conn.commit()

    def get_novel(self, novel_id: int) -> Optional[Dict]:
        """获取小说完整信息（含标签）"""
        with self._conn.cursor() as cur:
            cur.execute("SELECT * FROM novels WHERE id = %s", (novel_id,))
            novel = cur.fetchone()
            if not novel:
                return None
            novel = dict(novel)
            cur.execute("SELECT tag FROM novel_tags WHERE novel_id = %s", (novel_id,))
            novel["tags"] = [r["tag"] for r in cur.fetchall()]
            return novel

    def get_novel_by_source(self, data_source_id: int, data_source_aid: int) -> Optional[Dict]:
        """通过源站 aid 查找小说"""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM novels WHERE data_source_id = %s AND data_source_aid = %s",
                (data_source_id, data_source_aid),
            )
            novel = cur.fetchone()
            if not novel:
                return None
            novel = dict(novel)
            cur.execute("SELECT tag FROM novel_tags WHERE novel_id = %s", (novel["id"],))
            novel["tags"] = [r["tag"] for r in cur.fetchall()]
            return novel

    def get_all_novel_ids(self) -> List[int]:
        """获取所有本站 aid 列表"""
        with self._conn.cursor() as cur:
            cur.execute("SELECT id FROM novels ORDER BY id")
            return [r["id"] for r in cur.fetchall()]

    def get_all_source_aids(self, data_source_id: int = 1) -> Set[int]:
        """获取所有已下载的源站 aid 集合"""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT data_source_aid FROM novels WHERE data_source_id = %s",
                (data_source_id,),
            )
            return {r["data_source_aid"] for r in cur.fetchall()}

    # ═══════════════════════════════════════════════════════════════
    # 全站索引 CRUD（site_novels 表）
    # ═══════════════════════════════════════════════════════════════

    def upsert_site_novel(self, data_source_aid: int, title: str, url: str = "") -> int:
        """插入或更新全站索引小说，返回 site_novel id

        用于 discover.py 发现小说时写入数据库。
        如果已存在则更新 title/url/last_checked，不覆盖其他字段。

        Args:
            data_source_aid: 源站小说 ID
            title: 小说标题
            url: 小说详情页 URL
        """
        with self._conn.cursor() as cur:
            cur.execute("""
                INSERT INTO site_novels (data_source_aid, title, url, last_checked)
                VALUES (%s, %s, %s, NOW())
                ON CONFLICT (data_source_aid)
                DO UPDATE SET
                    title = EXCLUDED.title,
                    url = EXCLUDED.url,
                    last_checked = EXCLUDED.last_checked
                RETURNING id
            """, (data_source_aid, title, url))
            site_id = cur.fetchone()["id"]
        self._conn.commit()
        return site_id

    def batch_upsert_site_novels(self, novels: List[Dict]):
        """批量插入或更新全站索引小说

        Args:
            novels: 小说列表，每项包含 data_source_aid, title, url
        """
        with self._conn.cursor() as cur:
            for novel in novels:
                cur.execute("""
                    INSERT INTO site_novels (data_source_aid, title, url, last_checked)
                    VALUES (%(data_source_aid)s, %(title)s, %(url)s, NOW())
                    ON CONFLICT (data_source_aid)
                    DO UPDATE SET
                        title = EXCLUDED.title,
                        url = EXCLUDED.url,
                        last_checked = EXCLUDED.last_checked
                """, novel)
        self._conn.commit()

    def mark_site_novel_downloaded(self, data_source_aid: int, downloaded_aid: int):
        """标记全站索引中的小说为已下载

        Args:
            data_source_aid: 源站小说 ID
            downloaded_aid: 已下载小说的本站 ID（ novels.id ）
        """
        with self._conn.cursor() as cur:
            cur.execute("""
                UPDATE site_novels
                SET is_downloaded = TRUE,
                    downloaded_aid = %s,
                    last_checked = NOW()
                WHERE data_source_aid = %s
            """, (downloaded_aid, data_source_aid))
        self._conn.commit()

    def sync_site_novel_from_novel(self, novel_id: int):
        """从 novels 表反向同步 tags/status/rating 到 site_novels 表

        下载完成后调用，确保 site_novels 中的元数据与 novels 表一致。
        同时标记 is_downloaded = TRUE 和设置 downloaded_aid。

        设计意图：
        - discover.py 发现小说时只写入 data_source_aid/title/url
        - tags/status/rating 需下载书页后才能获取
        - 下载完成后调用此方法回填 site_novels 的元数据
        - 这样 site_novels 就能支持按标签/状态/评级筛选

        Args:
            novel_id: 本站小说 ID（novels.id）
        """
        with self._conn.cursor() as cur:
            # 从 novels 表读取元数据 + 标签
            cur.execute("""
                SELECT
                    n.data_source_aid,
                    n.status,
                    n.rating,
                    n.is_completed,
                    ARRAY(SELECT tag FROM novel_tags WHERE novel_id = n.id) AS tags
                FROM novels n
                WHERE n.id = %s
            """, (novel_id,))
            row = cur.fetchone()
            if not row:
                return  # 小说不存在，静默返回

            # 回写 site_novels：更新 tags、status、rating，同时标记已下载
            cur.execute("""
                UPDATE site_novels
                SET tags = %(tags)s,
                    status = %(status)s,
                    rating = %(rating)s,
                    is_downloaded = TRUE,
                    downloaded_aid = %(downloaded_aid)s,
                    last_checked = NOW()
                WHERE data_source_aid = %(data_source_aid)s
            """, {
                "tags": row["tags"] or [],
                "status": row["status"] or "",
                "rating": row["rating"] or "",
                "downloaded_aid": novel_id,
                "data_source_aid": row["data_source_aid"],
            })

        self._conn.commit()

    def update_site_novel_metadata(
        self,
        data_source_aid: int,
        rating: str = "",
        tags: Optional[List[str]] = None,
        status: str = "",
    ):
        """更新 site_novels 的元数据字段（rating/tags/status）

        用于 scan_metadata.py 预扫描书页后回填元数据。
        仅请求书页 HTML 而不下载章节，提取 rating/tags/status 后更新。

        设计意图：
        - discover.py 发现阶段 site_novels 的 rating/tags/status 为空
        - scan_metadata.py 轻量请求书页后调用此方法回填
        - 回填后 site_novels 即可支持按评分/标签/状态筛选

        Args:
            data_source_aid: 源站小说 ID
            rating: 评级（如 "S级"）
            tags: 标签列表
            status: 状态（如 "连载中"）
        """
        with self._conn.cursor() as cur:
            cur.execute("""
                UPDATE site_novels
                SET rating = %(rating)s,
                    tags = %(tags)s,
                    status = %(status)s,
                    last_checked = NOW()
                WHERE data_source_aid = %(data_source_aid)s
            """, {
                "rating": rating,
                "tags": tags or [],
                "status": status,
                "data_source_aid": data_source_aid,
            })
        self._conn.commit()

    def get_site_novels_needing_scan(
        self,
        limit: Optional[int] = None,
        force: bool = False,
    ) -> List[Dict]:
        """获取需要元数据扫描的小说列表

        用于 scan_metadata.py 获取待扫描的小说。
        默认只返回 rating 为空的行（未扫描过的），force=True 时返回全部。

        Args:
            limit: 限制返回数量
            force: True=返回全部（即使已有 rating），False=仅返回 rating 为空的行

        Returns:
            小说列表，每项含 data_source_aid, title, url
        """
        with self._conn.cursor() as cur:
            if force:
                cur.execute("""
                    SELECT data_source_aid, title, url FROM site_novels
                    ORDER BY id
                    LIMIT %s
                """, (limit or 10000,))
            else:
                cur.execute("""
                    SELECT data_source_aid, title, url FROM site_novels
                    WHERE rating = '' OR rating IS NULL
                    ORDER BY id
                    LIMIT %s
                """, (limit or 10000,))
            return [dict(row) for row in cur.fetchall()]

    def get_site_novel(self, data_source_aid: int) -> Optional[Dict]:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM site_novels WHERE data_source_aid = %s",
                (data_source_aid,),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    def get_site_novels(
        self,
        downloaded: Optional[bool] = None,
        tags: Optional[List[str]] = None,
        status: Optional[str] = None,
        min_rating: Optional[str] = None,
        offset: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Dict], int]:
        """获取全站索引小说列表，支持筛选和分页

        Args:
            downloaded: None=全部, True=已下载, False=未下载
            tags: 按标签过滤（任意匹配）
            status: 按状态过滤
            min_rating: 最低评级（如 "A" 表示匹配 S 和 A 级，含空字符串的未扫描小说）
            offset: 分页偏移
            limit: 每页数量

        Returns:
            (novels_list, total_count)
        """
        where_clauses = []
        params = {"offset": offset, "limit": limit}

        if downloaded is not None:
            where_clauses.append("is_downloaded = %(downloaded)s")
            params["downloaded"] = downloaded

        if status:
            where_clauses.append("status = %(status)s")
            params["status"] = status

        if min_rating:
            # 评分范围查询：计算所有 >= 目标等级的评分值
            # 归一化输入：支持 "S" 和 "S级" 两种写法
            rating_key = min_rating if min_rating.endswith("级") else min_rating + "级"
            target_order = RATING_ORDER.get(rating_key)
            if target_order is not None:
                allowed = [k for k, v in RATING_ORDER.items() if v <= target_order]
                where_clauses.append("(rating = ANY(%(allowed_ratings)s) OR rating = '')")
                params["allowed_ratings"] = allowed

        if tags:
            # tags 数组字段包含任意一个匹配标签
            where_clauses.append("tags && %(tags)s::text[]")
            params["tags"] = tags

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        with self._conn.cursor() as cur:
            # 总数
            cur.execute(f"SELECT COUNT(*) as total FROM site_novels {where_sql}", params)
            total = cur.fetchone()["total"]

            # 分页数据
            cur.execute(f"""
                SELECT * FROM site_novels {where_sql}
                ORDER BY discovered_at DESC
                LIMIT %(limit)s OFFSET %(offset)s
            """, params)
            novels = [dict(row) for row in cur.fetchall()]

        return novels, total

    def search_catalog(
        self,
        query: Optional[str] = None,
        tags: Optional[List[str]] = None,
        status: Optional[str] = None,
        min_rating: Optional[str] = None,
        downloaded: Optional[bool] = None,
        offset: int = 0,
        limit: int = 20,
    ) -> Tuple[List[Dict], int]:
        """搜索全站小说目录，支持标题搜索 + 多条件筛选 + 分页

        与 get_site_novels 的区别：
        - 支持标题模糊搜索（ILIKE）
        - LEFT JOIN novels 表获取已下载小说的作者/封面/章节数
        - 返回更丰富的卡片展示所需字段

        Args:
            query: 标题搜索关键词（ILIKE 模糊匹配）
            tags: 按标签过滤（任意匹配）
            status: 按状态过滤
            min_rating: 最低评级（如 "A" 表示匹配 S 和 A 级）
            downloaded: None=全部, True=仅已下载, False=仅未下载
            offset: 分页偏移
            limit: 每页数量

        Returns:
            (enriched_novels_list, total_count)
        """
        where_clauses = []
        params = {"offset": offset, "limit": limit}

        if query:
            where_clauses.append("s.title ILIKE %(query)s")
            params["query"] = f"%{query}%"

        if downloaded is not None:
            where_clauses.append("s.is_downloaded = %(downloaded)s")
            params["downloaded"] = downloaded

        if status:
            where_clauses.append("s.status = %(status)s")
            params["status"] = status

        if min_rating:
            # 评分范围查询：计算所有 >= 目标等级的评分值
            # 归一化输入：支持 "S" 和 "S级" 两种写法
            rating_key = min_rating if min_rating.endswith("级") else min_rating + "级"
            target_order = RATING_ORDER.get(rating_key)
            if target_order is not None:
                allowed = [k for k, v in RATING_ORDER.items() if v <= target_order]
                where_clauses.append("(s.rating = ANY(%(allowed_ratings)s) OR s.rating = '')")
                params["allowed_ratings"] = allowed

        if tags:
            where_clauses.append("s.tags && %(tags)s::text[]")
            params["tags"] = tags

        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

        with self._conn.cursor() as cur:
            # 总数
            cur.execute(
                f"SELECT COUNT(*) as total FROM site_novels s {where_sql}", params
            )
            total = cur.fetchone()["total"]

            # 分页数据：LEFT JOIN novels 获取已下载小说的补充信息
            cur.execute(
                f"""
                SELECT
                    s.data_source_aid,
                    s.title,
                    s.url,
                    s.tags,
                    s.status,
                    s.rating,
                    s.is_downloaded,
                    s.downloaded_aid,
                    n.author,
                    n.cover_url,
                    n.total_chapters,
                    n.word_count,
                    n.description
                FROM site_novels s
                LEFT JOIN novels n ON s.downloaded_aid = n.id
                {where_sql}
                ORDER BY s.is_downloaded DESC, s.discovered_at DESC
                LIMIT %(limit)s OFFSET %(offset)s
                """,
                params,
            )
            novels = [dict(row) for row in cur.fetchall()]

        return novels, total

    def get_all_site_novels(self, downloaded_only: bool = False) -> List[Dict]:
        """获取所有全站索引小说

        Args:
            downloaded_only: True=仅已下载, False=全部

        Returns:
            小说列表
        """
        with self._conn.cursor() as cur:
            if downloaded_only:
                cur.execute("SELECT * FROM site_novels WHERE is_downloaded = TRUE ORDER BY id")
            else:
                cur.execute("SELECT * FROM site_novels ORDER BY id")
            return [dict(row) for row in cur.fetchall()]

    def get_site_novels_count(self) -> Dict[str, int]:
        """获取全站索引统计信息"""
        with self._conn.cursor() as cur:
            cur.execute("""
                SELECT
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE is_downloaded = TRUE) as downloaded,
                    COUNT(*) FILTER (WHERE is_downloaded = FALSE) as pending
                FROM site_novels
            """)
            row = cur.fetchone()
            return dict(row) if row else {"total": 0, "downloaded": 0, "pending": 0}

    # ─── 章节 CRUD ───

    def insert_chapter(self, data: Dict) -> int:
        """插入章节，返回本站 cid

        Args:
            data: chapter 数据字典，包含 novel_id, data_source_cid, title, content 等
        """
        with self._conn.cursor() as cur:
            cur.execute("""
                INSERT INTO chapters (
                    novel_id, data_source_cid, volume_id, title, content,
                    book_title, has_images,
                    data_source_prev_cid, data_source_next_cid,
                    data_source_index_url, data_source_chapter_url,
                    sort_order, char_count
                ) VALUES (
                    %(novel_id)s, %(data_source_cid)s, %(volume_id)s, %(title)s, %(content)s,
                    %(book_title)s, %(has_images)s,
                    %(data_source_prev_cid)s, %(data_source_next_cid)s,
                    %(data_source_index_url)s, %(data_source_chapter_url)s,
                    %(sort_order)s, %(char_count)s
                )
                ON CONFLICT (novel_id, data_source_cid)
                DO UPDATE SET
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    book_title = EXCLUDED.book_title,
                    has_images = EXCLUDED.has_images,
                    data_source_prev_cid = EXCLUDED.data_source_prev_cid,
                    data_source_next_cid = EXCLUDED.data_source_next_cid,
                    data_source_index_url = EXCLUDED.data_source_index_url,
                    data_source_chapter_url = EXCLUDED.data_source_chapter_url,
                    char_count = EXCLUDED.char_count
                RETURNING id
            """, data)
            chapter_id = cur.fetchone()["id"]

        self._conn.commit()
        return chapter_id

    def update_chapter_navigation(self, chapter_id: int, prev_cid: int, next_cid: int):
        """更新章节的本站导航 ID"""
        with self._conn.cursor() as cur:
            cur.execute(
                "UPDATE chapters SET data_source_prev_cid = %s, data_source_next_cid = %s WHERE id = %s",
                (str(prev_cid) if prev_cid else "", str(next_cid) if next_cid else "", chapter_id),
            )
        self._conn.commit()

    def get_chapter(self, chapter_id: int) -> Optional[Dict]:
        """获取单章完整信息"""
        with self._conn.cursor() as cur:
            cur.execute("SELECT * FROM chapters WHERE id = %s", (chapter_id,))
            row = cur.fetchone()
            if not row:
                return None
            data = dict(row)
            cur.execute("SELECT * FROM chapter_images WHERE chapter_id = %s", (chapter_id,))
            data["images"] = [dict(r) for r in cur.fetchall()]
            return data

    def get_chapters(self, novel_id: int) -> List[Dict]:
        """获取小说的所有章节（按 sort_order 排序）"""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM chapters WHERE novel_id = %s ORDER BY sort_order",
                (novel_id,),
            )
            return [dict(r) for r in cur.fetchall()]

    def get_chapter_by_source(self, novel_id: int, data_source_cid: int) -> Optional[Dict]:
        """通过源站 cid 查找章节"""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM chapters WHERE novel_id = %s AND data_source_cid = %s",
                (novel_id, data_source_cid),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    # ─── 插图 CRUD ───

    def insert_images(self, chapter_id: int, images: List[Dict]):
        """批量插入/更新插图元数据"""
        with self._conn.cursor() as cur:
            for img in images:
                cur.execute("""
                    INSERT INTO chapter_images (chapter_id, url, filename, local_path, downloaded)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT DO NOTHING
                """, (chapter_id, img.get("url", ""), img.get("filename", ""),
                      img.get("local_path", ""), img.get("downloaded", False)))
        self._conn.commit()

    # ─── 进度（断点）───

    def get_crawl_progress(self, novel_id: int) -> Tuple[Set[int], List[int]]:
        """获取爬取进度：已完成和失败的源站 cid"""
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT completed_source_cids, failed_source_cids FROM crawl_progress WHERE novel_id = %s",
                (novel_id,),
            )
            row = cur.fetchone()
            if row:
                completed = set(row["completed_source_cids"] or [])
                failed = list(row["failed_source_cids"] or [])
                return completed, failed
            return set(), []

    def update_crawl_progress(self, novel_id: int, completed: Set[int], failed: List[int]):
        """更新爬取进度（UPSERT）"""
        with self._conn.cursor() as cur:
            cur.execute("""
                INSERT INTO crawl_progress (novel_id, completed_source_cids, failed_source_cids, updated_at)
                VALUES (%s, %s::jsonb, %s::jsonb, NOW())
                ON CONFLICT (novel_id)
                DO UPDATE SET
                    completed_source_cids = EXCLUDED.completed_source_cids,
                    failed_source_cids = EXCLUDED.failed_source_cids,
                    updated_at = NOW()
            """, (novel_id, json.dumps(sorted(completed)), json.dumps(failed)))
        self._conn.commit()

    # ─── 存储过程：导航 ID 翻译 ───

    def translate_navigation_ids(self, novel_id: int, cid_map: Dict[int, int]) -> Dict[int, int]:
        """构建源站 cid → 本站 cid 的导航映射，不做写操作。

        返回 lookup 字典供导出时使用。

        Args:
            novel_id: 小说 ID
            cid_map: 源站 cid → 本站 cid (sort_order) 的映射

        Returns:
            {chapter_sort_order: (prev_local_cid, next_local_cid), ...}
        """
        result = {}
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT sort_order, data_source_prev_cid, data_source_next_cid FROM chapters WHERE novel_id = %s",
                (novel_id,),
            )
            for row in cur.fetchall():
                src_prev = row["data_source_prev_cid"]
                src_next = row["data_source_next_cid"]
                local_cid = row["sort_order"]

                # 翻译 prev（源站 cid → 本地 cid）
                prev_val = 0
                if src_prev and src_prev != "index":
                    try:
                        prev_val = cid_map.get(int(src_prev), 0)
                    except ValueError:
                        pass

                # 翻译 next
                next_val = 0
                if src_next:
                    try:
                        next_val = cid_map.get(int(src_next), 0)
                    except ValueError:
                        pass

                result[local_cid] = (prev_val, next_val)
        return result

    # ─── 导出：DB → JSON 文件（novel-frontend 兼容）───

    def export_to_json(self, novel_id: int, output_dir: str):
        """将数据库中指定小说导出为 JSON 文件结构

        生成和当前爬虫文件输出完全一致的结构：
          {output_dir}/metadata.json + chapters.json + chapters/{cid}.json + {cid}.txt

        Args:
            novel_id: 本站小说 ID
            output_dir: 输出根目录（如 novels/）
        """
        novel = self.get_novel(novel_id)
        if not novel:
            raise ValueError(f"小说不存在: aid={novel_id}")

        out = Path(output_dir) / f"aid_{novel_id}"
        out.mkdir(parents=True, exist_ok=True)
        chapters_dir = out / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)

        # 获取所有章节
        chapters = self.get_chapters(novel_id)

        # ── metadata.json ──
        ds_name = ""
        with self._conn.cursor() as cur:
            cur.execute("SELECT name FROM data_sources WHERE id = %s", (novel["data_source_id"],))
            row = cur.fetchone()
            if row:
                ds_name = row["name"]

        metadata = {
            "aid": novel["id"],
            "data_source": novel["data_source_id"],
            "data_source_name": ds_name,
            "data_source_aid": novel["data_source_aid"],
            "title": novel["title"],
            "author": novel["author"],
            "publisher": novel["publisher"],
            "status": novel["status"],
            "is_completed": novel["is_completed"],
            "last_update": novel["last_update"],
            "word_count": novel["word_count"],
            "tags": novel.get("tags", []),
            "rating": novel["rating"],
            "description": novel["description"],
            "cover_url": novel["cover_url"],
            "total_chapters": novel["total_chapters"],
            "completed_chapters": novel["completed_chapters"],
            "failed_chapters": 0,
            "data_source_failed_cids": [],
            "data_source_catalog_url": novel["data_source_catalog_url"],
            "data_source_book_url": novel["data_source_book_url"],
        }
        (out / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

        # ── 读取卷信息 ──
        volume_map: Dict[int, str] = {}
        with self._conn.cursor() as cur:
            cur.execute("SELECT id, name FROM volumes WHERE novel_id = %s ORDER BY sort_order", (novel_id,))
            for row in cur.fetchall():
                volume_map[row["id"]] = row["name"]

        # ── chapters.json ──（cid 使用 sort_order，保证每本小说从1递增）──
        chapters_list = []
        for ch in chapters:
            local_cid = ch.get("sort_order", ch["id"])
            vol_name = volume_map.get(ch.get("volume_id") or 0, "")
            chapters_list.append({
                "cid": local_cid,
                "data_source_cid": ch["data_source_cid"],
                "aid": novel_id,
                "data_source_aid": novel["data_source_aid"],
                "volume": vol_name,
                "title": ch["title"],
                "data_source_chapter_url": ch["data_source_chapter_url"],
                "completed": True,
            })
        (out / "chapters.json").write_text(
            json.dumps(chapters_list, ensure_ascii=False, indent=2), encoding="utf-8")

        # ── 构建导航映射（源站 cid → 本地 cid）──
        cid_map = {ch["data_source_cid"]: ch.get("sort_order", ch["id"]) for ch in chapters}
        nav_lookup = self.translate_navigation_ids(novel_id, cid_map)

        # ── 章节 JSON + TXT（文件名使用 sort_order = 本地 cid）──
        for ch in chapters:
            local_cid = ch.get("sort_order", ch["id"])
            db_id = ch["id"]
            prev_cid, next_cid = nav_lookup.get(local_cid, (0, 0))
            # JSON
            ch_json = self.get_chapter(db_id) or {}
            images_data = ch_json.pop("images", [])
            export_json = {
                "cid": local_cid,
                "data_source_cid": ch["data_source_cid"],
                "aid": novel_id,
                "data_source_aid": novel["data_source_aid"],
                "data_source": novel["data_source_id"],
                "data_source_name": ds_name,
                "title": ch["title"],
                "book_title": ch.get("book_title", ""),
                "content": ch.get("content", ""),
                "images": images_data,
                "has_images": ch.get("has_images", False),
                "prev_cid": prev_cid,
                "next_cid": next_cid,
                "data_source_prev_cid": ch.get("data_source_prev_cid", ""),
                "data_source_next_cid": ch.get("data_source_next_cid", ""),
                "data_source_index_url": ch.get("data_source_index_url", ""),
            }
            (chapters_dir / f"{local_cid}.json").write_text(
                json.dumps(export_json, ensure_ascii=False, indent=2), encoding="utf-8")

            # TXT
            txt_content = ch["title"] + "\n\n" + (ch.get("content") or "")
            (chapters_dir / f"{local_cid}.txt").write_text(txt_content, encoding="utf-8")

            # _images.json
            if images_data:
                (chapters_dir / f"{local_cid}_images.json").write_text(
                    json.dumps(images_data, ensure_ascii=False, indent=2), encoding="utf-8")

        print(f"[+] 已导出: {out}")
        print(f"    小说: {novel['title']} ({len(chapters)}章)")

    # ─── 事务管理 ───

    def commit(self):
        """手动提交事务"""
        self._conn.commit()

    def rollback(self):
        """回滚事务"""
        self._conn.rollback()

    def close(self):
        """关闭数据库连接"""
        if self._conn and not self._conn.closed:
            self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self.rollback()
        self.close()

    # ─── 内部方法 ───

    def _add_tags(self, cur, novel_id: int, tags: List[str]):
        """内部：插入标签"""
        for tag in tags:
            cur.execute(
                "INSERT INTO novel_tags (novel_id, tag) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (novel_id, tag),
            )

    def _insert_volumes(self, cur, novel_id: int, volumes: List[Dict]):
        """内部：插入卷"""
        for i, vol in enumerate(volumes):
            cur.execute(
                "INSERT INTO volumes (novel_id, name, sort_order) VALUES (%s, %s, %s)",
                (novel_id, vol.get("name", ""), i),
            )


# ═══════════════════════════════════════════════════════════════
# CLI 入口
# ═══════════════════════════════════════════════════════════════

def main():
    """初始化数据库 + 导出等功能"""
    import argparse

    parser = argparse.ArgumentParser(description="小说数据库管理")
    parser.add_argument("--init", action="store_true", help="初始化数据库 schema")
    parser.add_argument("--export", type=int, default=0, help="导出指定本站 aid 为 JSON 文件")
    parser.add_argument("--output-dir", "-o", default="novels", help="导出目录（默认 novels/）")
    args = parser.parse_args()

    db = NovelDB()

    try:
        if args.init:
            db.init_schema()
            print("[+] Schema 初始化完成")

        if args.export > 0:
            db.export_to_json(args.export, args.output_dir)
    finally:
        db.close()


if __name__ == "__main__":
    main()
