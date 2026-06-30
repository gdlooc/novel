"""FastAPI 服务 — 为 novel-frontend 和管理后台提供 HTTP API

启动:
  cd crawler && uvicorn server.api:app --port 8080

端点:
  # novel-frontend 接口
  GET /api/catalog                    # 全站目录
  GET /api/books                      # 已下载小说列表
  GET /api/books/{id}/metadata        # metadata.json
  GET /api/books/{id}/chapters         # chapters.json
  GET /api/books/{id}/chapters/{cid}   # 单章 JSON
  GET /api/images/{novel_id}/{cid}/{filename}  # 插图

  # 管理后台接口
  GET /api/admin/stats                # 仪表盘统计数据
  POST /api/admin/scan                # 触发元数据扫描
  POST /api/admin/download            # 触发批量下载
  GET /api/admin/tasks                # 任务状态列表
  POST /api/admin/tasks/{id}/stop     # 停止任务
"""

import asyncio
import json
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional

# 确保 crawler/ 目录在 sys.path 中
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from core.database import NovelDB

app = FastAPI(title="novel-api", description="轻小说数据库 HTTP API")

# CORS：允许 novel-frontend (Vite dev server) 跨域请求
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── 辅助函数 ───

def _get_db() -> NovelDB:
    """每次请求创建新的 DB 连接"""
    return NovelDB()


def _build_metadata(novel: dict, ds_name: str) -> dict:
    """将 DB 小说记录转为 metadata.json 格式"""
    return {
        "aid": novel["id"],
        "data_source": novel.get("data_source_id", 1),
        "data_source_name": ds_name,
        "data_source_aid": novel.get("data_source_aid", 0),
        "title": novel.get("title", ""),
        "author": novel.get("author", ""),
        "publisher": novel.get("publisher", ""),
        "status": novel.get("status", ""),
        "is_completed": novel.get("is_completed", False),
        "last_update": novel.get("last_update", ""),
        "word_count": novel.get("word_count", ""),
        "tags": novel.get("tags", []),
        "rating": novel.get("rating", ""),
        "description": novel.get("description", ""),
        "cover_url": novel.get("cover_url", ""),
        "total_chapters": novel.get("total_chapters", 0),
        "completed_chapters": novel.get("completed_chapters", 0),
        "failed_chapters": 0,
        "data_source_failed_cids": [],
        "data_source_catalog_url": novel.get("data_source_catalog_url", ""),
        "data_source_book_url": novel.get("data_source_book_url", ""),
    }


# ─── 端点 ───

@app.get("/api/books")
def list_books():
    """返回已下载的小说列表（novels 表）"""
    db = _get_db()
    try:
        ids = db.get_all_novel_ids()
        books = []
        for aid in ids:
            novel = db.get_novel(aid)
            if novel:
                books.append({
                    "aid": novel["id"],
                    "data_source_aid": novel.get("data_source_aid", 0),
                    "title": novel.get("title", ""),
                    "author": novel.get("author", ""),
                    "status": novel.get("status", ""),
                    "total_chapters": novel.get("total_chapters", 0),
                    "cover_url": novel.get("cover_url", ""),
                    "tags": novel.get("tags", []),
                })
        return books
    finally:
        db.close()


@app.get("/api/catalog")
def search_catalog(
    q: str = "",
    tags: str = "",
    status: str = "",
    rating: str = "",
    downloaded: str = "",
    offset: int = 0,
    limit: int = 20,
):
    """搜索全站小说目录（site_novels 表，4123 本）

    查询参数：
    - q: 标题搜索关键词（模糊匹配）
    - tags: 标签筛选，逗号分隔（如 "校园,恋爱"）
    - status: 状态筛选（"已完结" / "连载中"）
    - rating: 最低评级筛选（"S" / "A" / "B" / "C"，如 "A" 匹配 S 和 A 级）
    - downloaded: 下载状态筛选（"true"=仅已下载, "false"=仅未下载, 空=全部）
    - offset: 分页偏移（默认 0）
    - limit: 每页数量（默认 20，最大 100）
    """
    db = _get_db()
    try:
        # 解析参数
        query = q.strip() if q else None
        tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
        status_filter = status.strip() if status else None
        rating_filter = rating.strip() if rating else None

        dl_filter = None
        if downloaded == "true":
            dl_filter = True
        elif downloaded == "false":
            dl_filter = False

        limit = min(limit, 100)  # 防止一次请求过多

        items, total = db.search_catalog(
            query=query,
            tags=tag_list,
            status=status_filter,
            min_rating=rating_filter,
            downloaded=dl_filter,
            offset=offset,
            limit=limit,
        )

        return {
            "total": total,
            "offset": offset,
            "limit": limit,
            "items": items,
        }
    finally:
        db.close()


@app.get("/api/books/{novel_id}/metadata")
def get_metadata(novel_id: int):
    """返回 metadata.json 等价结构"""
    db = _get_db()
    try:
        novel = db.get_novel(novel_id)
        if not novel:
            raise HTTPException(status_code=404, detail=f"小说不存在: aid={novel_id}")

        ds_name = "wenku8"  # 默认
        return _build_metadata(novel, ds_name)
    finally:
        db.close()


@app.get("/api/books/{novel_id}/chapters")
def get_chapters(novel_id: int):
    """返回 chapters.json 等价结构（含分卷信息）"""
    db = _get_db()
    try:
        novel = db.get_novel(novel_id)
        if not novel:
            raise HTTPException(status_code=404, detail=f"小说不存在: aid={novel_id}")

        chapters = db.get_chapters(novel_id)

        # 读取卷信息
        volume_map = {}
        with db._conn.cursor() as cur:
            cur.execute("SELECT id, name FROM volumes WHERE novel_id = %s ORDER BY sort_order", (novel_id,))
            for row in cur.fetchall():
                volume_map[row["id"]] = row["name"]

        result = []
        for ch in chapters:
            local_cid = ch.get("sort_order", ch["id"])
            vol_name = volume_map.get(ch.get("volume_id") or 0, "")
            result.append({
                "cid": local_cid,
                "data_source_cid": ch["data_source_cid"],
                "aid": novel_id,
                "data_source_aid": novel.get("data_source_aid", 0),
                "volume": vol_name,
                "title": ch["title"],
                "data_source_chapter_url": ch.get("data_source_chapter_url", ""),
                "completed": True,
            })
        return result
    finally:
        db.close()


@app.get("/api/books/{novel_id}/chapters/{cid}")
def get_chapter(novel_id: int, cid: int):
    """返回单章 JSON 等价结构"""
    db = _get_db()
    try:
        novel = db.get_novel(novel_id)
        if not novel:
            raise HTTPException(status_code=404, detail=f"小说不存在: aid={novel_id}")

        # 通过 sort_order 查找章节
        chapters = db.get_chapters(novel_id)
        chapter = None
        for ch in chapters:
            if ch.get("sort_order") == cid:
                chapter = ch
                break

        if not chapter:
            raise HTTPException(status_code=404, detail=f"章节不存在: cid={cid}")

        # 读取完整章节（含 images）
        full = db.get_chapter(chapter["id"]) or {}
        images_data = full.pop("images", [])

        # 构建导航 ID
        src_prev = chapter.get("data_source_prev_cid", "")
        src_next = chapter.get("data_source_next_cid", "")

        # 翻译导航（源站 cid → 本地 sort_order）
        cid_lookup = {ch["data_source_cid"]: ch.get("sort_order", ch["id"]) for ch in chapters}

        prev_cid = 0
        if src_prev and src_prev != "index":
            try:
                prev_cid = cid_lookup.get(int(src_prev), 0)
            except ValueError:
                pass

        next_cid = 0
        if src_next:
            try:
                next_cid = cid_lookup.get(int(src_next), 0)
            except ValueError:
                pass

        ds_name = "wenku8"

        return {
            "cid": cid,
            "data_source_cid": chapter["data_source_cid"],
            "aid": novel_id,
            "data_source_aid": novel.get("data_source_aid", 0),
            "data_source": novel.get("data_source_id", 1),
            "data_source_name": ds_name,
            "title": chapter["title"],
            "book_title": chapter.get("book_title", ""),
            "content": chapter.get("content", ""),
            "images": images_data,
            "has_images": chapter.get("has_images", False),
            "prev_cid": prev_cid,
            "next_cid": next_cid,
            "data_source_prev_cid": src_prev,
            "data_source_next_cid": src_next,
            "data_source_index_url": chapter.get("data_source_index_url", ""),
        }
    finally:
        db.close()


# ═══════════════════════════════════════════════════════════════
# 任务管理（内存存储）
# ═══════════════════════════════════════════════════════════════

class TaskManager:
    """轻量级任务管理器

    在内存中追踪扫描/下载任务的状态，
    支持后台线程执行（CLI 脚本通过 subprocess 或直接调用）。
    """

    def __init__(self):
        self._tasks: Dict[str, dict] = {}
        self._running: Dict[str, threading.Thread] = {}
        self._subscribers: list = []  # SSE 订阅者队列列表

    def _notify(self):
        """通知所有 SSE 订阅者有状态更新

        线程安全：通过 loop.call_soon_threadsafe 推送事件到各订阅者队列。
        """
        event = json.dumps({
            "type": "tasks_updated",
            "tasks": self.list_all(),
        })
        for q in self._subscribers[:]:  # 拷贝遍历，避免并发修改
            try:
                # asyncio.Queue 的 put 需要事件循环，使用 call_soon_threadsafe
                import asyncio
                loop = asyncio.get_event_loop()
                loop.call_soon_threadsafe(q.put_nowait, event)
            except Exception:
                # 事件循环已关闭或队列已满，移除该订阅者
                if q in self._subscribers:
                    self._subscribers.remove(q)

    def subscribe(self, q) -> None:
        """注册 SSE 订阅者队列"""
        self._subscribers.append(q)

    def unsubscribe(self, q) -> None:
        """移除 SSE 订阅者队列"""
        if q in self._subscribers:
            self._subscribers.remove(q)

    def create(self, task_type: str, label: str) -> str:
        """创建新任务，返回任务 ID"""
        task_id = str(uuid.uuid4())[:8]
        self._tasks[task_id] = {
            "id": task_id,
            "type": task_type,
            "status": "pending",
            "label": label,
            "progress": 0,
            "detail": "等待启动...",
            "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        self._notify()
        return task_id

    def start(self, task_id: str, target: callable, args: tuple = ()):
        """在后台线程中启动任务"""
        if task_id not in self._tasks:
            return
        self._tasks[task_id]["status"] = "running"
        self._tasks[task_id]["detail"] = "正在运行..."
        self._notify()

        def runner():
            try:
                target(*args)
                self._tasks[task_id]["status"] = "completed"
                self._tasks[task_id]["progress"] = 100
                self._tasks[task_id]["detail"] = "完成"
                self._notify()
            except Exception as e:
                self._tasks[task_id]["status"] = "failed"
                self._tasks[task_id]["detail"] = str(e)[:200]
                self._notify()

        t = threading.Thread(target=runner, daemon=True)
        self._running[task_id] = t
        t.start()

    def stop(self, task_id: str) -> bool:
        """请求停止任务（设置标志，优雅退出）"""
        if task_id in self._tasks:
            self._tasks[task_id]["status"] = "failed"
            self._tasks[task_id]["detail"] = "用户手动停止"
            self._notify()
            return True
        return False

    def get(self, task_id: str) -> Optional[dict]:
        return self._tasks.get(task_id)

    def list_all(self) -> List[dict]:
        return sorted(
            self._tasks.values(),
            key=lambda t: t["created_at"],
            reverse=True,
        )


# 全局任务管理器实例
_task_mgr = TaskManager()


# ═══════════════════════════════════════════════════════════════
# 管理后台 API 端点
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/stats")
def get_admin_stats():
    """返回仪表盘所需的统计数据"""
    db = _get_db()
    try:
        # 全站统计
        count_info = db.get_site_novels_count()
        site_total = count_info["total"]
        downloaded = count_info["downloaded"]

        # S 级小说数量
        s_novels, s_total = db.get_site_novels(min_rating="S", limit=1)
        s_rated = s_total

        # 已下载总章节数
        total_chapters = 0
        with db._conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) as cnt FROM chapters")
            row = cur.fetchone()
            if row:
                total_chapters = row["cnt"]

        # 评分分布
        rating_dist: Dict[str, int] = {}
        with db._conn.cursor() as cur:
            cur.execute("SELECT rating, COUNT(*) as cnt FROM site_novels WHERE rating != '' GROUP BY rating ORDER BY cnt DESC")
            for row in cur.fetchall():
                rating_dist[row["rating"]] = row["cnt"]

        # 状态分布
        status_dist: Dict[str, int] = {}
        with db._conn.cursor() as cur:
            cur.execute("SELECT status, COUNT(*) as cnt FROM site_novels WHERE status != '' GROUP BY status ORDER BY cnt DESC")
            for row in cur.fetchall():
                status_dist[row["status"]] = row["cnt"]

        # 最近下载
        recent = []
        with db._conn.cursor() as cur:
            cur.execute("""
                SELECT n.id, n.title, n.author, n.total_chapters, n.status,
                       ARRAY(SELECT tag FROM novel_tags WHERE novel_id = n.id) as tags
                FROM novels n ORDER BY n.id DESC LIMIT 10
            """)
            for row in cur.fetchall():
                recent.append({
                    "aid": row["id"],
                    "title": row["title"],
                    "author": row["author"] or "",
                    "total_chapters": row["total_chapters"] or 0,
                    "status": row["status"] or "",
                    "tags": row["tags"] or [],
                })

        # 下载进度（当前运行中的下载任务）
        download_progress = None
        for t in _task_mgr.list_all():
            if t["type"] == "download" and t["status"] == "running":
                download_progress = {
                    "task_id": t["id"],
                    "target": t["label"],
                    "completed": t.get("completed", 0),
                    "total": t.get("total", 1),
                    "current_novel": t.get("current_novel", ""),
                    "eta_seconds": t.get("eta_seconds", 0),
                }
                break

        return {
            "site_total": site_total,
            "downloaded": downloaded,
            "s_rated": s_rated,
            "total_chapters": total_chapters,
            "rating_distribution": rating_dist,
            "status_distribution": status_dist,
            "recent_downloads": recent,
            "download_progress": download_progress,
        }
    finally:
        db.close()


@app.post("/api/admin/scan")
def trigger_scan(params: dict = {}):
    """触发元数据扫描任务

    请求体:
      { "top": 100, "force": false, "concurrent": 5 }
    """
    top = params.get("top")
    force = params.get("force", False)
    concurrent = params.get("concurrent", 5)

    label = f"元数据扫描"
    if top:
        label += f" (前{top}本)"
    if force:
        label = "强制" + label

    task_id = _task_mgr.create("scan", label)

    def run_scan():
        try:
            from orchestrate.scan_metadata import MetadataScanner
            scanner = MetadataScanner(concurrency=concurrent)
            scanner.run(top=top, force=force)
            _task_mgr._tasks[task_id]["progress"] = 100
        except Exception as e:
            _task_mgr._tasks[task_id]["detail"] = str(e)[:200]
            raise

    _task_mgr.start(task_id, run_scan)
    return {"ok": True, "task_id": task_id, "message": "扫描任务已启动"}


@app.post("/api/admin/download")
def trigger_download(params: dict = {}):
    """触发批量下载任务

    请求体:
      { "min_rating": "S", "status": "已完结", "top": 10, "concurrent": 3 }
    """
    min_rating = params.get("min_rating")
    status = params.get("status")
    tags = params.get("tags")
    top = params.get("top")
    concurrent = params.get("concurrent", 3)

    label = "批量下载"
    if min_rating:
        label += f" {min_rating}级以上"
    if status:
        label += f" {status}"
    if top:
        label += f" (前{top}本)"

    task_id = _task_mgr.create("download", label)

    def run_download():
        try:
            from orchestrate.batch import BatchScraper
            from fetch.auth import resolve_cookies

            cookies = resolve_cookies()
            batch = BatchScraper(
                output_dir="novels",
                cookies=cookies or {},
                concurrency=concurrent,
            )
            batch.run_from_index(
                tags=[tags] if tags else None,
                status_filter=status,
                min_rating=min_rating,
                top=top,
                resume=True,
                use_database=True,
            )
            _task_mgr._tasks[task_id]["progress"] = 100
        except Exception as e:
            _task_mgr._tasks[task_id]["detail"] = str(e)[:200]
            raise

    _task_mgr.start(task_id, run_download)
    return {"ok": True, "task_id": task_id, "message": "下载任务已启动"}


@app.post("/api/admin/download/single")
def trigger_single_download(params: dict = {}):
    """触发单本小说下载

    请求体:
      { "data_source_aid": 3057, "concurrent": 3 }
    """
    data_source_aid = params.get("data_source_aid")
    if not data_source_aid:
        raise HTTPException(status_code=400, detail="缺少 data_source_aid 参数")

    concurrent = params.get("concurrent", 3)

    # 先获取书名用于显示
    db = _get_db()
    novel_info = db.get_site_novel(data_source_aid)
    novel_title = novel_info["title"] if novel_info else f"aid={data_source_aid}"
    db.close()

    label = f"下载: {novel_title[:30]}"
    task_id = _task_mgr.create("download", label)

    def run_single():
        try:
            from orchestrate.scraper import NovelScraper, ScraperConfig
            from fetch.auth import resolve_cookies

            cookies = resolve_cookies()
            config = ScraperConfig(
                aid=data_source_aid,
                output_dir="novels",
                concurrency=concurrent,
            )
            scraper = NovelScraper(config, cookies)
            scraper.run()
            _task_mgr._tasks[task_id]["progress"] = 100
        except Exception as e:
            _task_mgr._tasks[task_id]["detail"] = str(e)[:200]
            raise

    _task_mgr.start(task_id, run_single)
    return {"ok": True, "task_id": task_id, "message": f"开始下载: {novel_title[:30]}"}


@app.get("/api/admin/logs")
def get_logs(lines: int = 200, level: str = ""):
    """返回最近的日志行（内存缓冲区）

    查询参数：
    - lines: 返回行数（默认 200）
    - level: 过滤级别（空=全部，如 ERROR/WARNING/INFO）
    """
    from core.logger import get_recent_logs, get_log_files
    return {
        "logs": get_recent_logs(min(lines, 500), level),
        "files": get_log_files(),
    }


@app.get("/api/admin/tasks")
def list_tasks():
    """返回所有任务状态"""
    return _task_mgr.list_all()


@app.get("/api/admin/events")
async def sse_events(request: Request):
    """SSE 端点 — 实时推送任务状态更新

    前端使用 EventSource 连接，自动接收任务状态变更事件。
    每 15 秒发送心跳保持连接。
    """
    async def event_generator():
        q: asyncio.Queue = asyncio.Queue()
        _task_mgr.subscribe(q)
        try:
            # 发送初始状态
            initial = json.dumps({
                "type": "tasks_updated",
                "tasks": _task_mgr.list_all(),
            })
            yield f"data: {initial}\n\n"

            while True:
                # 检查客户端是否断开
                if await request.is_disconnected():
                    break

                try:
                    # 等待事件或心跳超时
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {event}\n\n"
                except asyncio.TimeoutError:
                    # 心跳保持连接
                    yield ": heartbeat\n\n"
        finally:
            _task_mgr.unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/admin/tasks/{task_id}/stop")
def stop_task(task_id: str):
    """停止指定任务"""
    ok = _task_mgr.stop(task_id)
    if ok:
        return {"ok": True, "message": f"任务 {task_id} 已停止"}
    else:
        raise HTTPException(status_code=404, detail="任务不存在")


# ═══════════════════════════════════════════════════════════════
# 静态文件服务（生产模式下托管前端 + 插图）
# ═══════════════════════════════════════════════════════════════

# 插图静态文件
images_path = Path(__file__).parent.parent / "novels" / "images"
if images_path.exists():
    app.mount("/api/images", StaticFiles(directory=str(images_path)), name="images")

# 前端静态资源（JS/CSS/图片等）
_frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if _frontend_dist.exists():
    # 挂载 assets 目录（Vite 构建产物的 JS/CSS）
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    # SPA 回退：所有非 /api/ 的 GET 请求返回 index.html
    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """SPA 前端回退——非 API 路径返回 index.html"""
        # 忽略 API 路径
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        index_path = _frontend_dist / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        raise HTTPException(status_code=404, detail="前端未构建，请先运行 cd frontend && npm run build")

    # 根路径也返回前端
    @app.get("/")
    async def serve_root():
        index_path = _frontend_dist / "index.html"
        if index_path.exists():
            return FileResponse(str(index_path))
        return {"message": "novel-api 运行中。前端未构建，访问 /api/ 端点。"}
