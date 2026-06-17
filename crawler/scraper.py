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
    ):
        """
        Args:
            aid: 小说 ID
            output_dir: 输出根目录
            delay_seconds: 章节间请求间隔（秒）
            max_retries: 每个章节下载失败后的最大重试次数
            timeout: 每个请求超时秒数
        """
        self.aid = aid
        self.group = aid // 1000
        self.output_dir = Path(output_dir)
        self.delay_seconds = delay_seconds
        self.max_retries = max_retries
        self.timeout = timeout

    @property
    def base_url(self) -> str:
        """网站基础 URL"""
        return "https://www.wenku8.net"

    @property
    def catalog_url(self) -> str:
        """目录页完整 URL"""
        return f"{self.base_url}/novel/{self.group}/{self.aid}/index.htm"

    @property
    def book_url(self) -> str:
        """小说书页 URL"""
        return f"{self.base_url}/book/{self.aid}.htm"

    @property
    def novel_dir(self) -> Path:
        """本小说输出目录"""
        return self.output_dir / f"aid_{self.aid}"

    @property
    def checkpoint_file(self) -> Path:
        """断点文件路径"""
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

        # 创建输出目录
        self.config.novel_dir.mkdir(parents=True, exist_ok=True)

        # 状态追踪
        self._completed_cids: set = set()
        self._failed_cids: List[int] = []
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
        4. 保存元数据
        """
        print(f"{'='*60}")
        print(f"  小说爬取器 - aid={self.config.aid}")
        print(f"{'='*60}")
        print(f"  目录 URL: {self.config.catalog_url}")
        print(f"  输出目录: {self.config.novel_dir}")
        print()

        # ---------- 步骤1: 获取小说元数据（书页） ----------
        print("[1/4] 获取小说基本信息...")
        book_html = self._fetch_page(self.config.book_url)
        if book_html:
            self._book_data = parse_book_html(book_html, self.config.book_url)
            self._novel_title = self._book_data.get("title", f"aid_{self.config.aid}")
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
            self._novel_title = self._catalog_data.get("title", f"aid_{self.config.aid}")

        all_chapters = self._flatten_chapters(self._catalog_data)
        print(f"  总章节: {len(all_chapters)}")

        pending = [
            ch for ch in all_chapters
            if ch["cid"] not in self._completed_cids
        ]

        if not pending:
            print("  所有章节已完成，无需下载")
            self._save_metadata(all_chapters)
            self._print_summary(all_chapters)
            return True

        print(f"  待下载: {len(pending)} 章 (已完成 {len(self._completed_cids)} 章)")
        print()

        # ---------- 步骤3: 下载章节 ----------
        print("[3/4] 下载章节...")
        self._download_chapters(pending)

        # ---------- 步骤4: 保存 ----------
        print()
        print("[4/4] 保存元数据...")
        self._save_metadata(all_chapters)

        self._print_summary(all_chapters)
        return True

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

    # ---------- 私有方法：章节下载 ----------

    def _download_chapters(self, chapters: List[Dict]):
        """逐个下载章节，带进度显示和断点保存

        Args:
            chapters: 待下载的章节列表
        """
        total = len(chapters)
        start_time = time.time()

        for i, ch in enumerate(chapters, 1):
            cid = ch["cid"]
            title = ch["title"]

            # 进度显示
            elapsed = time.time() - start_time
            eta = (elapsed / i) * (total - i) if i > 0 else 0
            print(
                f"  [{i}/{total}] cid={cid}  "
                f"{title[:30]}  "
                f"({self._format_time(elapsed)}/{self._format_time(eta)})",
                end="",
            )

            # 下载章节页
            html = self._fetch_page(ch["url"])
            if not html:
                self._failed_cids.append(cid)
                print("  [失败]")
                continue

            # 解析章节
            chapter_data = parse_chapter_html(html, ch["url"])
            content = chapter_data.get("content", "")
            has_images = chapter_data.get("has_images", False)

            if not content and not has_images:
                self._failed_cids.append(cid)
                print("  [空内容]")
                continue

            # 下载插图（传入章节 URL 作为 Referer 防盗链）
            images_info = []
            if has_images:
                images_info = self._download_images(chapter_data, cid, ch["url"])
                chapter_data["images"] = images_info

            # 保存章节
            self._save_chapter(cid, chapter_data, images_info)
            self._completed_cids.add(cid)
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

    def _download_images(self, chapter_data: Dict, cid: int, chapter_url: str = "") -> List[Dict]:
        """下载章节插图到本地

        图片 CDN (pic.777743.xyz) 有防盗链保护，需要携带 Referer 和浏览器 UA。
        先用轻量的 requests 尝试（带 headers），失败则回退到 Playwright 浏览器下载。

        Args:
            chapter_data: 章节解析结果（含 images 字段）
            cid: 章节 ID
            chapter_url: 章节页面 URL，用作 Referer 防盗链

        Returns:
            [{"url": "...", "filename": "...", "local_path": "...", "downloaded": bool}, ...]
        """
        images = chapter_data.get("images", [])
        if not images:
            return []

        images_dir = self.config.novel_dir / "images" / str(cid)
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
        for img in images:
            url = img["url"]
            filename = img["filename"]
            local_path = images_dir / filename
            result = {
                "url": url,
                "filename": filename,
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

    def _save_chapter(self, cid: int, chapter_data: Dict, images_info: List[Dict] = None):
        """保存单章为文本和 JSON 文件"""
        chapters_dir = self.config.novel_dir / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)

        # 文本文件
        txt_path = chapters_dir / f"{cid}.txt"
        txt_content = chapter_data["title"] + "\n\n" + chapter_data["content"]
        txt_path.write_text(txt_content, encoding="utf-8")

        # JSON 元数据
        json_path = chapters_dir / f"{cid}.json"
        json_path.write_text(
            json.dumps(chapter_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 图片元数据
        if images_info:
            images_json_path = chapters_dir / f"{cid}_images.json"
            images_json_path.write_text(
                json.dumps(images_info, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def _save_metadata(self, all_chapters: List[Dict]):
        """保存小说元数据和章节列表"""
        metadata = {
            "aid": self.config.aid,
            "title": self._novel_title,
            "author": (
                self._book_data.get("author")
                or self._catalog_data.get("author", "")
            ),
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
            "failed_chapters": len(self._failed_cids),
            "failed_cids": self._failed_cids,
            "catalog_url": self.config.catalog_url,
            "book_url": self.config.book_url,
        }
        (self.config.novel_dir / "metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 章节列表
        chapters_list = []
        for v in self._catalog_data.get("volumes", []):
            vol_name = v.get("name", "")
            for ch in v.get("chapters", []):
                chapters_list.append({
                    "cid": ch["cid"],
                    "volume": vol_name,
                    "title": ch["title"],
                    "url": ch["url"],
                    "completed": ch["cid"] in self._completed_cids,
                })

        (self.config.novel_dir / "chapters.json").write_text(
            json.dumps(chapters_list, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ---------- 私有方法：断点 ----------

    def _load_checkpoint(self):
        """从断点文件恢复已完成的 cid 列表"""
        cp = self.config.checkpoint_file
        if cp.exists():
            try:
                data = json.loads(cp.read_text(encoding="utf-8"))
                self._completed_cids = set(data.get("completed_cids", []))
                print(f"[*] 从断点恢复: {len(self._completed_cids)} 章已完成")
            except Exception:
                self._completed_cids = set()

    def _save_checkpoint(self):
        """保存断点文件"""
        cp = self.config.checkpoint_file
        cp.write_text(
            json.dumps(
                {"completed_cids": sorted(list(self._completed_cids))},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

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
        print(f"  书名: {self._novel_title}")
        print(f"  总章节: {len(all_chapters)}")
        print(f"  已完成: {len(self._completed_cids)}")
        if self._failed_cids:
            print(f"  失败: {len(self._failed_cids)} -> {self._failed_cids}")
        print(f"  输出: {self.config.novel_dir}")
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

    args = parser.parse_args()

    # --- 确定 aid ---
    aid = args.aid
    if not aid and args.book_url:
        m = re.search(r"/book/(\d+)\.htm", args.book_url)
        if m:
            aid = int(m.group(1))
    if not aid:
        parser.print_help()
        print("\n[!] 请提供 --aid 或 --book-url")
        sys.exit(1)

    # --- 认证：获取 cookies ---
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
