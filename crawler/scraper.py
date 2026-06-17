"""小说爬取编排器

串联完整的小说爬取流程:
  book页 → 目录页 → 章节列表 → 遍历下载 → 保存

所有页面抓取均使用 Playwright 无头浏览器（绕过 Cloudflare）。

功能:
- 支持断点续爬（跳过已下载章节）
- 请求间隔控制（防止触发限流）
- 失败自动重试
- 进度实时显示
- 自动登录（支持账密或 Cookie 两种方式）

用法:
  python scraper.py --aid 1973 --username 826839099 --password ty1235556
  python scraper.py --aid 1973 --cookie "..."
  python scraper.py --aid 1973 --resume
  python scraper.py --book-url https://www.wenku8.net/book/1973.htm
"""

import argparse
import asyncio
import json
import os
import random
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

# 第三方库
import requests as http_requests  # 仅用于图片下载（CDN 无 Cloudflare 防护）

# 导入项目内模块
from auth import resolve_cookies
from fetcher import PlaywrightFetcher
from parser_catalog import parse_catalog_html
from parser_chapter import parse_chapter_html
from parser_book import parse_book_html
from database import NovelDB

# 数据源配置路径
_DATA_SOURCES_PATH = Path(__file__).parent / "data_sources.json"


def _load_data_source_name(source_id: int) -> str:
    """从 data_sources.json 读取数据源英文名"""
    try:
        sources = json.loads(_DATA_SOURCES_PATH.read_text(encoding="utf-8"))
        for s in sources:
            if s.get("id") == source_id:
                return s.get("name", "unknown")
    except Exception:
        pass
    return "unknown"


def _assign_local_aid(output_dir: Path) -> int:
    """扫描现有目录，分配下一个可用的本地小说 ID

    遍历 output_dir 下所有 aid_N 目录的 metadata.json，
    取最大本地 aid + 1。若无现有数据，返回 1。
    """
    max_aid = 0
    if output_dir.exists():
        for d in output_dir.iterdir():
            if d.is_dir() and d.name.startswith("aid_"):
                meta_file = d / "metadata.json"
                if meta_file.exists():
                    try:
                        meta = json.loads(meta_file.read_text(encoding="utf-8"))
                        local_aid = meta.get("aid", 0)
                        if local_aid > max_aid:
                            max_aid = local_aid
                    except Exception:
                        pass
    return max_aid + 1


# ==================== 爬取配置 ====================

class ScraperConfig:
    """爬取配置（所有页面均使用 Playwright 抓取）"""

    def __init__(
        self,
        aid: int,
        output_dir: str = "novels",
        delay_seconds: float = 2.0,
        max_retries: int = 3,
        timeout: int = 60,
        concurrency: int = 3,
        data_source_id: int = 1,
        local_aid: int = 0,
    ):
        """
        Args:
            aid: 数据来源站的小说 ID
            output_dir: 输出根目录
            delay_seconds: 章节间请求间隔（秒），并发模式下为任务启动前的随机延迟上限
            max_retries: 每个章节下载失败后的最大重试次数
            timeout: 每个请求超时秒数
            concurrency: 并发下载数（1=串行，>1=并发），默认3
            data_source_id: 数据来源站 ID（对应 data_sources.json），默认1=wenku8
            local_aid: 本站小说 ID（0=自动分配）
        """
        self.source_aid = aid          # 数据来源站的小说 ID
        self.group = aid // 1000       # URL 分组参数
        self.output_dir = Path(output_dir)
        self.delay_seconds = delay_seconds
        self.max_retries = max_retries
        self.timeout = timeout
        self.concurrency = max(1, concurrency)
        self.data_source_id = data_source_id
        self._local_aid = local_aid   # 0=待分配

    @property
    def base_url(self) -> str:
        """网站基础 URL"""
        return "https://www.wenku8.net"

    @property
    def catalog_url(self) -> str:
        """数据来源站目录页完整 URL"""
        return f"{self.base_url}/novel/{self.group}/{self.source_aid}/index.htm"

    @property
    def book_url(self) -> str:
        """数据来源站书页 URL"""
        return f"{self.base_url}/book/{self.source_aid}.htm"

    @property
    def local_aid(self) -> int:
        """本站小说 ID（自动分配或手动指定）"""
        if self._local_aid <= 0:
            self._local_aid = _assign_local_aid(self.output_dir)
        return self._local_aid

    @local_aid.setter
    def local_aid(self, value: int):
        self._local_aid = value

    @property
    def novel_dir(self) -> Path:
        """本小说输出目录（以本站 ID 命名）"""
        return self.output_dir / f"aid_{self.local_aid}"

    @property
    def checkpoint_file(self) -> Path:
        """断点文件路径（内部跟踪源站 cid）"""
        return self.novel_dir / ".checkpoint.json"


# ==================== 爬取编排器 ====================

class NovelScraper:
    """小说爬取编排器

    职责:
    1. 下载并解析目录页，获取章节列表
    2. 逐个下载章节正文
    3. 保存元数据 + 章节数据
    4. 维护断点文件，支持续爬
    """

    def __init__(
        self,
        config: ScraperConfig,
        cookies: Optional[Dict[str, str]] = None,
    ):
        """
        Args:
            config: 爬取配置
            cookies: 登录 cookie 字典
        """
        self.config = config
        self.cookies = cookies or {}

        # 数据库
        self._db = NovelDB()

        # ID 映射：源站 cid → 本站 cid（按下载顺序从1递增）
        self._cid_map: Dict[int, int] = {}
        self._next_local_cid: int = 1
        self._novel_id: int = 0  # DB 返回的本站 aid

        # 状态追踪
        self._completed_cids: set = set()    # 源站 cid
        self._failed_cids: List[int] = []    # 源站 cid
        self._catalog_data: Dict = {}
        self._book_data: Dict = {}
        self._novel_title: str = ""

        # 加载断点
        self._load_checkpoint()

    # ---------- 公共方法：主流程 ----------

    def run(self):
        """执行完整爬取流程

        流程:
        1. 下载书页 → 解析元数据
        2. 下载目录页 → 解析章节列表
        3. 遍历剩余章节 → 下载并解析
        4. 保存到数据库
        5. 导出 JSON（兼容 canvas-reader）
        """
        source_aid = self.config.source_aid

        # 检测是否已在数据库中
        existing = self._db.get_novel_by_source(self.config.data_source_id, source_aid)
        if existing:
            self._novel_id = existing["id"]
            self._load_checkpoint()
            print(f"[*] 数据库已有记录: id={self._novel_id}")

        print(f"{'='*60}")
        print(f"  小说爬取器 - 源站 aid={source_aid}")
        if self._novel_id:
            print(f"  本站 aid: {self._novel_id}")
        print(f"{'='*60}")
        print(f"  数据来源: {_load_data_source_name(self.config.data_source_id)}")
        print(f"  目录 URL: {self.config.catalog_url}")
        print()

        # ---------- 步骤1: 获取小说元数据（书页） ----------
        print("[1/4] 获取小说基本信息...")
        book_html = self._fetch_page(self.config.book_url)
        if book_html:
            self._book_data = parse_book_html(book_html, self.config.book_url)
            self._novel_title = self._book_data.get("title", f"aid_{source_aid}")
            print(f"  书名: {self._novel_title}")
            print(f"  作者: {self._book_data.get('author', '?')}")
            print(f"  标签: {', '.join(self._book_data.get('tags', []))}")
            print(f"  状态: {self._book_data.get('status', '?')}")
            print(f"  字数: {self._book_data.get('word_count', '?')}")
        else:
            self._book_data = {}
            print("  [!] 书页获取失败，将使用目录页信息")
        print()

        # ---------- 步骤2: 获取章节列表 ----------
        print("[2/4] 获取目录页...")
        catalog_html = self._fetch_page(self.config.catalog_url)
        if not catalog_html:
            print("[X] 无法获取目录页，终止")
            return False

        self._catalog_data = parse_catalog_html(
            catalog_html, self.config.catalog_url
        )
        if not self._novel_title:
            self._novel_title = self._catalog_data.get("title", f"aid_{source_aid}")

        all_chapters = self._flatten_chapters(self._catalog_data)
        print(f"  总章节: {len(all_chapters)}")

        pending = [
            ch for ch in all_chapters
            if ch["cid"] not in self._completed_cids
        ]

        if not pending:
            print("  所有章节已完成，无需下载")
            self._save_novel_record(all_chapters)
            self._print_summary(all_chapters)
            return True

        print(f"  待下载: {len(pending)} 章 (已完成 {len(self._completed_cids)} 章)")
        print()

        # ── 确保 novel 记录存在（下载章节前需要 novel_id 外键）──
        if not self._novel_id:
            self._novel_id = self._ensure_novel_record()

        # ---------- 步骤3: 下载章节 ----------
        print("[3/5] 下载章节...")
        if self.config.concurrency > 1:
            # 并发模式：共享浏览器 + Semaphore 控制并发数
            asyncio.run(self._download_chapters_async(pending))
        else:
            # 串行模式：保持原有逻辑
            self._download_chapters(pending)

        # ---------- 步骤4: 保存 ----------
        print()
        print("[4/5] 更新元数据...")
        self._save_novel_record(all_chapters)

        # ── 翻译导航 ID（由导出时自动完成）──

        # ---------- 步骤5: 导出 JSON（兼容 canvas-reader）----------
        print()
        print("[5/5] 导出 JSON 文件...")
        try:
            self._db.export_to_json(self._novel_id, str(self.config.output_dir))
        except Exception as e:
            print(f"  [!] 导出失败: {e}")

        self._cleanup_temp_files()
        self._print_summary(all_chapters)
        return True

    def _cleanup_temp_files(self):
        """清理旧的临时文件目录"""
        # 保留图片目录，只清理可能的旧格式残留
        pass

    # ---------- 私有方法：获取页面 ----------

    def _fetch_page(self, url: str, retries: int = None) -> Optional[str]:
        """使用 Playwright 下载页面 HTML，支持重试

        Args:
            url: 页面 URL
            retries: 剩余重试次数

        Returns:
            页面 HTML 字符串，失败返回 None
        """
        if retries is None:
            retries = self.config.max_retries

        for attempt in range(retries + 1):
            try:
                fetcher = PlaywrightFetcher(
                    cookies=self.cookies,
                    timeout=self.config.timeout,
                )
                result = asyncio.run(fetcher.fetch(url))
                if result.status_code == 200:
                    return result.html
                elif result.status_code == 403:
                    # Cloudflare 拦截
                    print(f"\n  [!] 被 Cloudflare 拦截 (403): {url[-60:]}")
                    if attempt < retries:
                        wait = 2 ** attempt
                        print(f"  [!] 重试 ({attempt+1}/{retries})，{wait}s后...")
                        time.sleep(wait)
                    continue
                else:
                    # 其他 HTTP 错误
                    if attempt < retries:
                        wait = 2 ** attempt
                        time.sleep(wait)
                    continue
            except Exception as e:
                if attempt < retries:
                    wait = 2 ** attempt
                    print(f"\n  [!] 重试 ({attempt+1}/{retries})，{wait}s后: {url[-60:]}")
                    time.sleep(wait)
                else:
                    print(f"\n  [X] 下载失败: {url[-60:]} - {e}")
                    return None
        return None

    # ---------- 私有方法：异步页面获取（共享浏览器） ----------

    async def _fetch_page_async(
        self,
        browser,
        url: str,
        retries: int = None,
    ) -> Optional[str]:
        """在共享浏览器中创建独立 context 获取页面 HTML。

        串行模式中每章启动新浏览器，并发模式改为共享一个浏览器实例，
        每章创建独立的 browser context（等价于新标签页），共享 cookie。

        Args:
            browser: Playwright 浏览器实例（由 _download_chapters_async 创建）
            url: 目标页面 URL
            retries: 剩余重试次数（默认取自 config.max_retries）

        Returns:
            页面 HTML 字符串，失败返回 None
        """
        if retries is None:
            retries = self.config.max_retries

        for attempt in range(retries + 1):
            context = None
            try:
                # 创建独立 context — 每个 context 相当于一个隐身窗口
                context = await browser.new_context(
                    viewport={"width": 1366, "height": 768},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    locale="zh-CN",
                )

                # 注入 cookies（URL 对应的域名）
                if self.cookies:
                    from urllib.parse import urlparse
                    domain = urlparse(url).netloc
                    pw_cookies = [
                        {"name": k, "value": v, "domain": domain, "path": "/"}
                        for k, v in self.cookies.items()
                    ]
                    await context.add_cookies(pw_cookies)

                page = await context.new_page()

                # 尝试 stealth 伪装
                try:
                    from playwright_stealth import Stealth
                    await Stealth().apply_stealth_async(page)
                except Exception:
                    pass

                response = await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=self.config.timeout * 1000,
                )
                await page.wait_for_timeout(2000)

                html = await page.content()
                status_code = response.status if response else 0

                if status_code == 200:
                    return html
                elif status_code == 403:
                    # Cloudflare 拦截
                    if attempt < retries:
                        wait = 2 ** attempt
                        await asyncio.sleep(wait)
                    continue
                else:
                    if attempt < retries:
                        wait = 2 ** attempt
                        await asyncio.sleep(wait)
                    continue
            except Exception:
                if attempt < retries:
                    wait = 2 ** attempt
                    await asyncio.sleep(wait)
                else:
                    return None
            finally:
                if context:
                    await context.close()

        return None

    # ---------- 私有方法：并发章节下载 ----------

    async def _download_chapters_async(self, chapters: List[Dict]):
        """并发下载章节（共享浏览器实例 + Semaphore 控制并发数）。

        核心设计:
        - 启动一个共享 Chromium 实例，避免每章启动/关闭浏览器的开销
        - asyncio.Semaphore 限制同时进行的请求数（默认 3）
        - 每个任务拿到槽位后先随机 sleep，再发请求，形成自然交错
        - asyncio.Lock 保护断点文件写入，防止竞态

        Args:
            chapters: 待下载的章节列表
        """
        concurrency = self.config.concurrency
        semaphore = asyncio.Semaphore(concurrency)
        checkpoint_lock = asyncio.Lock()
        total = len(chapters)
        start_time = time.time()

        # 进度计数器
        done_count = 0
        done_lock = asyncio.Lock()

        print(f"  [*] 并发模式: {concurrency} 个 worker")
        print()

        async def download_one(ch, _index: int):
            """单个章节的完整下载流程"""
            nonlocal done_count

            source_cid = ch["cid"]
            title = ch["title"]

            # ── 等待槽位 ──
            async with semaphore:
                # ── 分配本站 cid（需要锁，防止并发竞态）──
                async with checkpoint_lock:
                    local_cid = self._next_local_cid
                    self._cid_map[source_cid] = local_cid
                    self._next_local_cid += 1

                # ── 任务启动前随机延迟 ──
                pre_delay = random.uniform(0.5, self.config.delay_seconds + 0.5)
                await asyncio.sleep(pre_delay)

                # 获取章节页 HTML
                html = await self._fetch_page_async(browser, ch["url"])
                if not html:
                    async with checkpoint_lock:
                        self._failed_cids.append(source_cid)
                    async with done_lock:
                        done_count += 1
                    elapsed = time.time() - start_time
                    print(
                        f"  [{done_count}/{total}] scid={source_cid}  "
                        f"{title[:30]}  "
                        f"[失败]"
                    )
                    return

                # 解析章节正文
                chapter_data = parse_chapter_html(html, ch["url"])
                content = chapter_data.get("content", "")
                has_images = chapter_data.get("has_images", False)

                if not content and not has_images:
                    async with checkpoint_lock:
                        self._failed_cids.append(source_cid)
                    async with done_lock:
                        done_count += 1
                    elapsed = time.time() - start_time
                    print(
                        f"  [{done_count}/{total}] scid={source_cid}  "
                        f"{title[:30]}  "
                        f"[空内容]"
                    )
                    return

                # 下载插图（传入章节 URL 作为 Referer）
                images_info = []
                if has_images:
                    images_info = self._download_images(chapter_data, source_cid, ch["url"])
                    chapter_data["images"] = images_info

                # 保存章节到磁盘（独立操作，无需锁）
                self._save_chapter(source_cid, chapter_data, images_info)

                # 更新断点（需要锁，防止并发写入冲突）
                async with checkpoint_lock:
                    self._completed_cids.add(source_cid)
                    self._save_checkpoint()

                # 进度输出
                async with done_lock:
                    done_count += 1
                    current_done = done_count

                elapsed = time.time() - start_time
                eta = (elapsed / current_done) * (total - current_done) if current_done > 0 else 0

                img_str = ""
                if images_info:
                    downloaded = sum(1 for x in images_info if x["downloaded"])
                    img_str = f" {downloaded}/{len(images_info)}图 "
                print(
                    f"  [{current_done}/{total}] scid={source_cid} lcid={local_cid}  "
                    f"{title[:30]}  "
                    f"({self._format_time(elapsed)}/{self._format_time(eta)})"
                    f"  [{img_str}{len(content)}字]"
                )

        # ── 启动共享浏览器 ──
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            print("  [X] 未安装 playwright，无法使用并发下载")
            return

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )

            # 并发执行所有任务
            tasks = [download_one(ch, i) for i, ch in enumerate(chapters)]
            await asyncio.gather(*tasks, return_exceptions=True)

        # 并发完成后的进度刷新
        print()

    # ---------- 私有方法：串行章节下载 ----------

    def _download_chapters(self, chapters: List[Dict]):
        """逐个下载章节，带进度显示和断点保存

        Args:
            chapters: 待下载的章节列表
        """
        total = len(chapters)
        start_time = time.time()

        for i, ch in enumerate(chapters, 1):
            source_cid = ch["cid"]
            title = ch["title"]

            # 分配本站 cid（按下载顺序递增）
            local_cid = self._next_local_cid
            self._cid_map[source_cid] = local_cid
            self._next_local_cid += 1

            # 进度显示
            elapsed = time.time() - start_time
            eta = (elapsed / i) * (total - i) if i > 0 else 0
            print(
                f"  [{i}/{total}] scid={source_cid} lcid={local_cid}  "
                f"{title[:30]}  "
                f"({self._format_time(elapsed)}/{self._format_time(eta)})",
                end="",
            )

            # 下载章节页
            html = self._fetch_page(ch["url"])
            if not html:
                self._failed_cids.append(source_cid)
                print("  [失败]")
                continue

            # 解析章节
            chapter_data = parse_chapter_html(html, ch["url"])
            content = chapter_data.get("content", "")
            has_images = chapter_data.get("has_images", False)

            if not content and not has_images:
                self._failed_cids.append(source_cid)
                print("  [空内容]")
                continue

            # 下载插图（传入章节 URL 作为 Referer 防盗链）
            images_info = []
            if has_images:
                images_info = self._download_images(chapter_data, source_cid, ch["url"])
                chapter_data["images"] = images_info

            # 保存章节（传入源站 cid，内部使用本站 cid）
            self._save_chapter(source_cid, chapter_data, images_info)
            self._completed_cids.add(source_cid)
            self._save_checkpoint()

            # 请求间隔（加随机抖动）
            if i < total:
                wait = self.config.delay_seconds
                wait += random.uniform(-0.5, 0.5)
                wait = max(0.5, wait)
                time.sleep(wait)

            # 进度详情
            img_str = ""
            if images_info:
                downloaded = sum(1 for x in images_info if x["downloaded"])
                img_str = f" {downloaded}/{len(images_info)}图 "
            print(f"  [{img_str}{len(content)}字]")

    # ---------- 私有方法：图片下载 ----------

    def _download_images(self, chapter_data: Dict, source_cid: int, chapter_url: str = "") -> List[Dict]:
        """下载章节插图到本地

        图片 CDN (pic.777743.xyz) 有防盗链保护，需要携带 Referer 和浏览器 UA。
        先用轻量的 requests 尝试（带 headers），失败则回退到 Playwright 浏览器下载。

        Args:
            chapter_data: 章节解析结果（含 images 字段）
            source_cid: 源站章节 ID（用于映射到本站 cid 目录）
            chapter_url: 章节页面 URL，用作 Referer 防盗链

        Returns:
            [{"url": "...", "filename": "...", "local_path": "...", "downloaded": bool}, ...]
        """
        images = chapter_data.get("images", [])
        if not images:
            return []

        # 图片目录：novels/images/{novel_id}/{local_cid}/
        local_cid = self._cid_map.get(source_cid, source_cid)
        images_dir = self.config.output_dir / "images" / str(self._novel_id) / str(local_cid)
        images_dir.mkdir(parents=True, exist_ok=True)

        # 浏览器伪装头（模拟从章节页点击查看图片）
        _REQUEST_HEADERS = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }
        if chapter_url:
            _REQUEST_HEADERS["Referer"] = chapter_url
            # 某些 CDN 还会检查 Origin
            _REQUEST_HEADERS["Origin"] = "https://www.wenku8.net"

        results = []
        for idx, img in enumerate(images, 1):
            url = img["url"]
            # 新命名规则：1.jpg, 2.jpg, 3.jpg...（保留源站扩展名）
            ext = img.get("filename", ".jpg").rsplit(".", 1)[-1] if "." in img.get("filename", "") else "jpg"
            new_filename = f"{idx}.{ext}"
            local_path = images_dir / new_filename
            result = {
                "url": url,
                "filename": new_filename,
                "local_path": str(local_path),
                "downloaded": False,
            }

            # 跳过已下载
            if local_path.exists():
                result["downloaded"] = True
                results.append(result)
                continue

            # ── 策略1: requests + 完整浏览器头（轻量快速）──
            try:
                resp = http_requests.get(
                    url,
                    headers=_REQUEST_HEADERS,
                    timeout=self.config.timeout,
                )
                if resp.status_code == 200:
                    local_path.write_bytes(resp.content)
                    result["downloaded"] = True
                    results.append(result)
                    continue
                elif resp.status_code == 403:
                    # 防盗链拒绝 → 静默打印提示，继续尝试 Playwright
                    pass
                else:
                    print(f"\n  [!] 图片 {filename} HTTP {resp.status_code}")
                    results.append(result)
                    continue
            except Exception as e:
                print(f"\n  [!] 图片 {filename} requests 下载失败: {e}")
                results.append(result)
                continue

            # ── 策略2: requests 失败 → Playwright 浏览器下载（绕过严格防盗链）──
            try:
                import asyncio
                loop = asyncio.new_event_loop()
                img_bytes = loop.run_until_complete(
                    self._fetch_image_via_playwright(url, chapter_url)
                )
                loop.close()
                if img_bytes:
                    local_path.write_bytes(img_bytes)
                    result["downloaded"] = True
                else:
                    print(f"\n  [!] 图片 {filename} Playwright 也下载失败")
            except Exception as e:
                print(f"\n  [!] 图片 {filename} Playwright 下载异常: {e}")

            results.append(result)

        return results

    async def _fetch_image_via_playwright(self, image_url: str, referer: str = ""):
        """使用 Playwright 浏览器下载单张图片（绕过严格防盗链）

        图片 CDN 可能要求完整的浏览器环境（TLS 指纹、HTTP/2 等），
        requests 库即使带了 Referer 也可能被拒。Playwright 提供真实浏览器上下文。

        Args:
            image_url: 图片 URL
            referer: 来源页面 URL

        Returns:
            图片字节数据，或 None
        """
        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as pw:
                browser = await pw.chromium.launch(
                    headless=True,
                    args=[
                        "--disable-blink-features=AutomationControlled",
                        "--no-sandbox",
                    ],
                )
                context = await browser.new_context(
                    viewport={"width": 1366, "height": 768},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    locale="zh-CN",
                )
                page = await context.new_page()

                # 先访问来源页建立 Referer 链
                if referer:
                    try:
                        await page.goto(referer, wait_until="domcontentloaded", timeout=15000)
                        await page.wait_for_timeout(500)
                    except Exception:
                        pass  # 即使来源页访问失败也继续尝试图片下载

                # 用 page.evaluate 发起 fetch 请求下载图片字节
                img_bytes = await page.evaluate("""
                    async (url) => {
                        const resp = await fetch(url, {referrer: document.location.href});
                        if (!resp.ok) return null;
                        const blob = await resp.blob();
                        const buf = await blob.arrayBuffer();
                        return Array.from(new Uint8Array(buf));
                    }
                """, image_url)

                await browser.close()

                if img_bytes:
                    return bytes(img_bytes)
                return None
        except Exception:
            return None

    # ---------- 私有方法：保存 ----------

    def _save_chapter(self, source_cid: int, chapter_data: Dict, images_info: List[Dict] = None):
        """保存单章到数据库"""
        local_cid = self._cid_map.get(source_cid, source_cid)
        source_aid = self.config.source_aid
        content = chapter_data.get("content", "")

        data = {
            "novel_id": self._novel_id,
            "data_source_cid": source_cid,
            "volume_id": None,
            "title": chapter_data.get("title", ""),
            "content": content,
            "book_title": chapter_data.get("book_title", ""),
            "has_images": chapter_data.get("has_images", False),
            "data_source_prev_cid": chapter_data.get("prev_cid", ""),
            "data_source_next_cid": chapter_data.get("next_cid", ""),
            "data_source_index_url": chapter_data.get("index_url", ""),
            "data_source_chapter_url": "",
            "sort_order": local_cid,
            "char_count": len(content),
        }
        chapter_id = self._db.insert_chapter(data)

        # cid_map 使用 sort_order（= local_cid，从1递增），而非 DB 自增 id
        self._cid_map[source_cid] = local_cid

        # 插图元数据存入 DB
        if images_info:
            self._db.insert_images(chapter_id, images_info)

    def _ensure_novel_record(self) -> int:
        """确保 novels 表中有记录（章节下载前需要外键），返回 novel_id"""
        meta = {
            "data_source_id": self.config.data_source_id,
            "data_source_aid": self.config.source_aid,
            "title": self._novel_title,
            "author": self._book_data.get("author") or "",
            "publisher": self._book_data.get("publisher", ""),
            "status": self._book_data.get("status", ""),
            "is_completed": self._book_data.get("is_completed", False),
            "last_update": self._book_data.get("last_update", ""),
            "word_count": self._book_data.get("word_count", ""),
            "tags": self._book_data.get("tags", []),
            "rating": self._book_data.get("rating", ""),
            "description": self._book_data.get("description", ""),
            "cover_url": self._book_data.get("cover_url", ""),
            "total_chapters": 0,
            "completed_chapters": 0,
            "data_source_catalog_url": self.config.catalog_url,
            "data_source_book_url": self.config.book_url,
        }
        return self._db.insert_novel(meta)

    def _save_novel_record(self, all_chapters: List[Dict]):
        """保存小说元数据到数据库"""
        ds_id = self.config.data_source_id
        source_aid = self.config.source_aid

        meta = {
            "data_source_id": ds_id,
            "data_source_aid": source_aid,
            "title": self._novel_title,
            "author": self._book_data.get("author") or self._catalog_data.get("author", ""),
            "publisher": self._book_data.get("publisher", ""),
            "status": self._book_data.get("status", ""),
            "is_completed": self._book_data.get("is_completed", False),
            "last_update": self._book_data.get("last_update", ""),
            "word_count": self._book_data.get("word_count", ""),
            "tags": self._book_data.get("tags", []),
            "rating": self._book_data.get("rating", ""),
            "description": self._book_data.get("description", ""),
            "cover_url": self._book_data.get("cover_url", ""),
            "total_chapters": len(all_chapters),
            "completed_chapters": len(self._completed_cids),
            "data_source_catalog_url": self.config.catalog_url,
            "data_source_book_url": self.config.book_url,
        }

        if self._novel_id > 0:
            # 更新已有小说
            self._db.update_novel(self._novel_id, meta)
        else:
            # 插入新小说
            self._novel_id = self._db.insert_novel(meta)
            print(f"  [DB] 新小说: id={self._novel_id}")

        # 翻译章节导航 ID
        self._translate_navigation_ids()

    def _translate_navigation_ids(self):
        """将数据库中的源站 prev/next cid 翻译为本站 cid"""
        if self._novel_id > 0 and self._cid_map:
            try:
                self._db.translate_navigation_ids(self._novel_id, self._cid_map)
            except Exception:
                pass

    # ---------- 私有方法：断点 ----------

    def _load_checkpoint(self):
        """从数据库恢复已完成的章节列表"""
        if self._novel_id > 0:
            try:
                completed, failed = self._db.get_crawl_progress(self._novel_id)
                self._completed_cids = completed
                self._failed_cids = failed
                if completed or failed:
                    print(f"[*] 从断点恢复: {len(completed)} 章已完成, {len(failed)} 章失败")
            except Exception:
                self._completed_cids = set()
                self._failed_cids = []

    def _save_checkpoint(self):
        """保存断点到数据库"""
        if self._novel_id > 0:
            try:
                self._db.update_crawl_progress(
                    self._novel_id, self._completed_cids, self._failed_cids,
                )
            except Exception:
                pass

    # ---------- 工具方法 ----------

    @staticmethod
    def _flatten_chapters(catalog: Dict) -> List[Dict]:
        """将分卷的章节列表展平为一维列表"""
        all_chapters = []
        for vol in catalog.get("volumes", []):
            vol_name = vol.get("name", "")
            for ch in vol.get("chapters", []):
                ch["volume"] = vol_name
                all_chapters.append(ch)
        return all_chapters

    @staticmethod
    def _format_time(seconds: float) -> str:
        """格式化时间显示"""
        if seconds < 60:
            return f"{seconds:.0f}s"
        elif seconds < 3600:
            return f"{seconds/60:.1f}m"
        else:
            return f"{seconds/3600:.1f}h"

    def _print_summary(self, all_chapters: List[Dict]):
        """打印爬取摘要"""
        print()
        print(f"{'='*60}")
        print(f"  完成!")
        print(f"  本站 aid: {self._novel_id}")
        print(f"  书名: {self._novel_title}")
        print(f"  总章节: {len(all_chapters)}")
        print(f"  已完成: {len(self._completed_cids)}")
        if self._failed_cids:
            print(f"  失败(源站cid): {self._failed_cids}")
        print(f"  DB: novels 数据库")
        print(f"  导出: {self.config.output_dir / f'aid_{self._novel_id}'}")
        print(f"{'='*60}")


# ==================== CLI 入口 ====================

def main():
    parser = argparse.ArgumentParser(
        description="小说爬取器 - 自动下载整本小说",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scraper.py --aid 1973 --username 826839099 --password ty1235556
  python scraper.py --aid 1973 --cookie "key=value"
  python scraper.py --aid 1973 --resume
  python scraper.py --book-url https://www.wenku8.net/book/1973.htm
  python scraper.py --update novels/aid_3057                      # 增量更新
  python scraper.py --update novels/aid_3057 --concurrent 3        # 增量+并发
        """,
    )
    # 目标参数
    parser.add_argument("--aid", type=int, default=0, help="小说 ID")
    parser.add_argument("--book-url", default="", help="小说书页 URL（自动提取 aid）")
    # 认证参数
    auth_group = parser.add_argument_group("认证方式")
    auth_group.add_argument("--username", "-u", default="", help="用户名")
    auth_group.add_argument("--password", "-p", default="", help="密码")
    auth_group.add_argument("--cookie", "-c", default="", help="Cookie 字符串（可选，优先使用）")
    # 爬取选项
    parser.add_argument("--output-dir", "-o", default="novels", help="输出目录")
    parser.add_argument("--delay", "-d", type=float, default=2.0, help="章节间延时秒数")
    parser.add_argument("--retries", "-r", type=int, default=3, help="失败重试次数")
    parser.add_argument("--timeout", "-t", type=int, default=60, help="请求超时秒数")
    parser.add_argument("--resume", action="store_true", help="断点续爬")
    parser.add_argument("--concurrent", "-j", type=int, default=3,
                        help="并发下载数（默认3，设为1则串行）")
    parser.add_argument("--update", default="",
                        help="增量更新已有小说目录，如 --update novels/aid_3057")

    args = parser.parse_args()

    # ═══ 增量更新模式：从已有目录恢复参数 ═══
    update_dir = None
    if args.update:
        update_dir = Path(args.update)
        if not update_dir.exists():
            print(f"[X] 目录不存在: {args.update}")
            sys.exit(1)

        meta_file = update_dir / "metadata.json"
        if not meta_file.exists():
            print(f"[X] 目录中缺少 metadata.json: {args.update}")
            print("[!] 提示: --update 需要完整的爬取输出目录")
            sys.exit(1)

        meta = json.loads(meta_file.read_text(encoding="utf-8"))
        # 兼容新旧格式：新格式用 data_source_aid，旧格式用 aid
        source_aid = int(meta.get("data_source_aid", 0) or meta.get("aid", 0))
        local_aid = int(meta.get("aid", 0))
        if not source_aid:
            print(f"[X] metadata.json 中缺少 data_source_aid 字段")
            sys.exit(1)

        title = meta.get("title", f"aid_{source_aid}")
        print(f"[*] 增量更新模式")
        print(f"    目录: {update_dir}")
        print(f"    书名: {title}")
        print(f"    源站 aid: {source_aid}  本站 aid: {local_aid}")

        # 自动让 output_dir 指向 update_dir 的父目录
        if not args.output_dir or args.output_dir == parser.get_default("output_dir"):
            args.output_dir = str(update_dir.parent)
        args.resume = True  # 强制续爬模式
        saved_local_aid = local_aid
        aid = source_aid
    else:
        saved_local_aid = 0
        aid = args.aid

    # --- 确定 aid ---
    if not aid and args.book_url:
        m = re.search(r"/book/(\d+)\.htm", args.book_url)
        if m:
            aid = int(m.group(1))
    if not aid:
        parser.print_help()
        print("\n[!] 请提供 --aid、--book-url 或 --update")
        sys.exit(1)

    # --- 认证：获取 cookies（update 模式优先用缓存） ---
    cookies = resolve_cookies(
        username=args.username,
        password=args.password,
        cookie_string=args.cookie,
    )
    if cookies:
        print(f"[*] 已获取 {len(cookies)} 个 cookie")
    else:
        print("[!] 警告: 未获取到登录凭证，部分页面可能无法访问")
        cookies = {}

    # --- 配置 ---
    config = ScraperConfig(
        aid=aid,
        output_dir=args.output_dir,
        delay_seconds=args.delay,
        max_retries=args.retries,
        timeout=args.timeout,
        concurrency=args.concurrent,
        local_aid=saved_local_aid,
    )

    # --- 如果不是续爬，清除旧的断点 ---
    if not args.resume:
        cp = config.checkpoint_file
        if cp.exists():
            cp.unlink()
            print("[*] 已清除旧断点，从头开始")

    # --- 执行 ---
    scraper = NovelScraper(config, cookies)
    success = scraper.run()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
