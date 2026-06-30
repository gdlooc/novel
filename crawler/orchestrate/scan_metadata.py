"""元数据预扫描器 — 轻量请求书页，回填 site_novels 的 rating/tags/status

问题背景：
  discover.py 遍历列表页发现小说时，列表页只含 aid + title + url，
  不含评分（rating）、标签（tags）、状态（status）等信息。
  这些元数据需要请求每本小说的书页（/book/{aid}.htm）才能获取。

解决方案：
  本模块遍历 site_novels 中 rating 为空的小说，仅请求书页 HTML（~5KB/本），
  用 BookParser 提取 rating/tags/status 后直接 UPDATE site_novels 表。
  不下载章节，不涉及 novels 表。

  回填后，batch.py 的 --min-rating / --tag / --status 筛选即可正常工作。

用法:
  python orchestrate/scan_metadata.py                    # 全量扫描（所有 rating 为空的行）
  python orchestrate/scan_metadata.py --top 200           # 只扫描前 200 本
  python orchestrate/scan_metadata.py --concurrent 5      # 5 并发（共享浏览器）
  python orchestrate/scan_metadata.py --resume            # 断点续扫
  python orchestrate/scan_metadata.py --force             # 强制重新扫描（即使已有 rating）
"""

import argparse
import asyncio
import json
import random
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Set

sys.path.insert(0, str(Path(__file__).parent.parent))

# 项目内模块
from fetch.auth import resolve_cookies
from fetch.fetcher import PlaywrightFetcher
from fetch.parser_book import parse_book_html

# wenku8 书页 URL 模板
_BOOK_URL = "https://www.wenku8.net/book/{aid}.htm"


# ═══════════════════════════════════════════════════════════════
# 元数据扫描器
# ═══════════════════════════════════════════════════════════════

class MetadataScanner:
    """元数据预扫描器

    仅请求书页，提取 rating/tags/status，回填到 site_novels 表。
    不下载章节，不写入 novels 表。

    设计要点：
    - 复用 PlaywrightFetcher + BookParser（与 scraper.py 相同的请求/解析链路）
    - 串行模式：每本启动独立浏览器（简单可靠）
    - 并发模式：共享浏览器实例 + 独立 context（高效，复用 scraper.py 的 async 模式）
    - 断点管理：记录已完成的 data_source_aid 到 _scan_checkpoint.json
    """

    def __init__(
        self,
        cookies: Optional[Dict[str, str]] = None,
        output_dir: str = "novels",
        concurrency: int = 1,
        delay: float = 1.0,
    ):
        """
        Args:
            cookies: 登录 cookie 字典
            output_dir: 输出目录（用于保存断点文件）
            concurrency: 并发数（1=串行）
            delay: 请求间延迟秒数
        """
        self.cookies = cookies or {}
        self.output_dir = Path(output_dir)
        self.concurrency = concurrency
        self.delay = delay

        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 断点文件
        self._checkpoint_file = self.output_dir / "_scan_checkpoint.json"
        self._completed_aids: Set[int] = set()
        self._failed_aids: Dict[int, str] = {}
        self._load_checkpoint()

        # 统计
        self._scanned = 0
        self._updated = 0
        self._skipped = 0
        self._failed = 0

    # ─── 公共方法 ───

    def run(
        self,
        top: Optional[int] = None,
        resume: bool = False,
        force: bool = False,
    ):
        """执行元数据预扫描

        Args:
            top: 限制扫描数量
            resume: 断点续扫模式（跳过已完成的）
            force: 强制重新扫描（包含已有 rating 的小说）
        """
        # ── 从数据库加载待扫描列表 ──
        novels = self._load_targets(limit=top, force=force)

        if not novels:
            print("[*] 没有需要扫描的小说")
            return

        total = len(novels)
        print(f"[*] 待扫描: {total} 本")
        print(f"[*] 并发数: {self.concurrency}")
        print(f"[*] 请求间延迟: {self.delay}s")
        print()

        # ── 断点续扫：排除已完成的 ──
        if resume and self._completed_aids:
            pending = [
                n for n in novels
                if n["data_source_aid"] not in self._completed_aids
            ]
            skipped = len(novels) - len(pending)
            if skipped:
                print(f"[*] 断点续扫: 跳过已完成 {skipped} 本")
            novels = pending

        if not novels:
            print("[*] 所有小说已完成扫描")
            self._print_summary()
            return

        # ── 执行扫描 ──
        start_time = time.time()

        if self.concurrency > 1:
            asyncio.run(self._scan_concurrent(novels))
        else:
            self._scan_serial(novels)

        elapsed = time.time() - start_time
        print(f"\n[*] 扫描完成，耗时: {self._format_time(elapsed)}")
        self._print_summary()

    # ─── 串行扫描 ───

    def _scan_serial(self, novels: List[Dict]):
        """串行扫描：逐本请求书页并回填"""
        total = len(novels)

        for i, novel in enumerate(novels, 1):
            if i > 1:
                wait = self.delay + random.uniform(-0.3, 0.3)
                time.sleep(max(0.5, wait))

            data_source_aid = novel["data_source_aid"]
            title = novel.get("title", "")
            print(f"  [{i}/{total}] aid={data_source_aid}  {title[:40]}", end="  ")

            success = self._process_book_sync(data_source_aid)
            if success:
                self._completed_aids.add(data_source_aid)
                print("✓")
            else:
                self._failed_aids[data_source_aid] = "书页获取失败"
                print("✗")

            # 每 50 本保存一次断点
            if i % 50 == 0:
                self._save_checkpoint()

        self._save_checkpoint()

    # ─── 并发扫描（共享浏览器）───

    async def _scan_concurrent(self, novels: List[Dict]):
        """并发扫描：共享浏览器 + 独立 context + Semaphore 控速"""
        from playwright.async_api import async_playwright

        total = len(novels)
        semaphore = asyncio.Semaphore(self.concurrency)
        completed_count = 0

        async def process_one(novel: Dict):
            nonlocal completed_count
            async with semaphore:
                await asyncio.sleep(random.uniform(0, self.delay))
                # 每个任务使用共享浏览器创建独立 context
                return await self._process_book_async(browser, novel)

        async with async_playwright() as pw:
            # 启动共享浏览器
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )

            # 逐个提交任务，用 Semaphore 控制并发度
            tasks = []
            for novel in novels:
                task = asyncio.create_task(process_one(novel))
                tasks.append(task)

            # 等待所有任务完成
            results = await asyncio.gather(*tasks, return_exceptions=True)

            await browser.close()

        # 汇总结果
        for novel, result in zip(novels, results):
            data_source_aid = novel["data_source_aid"]
            if result is True:
                self._completed_aids.add(data_source_aid)
            elif isinstance(result, Exception):
                self._failed_aids[data_source_aid] = str(result)
            else:
                self._failed_aids[data_source_aid] = "书页获取失败"

        self._save_checkpoint()

    async def _process_book_async(self, browser, novel: Dict) -> bool:
        """异步处理单本书：创建独立 context → 请求书页 → 解析 → 更新

        在共享浏览器中创建独立 context（等价于隐身窗口），
        注入 cookies，请求书页 HTML，提取元数据后更新 site_novels。

        Args:
            browser: Playwright 共享浏览器实例
            novel: site_novels 行（含 data_source_aid, title, url）

        Returns:
            True=成功, False=失败
        """
        data_source_aid = novel["data_source_aid"]
        url = novel.get("url") or _BOOK_URL.format(aid=data_source_aid)

        context = None
        try:
            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                locale="zh-CN",
            )

            # 注入 cookies
            if self.cookies:
                from urllib.parse import urlparse
                domain = urlparse(url).netloc
                pw_cookies = [
                    {"name": k, "value": v, "domain": domain, "path": "/"}
                    for k, v in self.cookies.items()
                ]
                await context.add_cookies(pw_cookies)

            page = await context.new_page()

            # stealth 伪装
            try:
                from playwright_stealth import Stealth
                await Stealth().apply_stealth_async(page)
            except Exception:
                pass

            response = await page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=30000,
            )

            # 检查状态码
            if response and response.status != 200:
                return False

            await page.wait_for_timeout(1500)
            html = await page.content()

            # 解析书页 → 提取 rating/tags/status
            return self._update_metadata_from_html(
                data_source_aid, html, url
            )

        except Exception:
            return False
        finally:
            if context:
                await context.close()

    # ─── 同步处理单本（串行模式用）───

    def _process_book_sync(self, data_source_aid: int) -> bool:
        """同步处理单本书：请求书页 → 解析 → 更新 site_novels

        串行模式下使用（每本启动独立浏览器）。

        Args:
            data_source_aid: 源站小说 ID

        Returns:
            True=成功, False=失败
        """
        url = _BOOK_URL.format(aid=data_source_aid)
        try:
            fetcher = PlaywrightFetcher(cookies=self.cookies, timeout=30)
            result = asyncio.run(fetcher.fetch(url))

            if result.status_code != 200:
                return False

            return self._update_metadata_from_html(
                data_source_aid, result.html, url
            )
        except Exception:
            return False

    # ─── 解析 + 数据库更新 ───

    def _update_metadata_from_html(
        self,
        data_source_aid: int,
        html: str,
        url: str = "",
    ) -> bool:
        """解析书页 HTML 并更新 site_novels 的元数据

        提取流程：
        1. BookParser.parse() → 拿到 rating / tags / status
        2. db.update_site_novel_metadata() → 写入 site_novels

        Args:
            data_source_aid: 源站小说 ID
            html: 书页 HTML 内容
            url: 书页 URL（用于日志）

        Returns:
            True=解析并更新成功, False=解析失败
        """
        try:
            book_data = parse_book_html(html, url)
        except Exception:
            return False

        rating = book_data.get("rating", "")
        tags = book_data.get("tags", [])
        status = book_data.get("status", "")

        # 如果什么都没解析到，视为失败
        if not rating and not tags and not status:
            return False

        try:
            from core.database import NovelDB
            db = NovelDB()
            db.update_site_novel_metadata(
                data_source_aid=data_source_aid,
                rating=rating,
                tags=tags,
                status=status,
            )
            db.close()
            self._updated += 1
            return True
        except Exception:
            return False

    # ─── 数据库加载 ───

    def _load_targets(
        self,
        limit: Optional[int] = None,
        force: bool = False,
    ) -> List[Dict]:
        """从数据库加载待扫描的小说列表

        Args:
            limit: 限制数量
            force: True=返回全部, False=仅返回 rating 为空的行

        Returns:
            小说列表 [{"data_source_aid": ..., "title": ..., "url": ...}, ...]
        """
        try:
            from core.database import NovelDB
            db = NovelDB()
            novels = db.get_site_novels_needing_scan(limit=limit, force=force)
            db.close()
            return novels
        except Exception as e:
            print(f"[!] 从数据库加载失败: {e}")
            return []

    # ─── 断点管理 ───

    def _load_checkpoint(self):
        """加载扫描断点"""
        cp = self._checkpoint_file
        if cp.exists():
            try:
                data = json.loads(cp.read_text(encoding="utf-8"))
                self._completed_aids = set(data.get("completed_aids", []))
                self._failed_aids = {
                    int(k): v for k, v in data.get("failed_aids", {}).items()
                }
            except Exception:
                self._completed_aids = set()
                self._failed_aids = {}

        if self._completed_aids:
            print(f"[*] 扫描断点: {len(self._completed_aids)} 本已完成")

    def _save_checkpoint(self):
        """保存扫描断点"""
        cp = self._checkpoint_file
        cp.write_text(
            json.dumps({
                "completed_aids": sorted(list(self._completed_aids)),
                "failed_aids": {str(k): v for k, v in self._failed_aids.items()},
                "updated_at": time.time(),
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    # ─── 汇总 ───

    def _print_summary(self):
        """打印扫描汇总"""
        print()
        print("=" * 50)
        print(f"  扫描汇总")
        print(f"  已完成: {len(self._completed_aids)}")
        if self._failed_aids:
            print(f"  失败: {len(self._failed_aids)}")
        print("=" * 50)

    @staticmethod
    def _format_time(seconds: float) -> str:
        """格式化时间"""
        if seconds < 60:
            return f"{seconds:.0f}s"
        elif seconds < 3600:
            return f"{seconds / 60:.1f}m"
        else:
            return f"{seconds / 3600:.1f}h"


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="元数据预扫描器 — 轻量请求书页，回填 site_novels 的 rating/tags/status",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scan_metadata.py                            # 全量扫描（所有 rating 为空的行）
  python scan_metadata.py --top 200                   # 只扫描前 200 本
  python scan_metadata.py --concurrent 5              # 5 并发
  python scan_metadata.py --resume                    # 断点续扫
  python scan_metadata.py --force                     # 强制重新扫描
        """,
    )

    # 扫描目标
    target = parser.add_argument_group("扫描目标")
    target.add_argument("--top", type=int, default=None,
                        help="只扫描前 N 本")
    target.add_argument("--force", action="store_true",
                        help="强制重新扫描（包含已有 rating 的小说）")

    # 模式
    mode = parser.add_argument_group("模式")
    mode.add_argument("--resume", action="store_true",
                      help="断点续扫，跳过已完成的")

    # 行为参数
    behav = parser.add_argument_group("行为选项")
    behav.add_argument("--output-dir", "-o", default="novels",
                       help="输出目录（断点文件位置）")
    behav.add_argument("--concurrent", "-j", type=int, default=1,
                       help="并发数（默认 1=串行）")
    behav.add_argument("--delay", type=float, default=1.0,
                       help="请求间延迟秒数（默认 1s）")

    # 认证
    auth_g = parser.add_argument_group("认证")
    auth_g.add_argument("--username", "-u", default="", help="用户名")
    auth_g.add_argument("--password", "-p", default="", help="密码")
    auth_g.add_argument("--cookie", "-c", default="", help="Cookie 字符串")

    args = parser.parse_args()

    # ── 认证 ──
    cookies = resolve_cookies(
        username=args.username,
        password=args.password,
        cookie_string=args.cookie,
    )
    if not cookies:
        print("[!] 警告: 未获取到登录凭证，书页可能无法访问")

    # ── 扫描 ──
    scanner = MetadataScanner(
        cookies=cookies,
        output_dir=args.output_dir,
        concurrency=args.concurrent,
        delay=args.delay,
    )

    scanner.run(
        top=args.top,
        resume=args.resume,
        force=args.force,
    )


if __name__ == "__main__":
    main()
