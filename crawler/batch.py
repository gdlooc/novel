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

# 导入项目内模块
from auth import resolve_cookies
from scraper import NovelScraper, ScraperConfig
from discover import NovelDiscoverer, DiscoveredNovel


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
    ):
        """
        Args:
            output_dir: 小说输出根目录
            cookies: 登录 cookie 字典
            delay_between_novels: 小说间延迟秒数（含随机抖动）
            concurrency: 单本小说内部的章节并发数（传给 NovelScraper）
        """
        self.output_dir = Path(output_dir)
        self.cookies = cookies or {}
        self.delay_between_novels = delay_between_novels
        self.concurrency = concurrency

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
        """
        # ── 确定待下载列表 ──
        if aid_list:
            novels = [
                DiscoveredNovel(aid=aid, title=f"aid_{aid}")
                for aid in aid_list
            ]
            print(f"[*] 指定 aid 列表: {len(novels)} 本")
        else:
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
                )

                scraper = NovelScraper(config, self.cookies)
                success = scraper.run()

                if success:
                    self._completed_aids.add(novel.aid)
                    if scraper._failed_cids:
                        self._failed_aids[novel.aid] = (
                            f"部分章节失败: {scraper._failed_cids}"
                        )
                else:
                    self._failed_aids[novel.aid] = "爬取流程失败"

            except Exception as e:
                self._failed_aids[novel.aid] = str(e)
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

        filtered = []
        for novel in novels:
            meta = meta_cache.get(novel.aid)

            if meta:
                # 有元数据 → 精确过滤
                if status_filter and meta.get("status") != status_filter:
                    continue
                if min_rating and meta.get("rating", "Z") > min_rating:
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
            from database import NovelDB
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
  python batch.py --resume                               # 断点续爬
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

    # 行为参数
    behav = parser.add_argument_group("行为选项")
    behav.add_argument("--output-dir", "-o", default="novels",
                       help="小说输出根目录")
    behav.add_argument("--delay-novel", type=float, default=3.0,
                       help="小说间延迟秒数（默认3s）")
    behav.add_argument("--concurrent", "-j", type=int, default=1,
                       help="单本内部章节并发数（默认1=串行）")
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

    # ── 编排器 ──
    batch = BatchScraper(
        output_dir=args.output_dir,
        cookies=cookies,
        delay_between_novels=args.delay_novel,
        concurrency=args.concurrent,
    )

    # ── 执行 ──
    if args.update:
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
        )


if __name__ == "__main__":
    main()
