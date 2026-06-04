"""小说爬取编排器

串联完整的小说爬取流程:
  book页 → 目录页 → 章节列表 → 遍历下载 → 保存

功能:
- 支持断点续爬（跳过已下载章节）
- 请求间隔控制（防止触发限流）
- 失败自动重试
- 进度实时显示

用法:
  python scraper.py --aid 1973 --cookie "..."
  python scraper.py --aid 1973 --cookie "..." --resume
  python scraper.py --book-url https://www.wenku8.net/book/1973.htm --cookie "..."
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

# 导入项目内模块
from cookie_utils import parse_cookie_string
from fetcher import RequestsFetcher, PlaywrightFetcher, FetchResult
from parser_catalog import parse_catalog_html
from parser_chapter import parse_chapter_html
from parser_book import parse_book_html


# ==================== 默认 Cookie ====================
# 如命令行不提供 --cookie，则使用此默认值
DEFAULT_COOKIES = "Hm_lvt_d72896ddbf8d27c750e3b365ea2fc902=1780045405,1780120108; HMACCOUNT=99CC7C9A5CC60B0C; _clck=t66ie%5E2%5Eg6h%5E0%5E2309; PHPSESSID=ba61ae6f8503fddca840632945d1d200; Hm_lvt_acfbfe93830e0272a88e1cc73d4d6d0f=1780125303; jieqiUserInfo=jieqiUserId%3D1134285%2CjieqiUserName%3D826839099%2CjieqiUserGroup%3D3%2CjieqiUserVip%3D0%2CjieqiUserPassword%3D2ea565d734f685316cb5e840a9a46f75%2CjieqiUserName_un%3D826839099%2CjieqiUserHonor_un%3D%26%23x666E%3B%26%23x901A%3B%26%23x4F1A%3B%26%23x5458%3B%2CjieqiUserGroupName_un%3D%26%23x666E%3B%26%23x901A%3B%26%23x4F1A%3B%26%23x5458%3B%2CjieqiUserLogin%3D1780141276; jieqiVisitInfo=jieqiUserLogin%3D1780141276%2CjieqiUserId%3D1134285; cf_clearance=g3uY8odL5slxQxj6rcsYeYkbJFmgpm8t7vJB3hreBmk-1780141278-1.2.1.1-qFqSHjdmALC0ViXKi2sFVFEyepsIX1qExCMMQEaBn7_Nxnlw9MfXSTNfdaCwGzFiN8Y24lEMXQWnmxUpWyjjBL3MqVqQH8gYlNJDPXw2NUkVOo9RZu5vs_HRPl7qJRJ0GBCuK8sYGDyR_qpuS5LcoQJ3iB9RlfU8.vUJiOz5SrxPvFUQzsYJUDpZJ_z8k4Ly0qSGWYh44o0IDI3zG3yHiu6tlkBcUGFqCUp_sNKC.285QGzywACaXQjzklZPzyH1xtVSupFBD9drXEFQNuKE5M2yvZQKRjRvFkh2ZkpT5_WzWeq.2TKD6x2WKgbtRSNQ2ylQnU_1HvFhuYEK2VpIaA; jieqiVisitTime=jieqiArticlesearchTime%3D1780141296; jieqiVisitId=article_articleviews%3D3057; _clsk=10zhujm%5E1780141298962%5E3%5E1%5Ev.clarity.ms%2Fcollect; Hm_lpvt_d72896ddbf8d27c750e3b365ea2fc902=1780141577; Hm_lpvt_acfbfe93830e0272a88e1cc73d4d6d0f=1780141577"


# ==================== 爬取配置 ====================

class ScraperConfig:
    """爬取配置"""
    def __init__(
        self,
        aid: int,
        output_dir: str = "novels",
        delay_seconds: float = 2.0,
        max_retries: int = 3,
        browser_mode: bool = False,
        timeout: int = 30,
    ):
        """
        Args:
            aid: 小说 ID
            output_dir: 输出根目录
            delay_seconds: 章节间请求间隔（秒），可浮点数
            max_retries: 每个章节下载失败后的最大重试次数
            browser_mode: 是否使用无头浏览器模式（遇到 Cloudflare 时使用）
            timeout: 每个请求超时秒数
        """
        self.aid = aid
        self.group = aid // 1000                      # URL 中的 group 参数
        self.output_dir = Path(output_dir)
        self.delay_seconds = delay_seconds
        self.max_retries = max_retries
        self.browser_mode = browser_mode
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
        """断点文件路径（记录已完成的 cid 列表）"""
        return self.novel_dir / ".checkpoint.json"


# ==================== 爬取编排器 ====================

class NovelScraper:
    """小说爬取编排器

    职责:
    1. 下载并解析目录页，获取章节列表
    2. 逐个下载章节正文
    3. 保存元数据 + 章节数据
    4. 维护断点文件，支持续爬

    使用示例:
        scraper = NovelScraper(config, cookies, fetcher)
        scraper.run()
    """

    # 目录页 URL 模板
    CATALOG_URL = "https://www.wenku8.net/novel/{group}/{aid}/index.htm"

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
        self._completed_cids: set = set()    # 已完成的章节 cid
        self._failed_cids: List[int] = []    # 失败的章节 cid
        self._catalog_data: Dict = {}         # 目录解析结果
        self._book_data: Dict = {}            # 书页解析结果
        self._novel_title: str = ""           # 小说名

        # 加载断点
        self._load_checkpoint()

    # ---------- 公共方法：主流程 ----------

    def run(self):
        """执行完整爬取流程

        流程:
        1. 下载目录页 → 解析章节列表
        2. 如果之前已完成部分章节 → 跳过
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
            # 书页下载失败不阻塞流程，目录页还有基础信息
            self._book_data = {}
            print("  [!] 书页获取失败，将使用目录页信息")
        print()

        # ---------- 步骤2: 获取章节列表 ----------
        print("[2/4] 获取目录页...")
        catalog_html = self._fetch_page(self.config.catalog_url)
        if not catalog_html:
            print("[X] 无法获取目录页，终止")
            return False

        # 解析目录
        self._catalog_data = parse_catalog_html(
            catalog_html, self.config.catalog_url
        )
        # 如果书页失败，用目录页信息兜底
        if not self._novel_title:
            self._novel_title = self._catalog_data.get("title", f"aid_{self.config.aid}")

        # 展平章节列表（去卷结构，方便逐个处理）
        all_chapters = self._flatten_chapters(self._catalog_data)
        print(f"  总章节: {len(all_chapters)}")

        # 过滤掉已完成的章节
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
        """下载页面 HTML，支持重试

        Args:
            url: 页面 URL
            retries: 剩余重试次数（None 则使用配置值）

        Returns:
            页面 HTML 字符串（GBK解码后的unicode），失败返回 None
        """
        if retries is None:
            retries = self.config.max_retries

        for attempt in range(retries + 1):
            try:
                if self.config.browser_mode:
                    return self._fetch_with_browser(url)
                else:
                    return self._fetch_with_requests(url)
            except Exception as e:
                if attempt < retries:
                    wait = 2 ** attempt  # 指数退避: 1s, 2s, 4s
                    print(f"  [!] 重试 ({attempt+1}/{retries})，{wait}s后重试: {url[-60:]}")
                    time.sleep(wait)
                else:
                    print(f"  [X] 下载失败: {url[-60:]} - {e}")
                    return None

    def _fetch_with_requests(self, url: str) -> str:
        """使用 requests 下载页面"""
        fetcher = RequestsFetcher(cookies=self.cookies, timeout=self.config.timeout)
        result = fetcher.fetch(url)
        # 注意: 网站编码为 GBK，requests 会自动处理 apparent_encoding
        return result.html

    def _fetch_with_browser(self, url: str) -> str:
        """使用无头浏览器下载页面"""
        fetcher = PlaywrightFetcher(cookies=self.cookies, timeout=self.config.timeout)
        result = asyncio.run(fetcher.fetch(url))
        return result.html

    # ---------- 私有方法：章节下载 ----------

    def _download_chapters(self, chapters: List[Dict]):
        """逐个下载章节，带进度显示和断点保存

        Args:
            chapters: 待下载的章节列表 [{"cid": ..., "title": ..., "url": ...}, ...]
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

            # 下载插图（如有）
            images_info = []
            if has_images:
                images_info = self._download_images(chapter_data, cid)
                downloaded = sum(1 for i in images_info if i["downloaded"])
                # 更新 chapter_data 中的图片信息（加入本地路径）
                chapter_data["images"] = images_info

            # 保存章节
            self._save_chapter(cid, chapter_data, images_info)
            self._completed_cids.add(cid)
            self._save_checkpoint()

            # 请求间隔
            if i < total:
                wait = self.config.delay_seconds
                # 添加随机抖动 ±0.5s
                import random
                wait += random.uniform(-0.5, 0.5)
                wait = max(0.5, wait)
                time.sleep(wait)

            # 进度显示
            img_str = ""
            if images_info:
                img_str = f" {sum(1 for i in images_info if i['downloaded'])}/{len(images_info)}图 "
            print(f"  [{img_str}{len(content)}字]")

    # ---------- 私有方法：图片下载 ----------

    def _download_images(self, chapter_data: Dict, cid: int) -> List[Dict]:
        """下载章节插图到本地

        Args:
            chapter_data: 章节解析结果（含 images 字段）
            cid: 章节 ID

        Returns:
            [{"url": "...", "filename": "...", "local_path": "...",
              "downloaded": True/False}, ...]
        """
        images = chapter_data.get("images", [])
        if not images:
            return []

        # 创建图片目录
        images_dir = self.config.novel_dir / "images" / str(cid)
        images_dir.mkdir(parents=True, exist_ok=True)

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

            # 跳过已下载的图片
            if local_path.exists():
                result["downloaded"] = True
                results.append(result)
                continue

            # 下载图片
            try:
                fetcher = RequestsFetcher(
                    cookies=self.cookies,
                    timeout=self.config.timeout,
                )
                # 图片需要获取原始字节，不能用 text 模式
                resp = fetcher.session.get(url, timeout=self.config.timeout)
                if resp.status_code == 200:
                    local_path.write_bytes(resp.content)
                    result["downloaded"] = True
                else:
                    print(f"\n  [!] 图片 {filename} HTTP {resp.status_code}")
            except Exception as e:
                print(f"\n  [!] 图片 {filename} 下载失败: {e}")

            results.append(result)

        return results

    # ---------- 私有方法：保存 ----------

    def _save_chapter(self, cid: int, chapter_data: Dict, images_info: List[Dict] = None):
        """保存单章为文本文件和 JSON 文件

        目录结构:
        novels/aid_1973/
          chapters/
            {cid}.txt         ← 章节正文（纯文本，含 [插图: ...] 标记）
            {cid}.json        ← 章节完整数据（含图片元数据）
            {cid}_images.json ← 图片下载记录
          images/{cid}/       ← 已下载的图片文件
          chapters.json       ← 章节列表（只含元数据，不含正文）
        """
        chapters_dir = self.config.novel_dir / "chapters"
        chapters_dir.mkdir(parents=True, exist_ok=True)

        # 保存纯文本（标题 + 正文）
        txt_path = chapters_dir / f"{cid}.txt"
        txt_content = chapter_data["title"] + "\n\n" + chapter_data["content"]
        txt_path.write_text(txt_content, encoding="utf-8")

        # 保存 JSON（含完整元数据）
        json_path = chapters_dir / f"{cid}.json"
        json_path.write_text(
            json.dumps(chapter_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # 保存图片元数据（如果有图片）
        if images_info:
            images_json_path = chapters_dir / f"{cid}_images.json"
            images_json_path.write_text(
                json.dumps(images_info, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def _save_metadata(self, all_chapters: List[Dict]):
        """保存小说元数据

        生成文件:
        - metadata.json: 书名、作者、aid、章节数、统计信息
        - chapters.json: 章节列表（不含正文，含 url）
        """
        # 元数据（优先用书页数据，兜底用目录页数据）
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
        """将分卷的章节列表展平为一维列表

        Args:
            catalog: 目录解析结果

        Returns:
            [{"cid": 69567, "title": "KEYWORDS", "url": "...", "volume": "第一卷"}, ...]
        """
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
            print(f"  失败: {len(self._failed_cids)} → {self._failed_cids}")
        print(f"  输出: {self.config.novel_dir}")
        print(f"{'='*60}")


# ==================== CLI 入口 ====================

def main():
    parser = argparse.ArgumentParser(
        description="小说爬取器 - 自动下载整本小说",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scraper.py --aid 1973
  python scraper.py --aid 1973 --cookie "key=value"
  python scraper.py --aid 1973 --resume                     # 断点续爬
  python scraper.py --aid 1973 --browser --delay 3.0        # 浏览器模式, 3秒间隔
  python scraper.py --book-url https://www.wenku8.net/book/1973.htm
        """,
    )
    # 目标参数
    parser.add_argument("--aid", type=int, default=0, help="小说 ID")
    parser.add_argument("--book-url", default="", help="小说书页 URL（自动提取 aid）")
    # Cookie
    parser.add_argument("--cookie", "-c", default="", help="Cookie 字符串")
    # 爬取选项
    parser.add_argument("--output-dir", "-o", default="novels", help="输出目录")
    parser.add_argument("--delay", "-d", type=float, default=2.0, help="章节间延时秒数")
    parser.add_argument("--retries", "-r", type=int, default=3, help="失败重试次数")
    parser.add_argument("--timeout", "-t", type=int, default=30, help="请求超时秒数")
    # 模式
    parser.add_argument("--browser", "-b", action="store_true", help="使用无头浏览器模式")
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

    # --- Cookie ---
    cookies = parse_cookie_string(args.cookie or DEFAULT_COOKIES)
    if cookies:
        print(f"[*] 已解析 {len(cookies)} 个 cookie")

    # --- 配置 ---
    config = ScraperConfig(
        aid=aid,
        output_dir=args.output_dir,
        delay_seconds=args.delay,
        max_retries=args.retries,
        browser_mode=args.browser,
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
