"""批量下载编排器 — 基于站点索引批量爬取小说

读取 discover.py 生成的 _site_index.json，
支持按标签/状态/评级过滤，逐本调用 NovelScraper 下载。

用法:
  python batch.py --top 10                              # 下载前10本
  python batch.py --tag 校园 --tag 恋爱 --top 20         # 按标签过滤
  python batch.py --status 已完结 --top 50               # 只下载已完结
  python batch.py --resume                               # 断点续爬
  python batch.py --update                               # 增量：重新发现+下载新增
  python batch.py --aid 3057 --aid 1973                   # 指定aid列表
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Set

sys.path.insert(0, str(Path(__file__).parent.parent))

# 导入项目内模块
from core.logger import get_logger
from fetch.auth import resolve_cookies

_log = get_logger("batch")
from orchestrate.scraper import NovelScraper, ScraperConfig
from orchestrate.discover import NovelDiscoverer, DiscoveredNovel
from orchestrate.scan_metadata import MetadataScanner


# ═══════════════════════════════════════════════════════════════
# 批量下载编排器
# ═══════════════════════════════════════════════════════════════

class BatchScraper:
    """批量下载编排器

    读取站点索引，过滤 → 逐本调用 NovelScraper 下载。
    维护 _site_checkpoint.json 跟踪进度，支持断点续爬。
    """

    def __init__(
        self,
        output_dir: str = "novels",
        cookies: Optional[Dict[str, str]] = None,
        delay_between_novels: float = 3.0,
        concurrency: int = 1,
        username: str = "",
        password: str = "",
    ):
        """
        Args:
            output_dir: 小说输出根目录
            cookies: 登录 cookie 字典
            delay_between_novels: 小说间延迟秒数（含随机抖动）
            concurrency: 单本小说内部的章节并发数（传给 NovelScraper）
            username: 登录用户名（Cookie 过期时自动重新登录）
            password: 登录密码
        """
        self.output_dir = Path(output_dir)
        self.cookies = cookies or {}
        self.delay_between_novels = delay_between_novels
        self.concurrency = concurrency
        self._username = username
        self._password = password

        # 输出目录
        self.output_dir.mkdir(parents=True, exist_ok=True)

        # 状态追踪
        self._checkpoint_file = self.output_dir / "_site_checkpoint.json"
        self._completed_aids: Set[int] = set()
        self._failed_aids: Dict[int, str] = {}  # aid → 失败原因
        self._load_checkpoint()

    # ─── 公共方法 ───

    def run_from_index(
        self,
        index_path: str = "novels/_site_index.json",
        tags: Optional[List[str]] = None,
        status_filter: Optional[str] = None,
        min_rating: Optional[str] = None,
        top: Optional[int] = None,
        aid_list: Optional[List[int]] = None,
        resume: bool = False,
        use_database: bool = True,
    ):
        """从站点索引读取小说列表并批量下载

        Args:
            index_path: 站点索引 JSON 文件路径
            tags: 按标签过滤（需先爬取书页才能获取标签，仅对已发现的小说有效）
            status_filter: 按状态过滤（"已完结" / "连载中"）
            min_rating: 最低评级（如 "A"、"B"）
            top: 只下载前 N 本
            aid_list: 明确的 aid 列表（优先于索引）
            resume: 断点续爬模式
            use_database: True=优先从数据库加载（支持筛选），False=仅从 JSON 加载
        """
        # ── 确定待下载列表 ──
        if aid_list:
            novels = [
                DiscoveredNovel(aid=aid, title=f"aid_{aid}")
                for aid in aid_list
            ]
            print(f"[*] 指定 aid 列表: {len(novels)} 本")
        elif use_database:
            # 优先从数据库加载（支持筛选和分页）
            novels = self._load_novels_from_database(
                tags=tags,
                status_filter=status_filter,
                min_rating=min_rating,
                top=top,
                resume=resume,
            )
            if novels:
                print(f"[*] 从数据库加载: {len(novels)} 本小说")
            else:
                print("[!] 数据库无数据，回退到 JSON 文件...")
                use_database = False

        if not use_database or not novels:
            # 从 JSON 文件加载
            novels = NovelDiscoverer.load_index(index_path)
            print(f"[*] 从索引加载: {len(novels)} 本小说")

        # ── 过滤 ──
        if tags or status_filter or min_rating:
            novels = self._filter_novels(novels, tags, status_filter, min_rating)

        if top and top > 0:
            novels = novels[:top]
            print(f"[*] 限制前 {top} 本")

        # ── 断点续爬：排除已完成的 ──
        pending = novels
        if resume:
            pending = [n for n in novels if n.aid not in self._completed_aids]
            skipped = len(novels) - len(pending)
            if skipped > 0:
                print(f"[*] 断点续爬: 跳过已完成的 {skipped} 本")
        else:
            # 清理旧断点
            self._completed_aids.clear()
            self._save_checkpoint()

        if not pending:
            print("  所有小说已完成，无需下载")
            self._print_summary(len(novels))
            return

        print(f"[*] 待下载: {len(pending)} 本")
        print(f"[*] 小说间延迟: {self.delay_between_novels}s")
        print(f"[*] 内部并发: {self.concurrency}")
        print()

        # ── 逐本下载 ──
        self._download_batch(pending)

        # ── 汇总 ──
        self._print_summary(len(novels))

    def run_update(self, index_path: str = "novels/_site_index.json"):
        """增量更新模式：重新发现 + 下载新增小说

        1. 重新遍历排行榜，更新站点索引
        2. 对比断点，找出新增的小说
        3. 下载新增小说
        """
        print("=" * 60)
        print("  增量更新模式")
        print("=" * 60)
        print()

        # ── 步骤1: 重新发现 ──
        print("[1/2] 重新遍历排行榜...")
        discoverer = NovelDiscoverer(cookies=self.cookies)
        novels = discoverer.discover_from_toplist(sort="lastupdate")
        NovelDiscoverer.save_index(novels, index_path)
        # 同时写入数据库
        NovelDiscoverer.save_to_database(novels)

        # ── 步骤2: 对比断点，找出新增 ──
        print()
        print("[2/2] 对比断点，下载新增小说...")
        new_novels = [n for n in novels if n.aid not in self._completed_aids]

        if not new_novels:
            print(f"  无新增小说（索引 {len(novels)} 本，已下载 {len(self._completed_aids)} 本）")
            return

        print(f"  发现 {len(new_novels)} 本新增小说")
        print()

        self._download_batch(new_novels)
        self._print_summary(len(novels))

    # ─── 私有方法 ───

    def _download_batch(self, novels: List[DiscoveredNovel]):
        """逐本下载小说列表"""
        total = len(novels)
        start_time = time.time()

        for i, novel in enumerate(novels, 1):
            # 小说间延迟（第1本不需要）
            if i > 1:
                wait = self.delay_between_novels + random.uniform(-1.0, 1.0)
                wait = max(1.0, wait)
                time.sleep(wait)

            print(f"\n{'─' * 50}")
            print(f"  [{i}/{total}] aid={novel.aid}  {novel.title[:40]}")
            print(f"{'─' * 50}")

            try:
                config = ScraperConfig(
                    aid=novel.aid,
                    output_dir=str(self.output_dir),
                    delay_seconds=1.5,
                    concurrency=self.concurrency,
                    username=self._username,
                    password=self._password,
                )

                scraper = NovelScraper(config, self.cookies)
                success = scraper.run()

                if success:
                    self._completed_aids.add(novel.aid)
                    _log.info("下载完成 aid=%s: %s", novel.aid, novel.title[:40])
                    if scraper._failed_cids:
                        self._failed_aids[novel.aid] = (
                            f"部分章节失败: {scraper._failed_cids}"
                        )
                    # 双重保障：强制同步 site_novels 元数据
                    # scraper.run() 内部已调用过一次，此处防止内部调用静默失败
                    self._sync_site_novel_safety(scraper)
                else:
                    self._failed_aids[novel.aid] = "爬取流程失败"

            except Exception as e:
                self._failed_aids[novel.aid] = str(e)
                _log.error("下载失败 aid=%s: %s", novel.aid, e)
                print(f"  [X] 异常: {e}")

            # 每本完成后立即保存断点
            self._save_checkpoint()

            # 进度显示
            elapsed = time.time() - start_time
            eta = (elapsed / i) * (total - i) if i > 0 else 0
            ok = len(self._completed_aids)
            fail = len(self._failed_aids)
            print(f"  进度: {ok} OK / {fail} 失败  "
                  f"({self._format_time(elapsed)}/{self._format_time(eta)})")

    # 评分等级映射（与 database.py 保持一致）
    # 注意：键值带"级"后缀，与数据库实际存储值一致
    RATING_ORDER = {"S级": 1, "A级": 2, "B级": 3, "C级": 4, "D级": 5, "E级": 6}

    def _filter_novels(
        self,
        novels: List[DiscoveredNovel],
        tags: Optional[List[str]],
        status_filter: Optional[str],
        min_rating: Optional[str],
    ) -> List[DiscoveredNovel]:
        """按条件过滤小说列表

        注意：标签/状态/评级需要访问书页才能获取。
        对于尚未下载的小说，此过滤为「尽力而为」模式——
        如果索引中无对应元数据，则保留该小说（不过滤掉）。

        评分比较使用 RATING_ORDER 映射（数字比较），
        避免 ASCII 字符串比较导致的 "S级" < "A级" 错误。
        """
        if not tags and not status_filter and not min_rating:
            return novels

        # 尝试加载已有的元数据缓存
        meta_cache: Dict[int, Dict] = {}
        for aid_dir in self.output_dir.iterdir():
            if aid_dir.is_dir() and aid_dir.name.startswith("aid_"):
                meta_file = aid_dir / "metadata.json"
                if meta_file.exists():
                    try:
                        meta = json.loads(meta_file.read_text(encoding="utf-8"))
                        meta_cache[meta["aid"]] = meta
                    except Exception:
                        pass

        # 计算目标评分等级的数字值（归一化：支持 "S" 和 "S级" 两种写法）
        rating_key = min_rating if min_rating.endswith("级") else min_rating + "级"
        target_order = self.RATING_ORDER.get(rating_key, 99) if min_rating else 99

        filtered = []
        for novel in novels:
            meta = meta_cache.get(novel.aid)

            if meta:
                # 有元数据 → 精确过滤
                if status_filter and meta.get("status") != status_filter:
                    continue
                if min_rating:
                    # 使用 RATING_ORDER 做数字比较而非字符串比较
                    # 归一化 rating 值（确保以"级"结尾）
                    novel_rating = meta.get("rating", "")
                    if novel_rating and not novel_rating.endswith("级"):
                        novel_rating += "级"
                    novel_order = self.RATING_ORDER.get(novel_rating, 99)
                    if novel_order > target_order:
                        continue
                if tags:
                    novel_tags = [t.lower() for t in meta.get("tags", [])]
                    if not any(t.lower() in novel_tags for t in tags):
                        continue
            # 无元数据 → 保留（不过滤掉未知小说）

            filtered.append(novel)

        if len(filtered) < len(novels):
            print(f"[*] 过滤后: {len(filtered)}/{len(novels)} 本")
        return filtered

    # ─── 站点索引同步（双重保障）───

    def _sync_site_novel_safety(self, scraper: NovelScraper):
        """双重保障：即使 scraper 内部同步失败，batch 层也确保 site_novels 被更新

        在 scraper.run() 成功后调用，防止 scraper 内部的 sync_site_novel_from_novel
        静默失败导致 site_novels 元数据缺失。

        Args:
            scraper: 已完成下载的 NovelScraper 实例
        """
        novel_id = getattr(scraper, '_novel_id', 0)
        if novel_id <= 0:
            return
        try:
            from core.database import NovelDB
            db = NovelDB()
            db.sync_site_novel_from_novel(novel_id)
            db.close()
        except Exception:
            pass  # 静默失败，不阻塞批量下载流程

    # ─── 数据库加载 ───

    def _load_novels_from_database(
        self,
        tags: Optional[List[str]] = None,
        status_filter: Optional[str] = None,
        min_rating: Optional[str] = None,
        top: Optional[int] = None,
        resume: bool = False,
    ) -> List[DiscoveredNovel]:
        """从数据库 site_novels 表加载小说列表

        支持筛选（tags/status/rating）、分页（top）、断点续爬（resume）。
        优先从数据库加载的好处：
        - 支持标签/状态/评级筛选（JSON 索引无此数据）
        - 分页查询，避免加载全量 4123 本到内存
        - 统一数据源，减少 JSON 文件依赖

        Args:
            tags: 按标签过滤
            status_filter: 按状态过滤
            min_rating: 最低评级
            top: 限制前 N 本
            resume: 断点续爬模式

        Returns:
            DiscoveredNovel 列表
        """
        try:
            from core.database import NovelDB
            db = NovelDB()

            # 准备筛选参数
            downloaded = None  # None=全部
            if resume:
                # 断点续爬：只加载未完成的
                downloaded = False

            # 从数据库加载
            novels_data, total = db.get_site_novels(
                downloaded=downloaded,
                tags=tags,
                status=status_filter,
                min_rating=min_rating,
                offset=0,
                limit=top if top and top > 0 else 10000,
            )

            # 转换为 DiscoveredNovel 对象
            novels = [
                DiscoveredNovel(
                    aid=n["data_source_aid"],
                    title=n["title"],
                    url=n.get("url", ""),
                )
                for n in novels_data
            ]

            db.close()
            return novels

        except Exception as e:
            print(f"[!] 从数据库加载失败: {e}")
            return []

    # ─── 断点管理 ───

    def _load_checkpoint(self):
        """加载站点级断点

        优先从 _site_checkpoint.json 读取，
        同时扫描已有 aid_*/metadata.json 补充已完成的源站 aid。
        """
        cp = self._checkpoint_file
        if cp.exists():
            try:
                data = json.loads(cp.read_text(encoding="utf-8"))
                self._completed_aids = set(data.get("completed_aids", []))
                self._failed_aids = data.get("failed_aids", {})
                self._failed_aids = {
                    int(k): v for k, v in self._failed_aids.items()
                }
            except Exception:
                self._completed_aids = set()
                self._failed_aids = {}

        # 扫描已有目录，从 metadata.json 中提取 data_source_aid
        scanned = self._scan_completed_source_aids()
        if scanned:
            new_found = scanned - self._completed_aids
            if new_found:
                self._completed_aids |= scanned
                self._save_checkpoint()

        if self._completed_aids:
            print(f"[*] 站点断点: {len(self._completed_aids)} 本已完成, "
                  f"{len(self._failed_aids)} 本失败")

    def _scan_completed_source_aids(self) -> Set[int]:
        """从数据库查询已完成下载的源站 aid 集合"""
        try:
            from core.database import NovelDB
            db = NovelDB()
            result = db.get_all_source_aids()
            db.close()
            return result
        except Exception:
            return set()

    def _save_checkpoint(self):
        """保存站点级断点"""
        cp = self._checkpoint_file
        cp.write_text(
            json.dumps({
                "completed_aids": sorted(list(self._completed_aids)),
                "failed_aids": {str(k): v for k, v in self._failed_aids.items()},
                "updated_at": time.time(),
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def run_retry_failed(self):
        """批量重试下载失败的小说/章节

        从 crawl_progress 表查询所有存在 failed_source_cids 的小说，
        逐本调用 scraper（resume 模式自动重试失败章节）。

        与 --resume 的区别：
        - --resume：跳过已完成的小说，下载未开始的小说
        - --retry-failed：专门针对已有失败章节的小说，仅重试失败部分
        """
        print("=" * 60)
        print("  批量重试失败章节")
        print("=" * 60)
        print()

        # ── 从数据库查询有失败章节的小说 ──
        try:
            from core.database import NovelDB
            db = NovelDB()
            failed_novels: List[tuple] = []  # (source_aid, novel_id, failed_count)
            with db._conn.cursor() as cur:
                cur.execute("""
                    SELECT n.id, n.data_source_aid, n.title,
                           jsonb_array_length(cp.failed_source_cids) as fail_count
                    FROM crawl_progress cp
                    JOIN novels n ON cp.novel_id = n.id
                    WHERE jsonb_array_length(cp.failed_source_cids) > 0
                    ORDER BY n.id
                """)
                for row in cur.fetchall():
                    failed_novels.append(
                        (row["data_source_aid"], row["id"], row["title"], row["fail_count"])
                    )
            db.close()

            if not failed_novels:
                print("[*] 没有需要重试的失败章节，一切正常！")
                return

            total_fails = sum(f[3] for f in failed_novels)
            print(f"[*] 发现 {len(failed_novels)} 本小说存在失败章节（共 {total_fails} 章）")
            print()
            for _, nid, title, fc in failed_novels:
                print(f"  aid={nid}  失败{fc}章  {title[:40]}")
            print()

        except Exception as e:
            print(f"[X] 查询失败章节出错: {e}")
            return

        # ── 逐本重试 ──
        start_time = time.time()
        ok_count = 0
        still_failed_count = 0

        for i, (source_aid, novel_id, title, fail_count) in enumerate(failed_novels, 1):
            if i > 1:
                wait = self.delay_between_novels + random.uniform(-1.0, 1.0)
                time.sleep(max(1.0, wait))

            print(f"\n{'─' * 50}")
            print(f"  [{i}/{len(failed_novels)}] aid={novel_id}  失败{fail_count}章  {title[:40]}")
            print(f"{'─' * 50}")

            try:
                config = ScraperConfig(
                    aid=source_aid,
                    output_dir=str(self.output_dir),
                    delay_seconds=1.5,
                    concurrency=self.concurrency,
                    username=self._username,
                    password=self._password,
                )

                scraper = NovelScraper(config, self.cookies)
                success = scraper.run()

                # 检查重试后是否还有失败
                if scraper._novel_id > 0:
                    _, still_failed = scraper._db.get_crawl_progress(scraper._novel_id)
                    if still_failed:
                        still_failed_count += 1
                        print(f"  [!] 仍有 {len(still_failed)} 章失败")
                    else:
                        ok_count += 1
                        print(f"  [+] 全部失败章节已恢复")

            except Exception as e:
                still_failed_count += 1
                print(f"  [X] 重试异常: {e}")

            # 进度显示
            elapsed = time.time() - start_time
            remaining = len(failed_novels) - i
            eta = (elapsed / i) * remaining if i > 0 else 0
            print(f"  进度: {ok_count} OK / {still_failed_count} 仍失败  "
                  f"({self._format_time(elapsed)}/{self._format_time(eta)})")

        print()
        print("=" * 60)
        print(f"  重试完成！")
        print(f"  全部恢复: {ok_count} 本")
        if still_failed_count:
            print(f"  仍有失败: {still_failed_count} 本")
        print(f"  耗时: {self._format_time(time.time() - start_time)}")
        print("=" * 60)

    # ─── 工具 ───

    def _print_summary(self, total: int):
        """打印批量下载汇总"""
        print()
        print("=" * 60)
        print(f"  批量下载完成!")
        print(f"  索引总数: {total}")
        print(f"  已完成: {len(self._completed_aids)}")
        if self._failed_aids:
            print(f"  失败: {len(self._failed_aids)}")
            for aid, reason in self._failed_aids.items():
                print(f"    - aid={aid}: {reason}")
        print(f"  输出目录: {self.output_dir}")
        print("=" * 60)

    @staticmethod
    def _format_time(seconds: float) -> str:
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
        description="批量下载编排器 — 基于站点索引批量爬取小说",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python batch.py --top 10                              # 下载前10本
  python batch.py --tag 校园 --top 20                    # 按标签过滤
  python batch.py --status 已完结 --top 50               # 只下载已完结
  python batch.py --min-rating A --top 30                # 按最低评分筛选
  python batch.py --scan --min-rating S --top 20         # 先扫描元数据再筛选下载
  python batch.py --resume                               # 断点续爬
  python batch.py --retry-failed                          # 重试所有失败章节
  python batch.py --update                               # 增量模式
  python batch.py --aid 3057 --aid 1973                   # 指定aid
        """,
    )
    # 目标参数
    target = parser.add_argument_group("目标选择")
    target.add_argument("--index", default="novels/_site_index.json",
                        help="站点索引文件路径")
    target.add_argument("--aid", type=int, action="append", default=None,
                        help="指定 aid 下载（可多次使用）")
    target.add_argument("--top", type=int, default=None,
                        help="只下载前 N 本")

    # 过滤参数
    filt = parser.add_argument_group("过滤条件（需先有书页元数据）")
    filt.add_argument("--tag", action="append", default=None,
                      help="按标签过滤（可多次使用）")
    filt.add_argument("--status", default=None,
                      help="按状态过滤（已完结 / 连载中）")
    filt.add_argument("--min-rating", default=None,
                      help="最低评级（S/A/B/C）")

    # 模式参数
    mode = parser.add_argument_group("模式")
    mode.add_argument("--resume", action="store_true",
                      help="断点续爬，跳过已完成的小说")
    mode.add_argument("--update", action="store_true",
                      help="增量更新：重新发现 + 下载新增")
    mode.add_argument("--scan", action="store_true",
                      help="下载前先扫描元数据：请求书页回填 site_novels 的 rating/tags/status")
    mode.add_argument("--retry-failed", action="store_true",
                      help="重试所有已下载但有失败章节的小说")

    # 行为参数
    behav = parser.add_argument_group("行为选项")
    behav.add_argument("--output-dir", "-o", default="novels",
                       help="小说输出根目录")
    behav.add_argument("--delay-novel", type=float, default=3.0,
                       help="小说间延迟秒数（默认3s）")
    behav.add_argument("--concurrent", "-j", type=int, default=1,
                       help="单本内部章节并发数（默认1=串行）")
    behav.add_argument("--use-db", dest="use_db", action="store_true", default=True,
                       help="优先从数据库加载站点索引（默认启用）")
    behav.add_argument("--no-use-db", dest="use_db", action="store_false",
                       help="仅从 JSON 文件加载，不使用数据库")
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
        print("[!] 警告: 未获取到登录凭证")

    # ── 元数据预扫描（--scan 模式）──
    if args.scan:
        print("=" * 60)
        print("  [--scan] 先扫描元数据（书页 → site_novels）")
        print("=" * 60)
        scan_target = args.top  # 如果用户指定了 --top，同步传递给扫描器
        scanner = MetadataScanner(
            cookies=cookies,
            output_dir=args.output_dir,
            concurrency=args.concurrent,
        )
        scanner.run(top=scan_target, resume=args.resume)
        print()

    # ── 编排器 ──
    batch = BatchScraper(
        output_dir=args.output_dir,
        cookies=cookies,
        delay_between_novels=args.delay_novel,
        concurrency=args.concurrent,
        username=args.username,
        password=args.password,
    )

    # ── 执行 ──
    if args.retry_failed:
        batch.run_retry_failed()
        return
    elif args.update:
        batch.run_update(index_path=args.index)
    else:
        batch.run_from_index(
            index_path=args.index,
            tags=args.tag,
            status_filter=args.status,
            min_rating=args.min_rating,
            top=args.top,
            aid_list=args.aid,
            resume=args.resume,
            use_database=args.use_db,
        )


if __name__ == "__main__":
    main()
