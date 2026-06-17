"""小说发现器 — 遍历排行榜/分类列表，提取全站小说索引

从 wenku8.net 的列表页提取所有小说的 aid + 书名，
保存为 JSON 索引文件供批量下载使用。

用法:
  python discover.py                              # 默认：最近更新排行
  python discover.py --source toplist             # 最近更新排行榜
  python discover.py --source articlelist          # 全部分类列表
  python discover.py --max-pages 10               # 只爬前10页（测试用）
  python discover.py --sort lastupdate             # 排序方式
  python discover.py --output novels/index.json    # 自定义输出路径
"""

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Set

# 导入项目内模块
from auth import resolve_cookies
from fetcher import PlaywrightFetcher


# ═══════════════════════════════════════════════════════════════
# 数据结构
# ═══════════════════════════════════════════════════════════════

class DiscoveredNovel:
    """发现的小说条目"""
    __slots__ = ('aid', 'title', 'url')

    def __init__(self, aid: int, title: str, url: str = ""):
        self.aid = aid
        self.title = title
        self.url = url or f"https://www.wenku8.net/book/{aid}.htm"

    def to_dict(self) -> Dict:
        return {"aid": self.aid, "title": self.title, "url": self.url}

    @classmethod
    def from_dict(cls, d: Dict) -> "DiscoveredNovel":
        return cls(aid=int(d["aid"]), title=d["title"], url=d.get("url", ""))


# ═══════════════════════════════════════════════════════════════
# 发现器
# ═══════════════════════════════════════════════════════════════

class NovelDiscoverer:
    """小说发现器

    遍历 wenku8.net 的列表页（排行榜/分类列表），
    提取所有小说 aid 和书名，保存为站点索引。
    """

    # wenku8 列表页基础 URL
    BASE_URL = "https://www.wenku8.net"

    # 小说链接正则：匹配 /book/{aid}.htm 及其后紧跟的书名文本
    _BOOK_LINK_RE = re.compile(
        r'<a\s+[^>]*href\s*=\s*"/book/(\d+)\.htm"[^>]*>(.*?)</a>',
        re.IGNORECASE,
    )

    def __init__(self, cookies: Optional[Dict[str, str]] = None, timeout: int = 30):
        """
        Args:
            cookies: 登录 cookie 字典（访问列表页需要）
            timeout: 每个页面请求的超时秒数
        """
        self.cookies = cookies or {}
        self.timeout = timeout

    # ─── 公共方法 ───

    def discover_from_toplist(
        self,
        sort: str = "lastupdate",
        max_pages: Optional[int] = None,
    ) -> List[DiscoveredNovel]:
        """从最近更新排行榜发现小说

        遍历 toplist.php?sort={sort}&page={N}，直到无更多页面。

        Args:
            sort: 排序方式（lastupdate / postdate / hits / size 等）
            max_pages: 最大页数限制（None = 自动检测末尾）

        Returns:
            去重后的小说列表
        """
        print(f"[*] 发现来源: 排行榜 (sort={sort})")
        if max_pages:
            print(f"[*] 限制: 最多 {max_pages} 页")
        print()

        return asyncio.run(self._discover_paginated(
            f"{self.BASE_URL}/modules/article/toplist.php",
            {"sort": sort},
            max_pages,
        ))

    def discover_from_articlelist(
        self,
        max_pages: Optional[int] = None,
    ) -> List[DiscoveredNovel]:
        """从全部分类列表发现小说

        Args:
            max_pages: 最大页数限制

        Returns:
            去重后的小说列表
        """
        print(f"[*] 发现来源: 全部分类列表")
        if max_pages:
            print(f"[*] 限制: 最多 {max_pages} 页")
        print()

        return asyncio.run(self._discover_paginated(
            f"{self.BASE_URL}/modules/article/articlelist.php",
            {},
            max_pages,
        ))

    # ─── 私有方法 ───

    async def _discover_paginated(
        self,
        base_url: str,
        base_params: Dict[str, str],
        max_pages: Optional[int],
    ) -> List[DiscoveredNovel]:
        """遍历分页列表，提取所有小说链接"""
        seen: Set[int] = set()
        novels: List[DiscoveredNovel] = []

        page = 1
        empty_streak = 0  # 连续空页计数

        while True:
            if max_pages and page > max_pages:
                break

            # 构建 URL
            params = {**base_params, "page": str(page)}
            query = "&".join(f"{k}={v}" for k, v in params.items())
            url = f"{base_url}?{query}"

            # 获取页面
            html = await self._fetch_page(url)
            if not html:
                print(f"  [!] 第{page}页 获取失败，跳过")
                page += 1
                continue

            # 提取小说链接
            found = self._extract_novels(html)
            new_count = 0
            for novel in found:
                if novel.aid not in seen:
                    seen.add(novel.aid)
                    novels.append(novel)
                    new_count += 1

            print(f"  第{page}页: 发现 {len(found)} 本 (新增 {new_count} 本)")

            if len(found) == 0:
                empty_streak += 1
                if empty_streak >= 2:
                    print(f"  连续 {empty_streak} 页为空，已达列表末尾")
                    break
            else:
                empty_streak = 0

            page += 1

            # 页间延迟（避免触发反爬）
            await asyncio.sleep(0.3)

        print()
        print(f"[+] 发现完成: 共 {len(novels)} 本小说")
        return novels

    def _extract_novels(self, html: str) -> List[DiscoveredNovel]:
        """从列表页 HTML 中提取小说链接

        列表页中每本小说通常有两个链接：
        - <a href="/book/{aid}.htm">书名</a>
        - <a href="/book/{aid}.htm">我要阅读</a>

        取第一个（书名链接），跳过"我要阅读"。
        """
        novels = []
        seen_in_page: Set[int] = set()

        for m in self._BOOK_LINK_RE.finditer(html):
            aid = int(m.group(1))
            text = m.group(2).strip()

            # 跳过已处理过的 aid（同一页可能重复出现）
            if aid in seen_in_page:
                continue

            # 跳过"我要阅读"链接（取书名链接）
            if text in ("我要阅读", "詳細", "详细"):
                continue

            seen_in_page.add(aid)
            novels.append(DiscoveredNovel(
                aid=aid,
                title=text,
                url=f"{self.BASE_URL}/book/{aid}.htm",
            ))

        return novels

    async def _fetch_page(self, url: str, retries: int = 2) -> Optional[str]:
        """获取页面 HTML（带重试）"""
        for attempt in range(retries + 1):
            try:
                fetcher = PlaywrightFetcher(
                    cookies=self.cookies,
                    timeout=self.timeout,
                )
                result = await fetcher.fetch(url)
                if result.status_code == 200:
                    return result.html
                elif result.status_code == 403:
                    if attempt < retries:
                        await asyncio.sleep(2 ** attempt)
                    continue
                else:
                    if attempt < retries:
                        await asyncio.sleep(2 ** attempt)
                    continue
            except Exception:
                if attempt < retries:
                    await asyncio.sleep(2 ** attempt)
                else:
                    return None
        return None

    # ─── 静态方法 ───

    @staticmethod
    def save_index(novels: List[DiscoveredNovel], path: str = "novels/_site_index.json"):
        """保存站点索引为 JSON 文件"""
        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)

        data = {
            "source": "wenku8.net",
            "discovered_at": time.time(),
            "total": len(novels),
            "novels": [n.to_dict() for n in novels],
        }

        out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[+] 索引已保存: {out} ({len(novels)} 本)")

    @staticmethod
    def load_index(path: str = "novels/_site_index.json") -> List[DiscoveredNovel]:
        """从 JSON 文件加载站点索引"""
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        return [DiscoveredNovel.from_dict(d) for d in data.get("novels", [])]


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="小说发现器 — 遍历 wenku8 列表页提取全站小说索引",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python discover.py                              # 最近更新排行榜，全量
  python discover.py --max-pages 10               # 仅前10页（测试）
  python discover.py --source articlelist          # 全部分类列表
  python discover.py --output novels/index.json    # 自定义输出
        """,
    )
    parser.add_argument("--source", default="toplist",
                        choices=["toplist", "articlelist"],
                        help="发现来源（默认 toplist）")
    parser.add_argument("--sort", default="lastupdate",
                        help="排序方式（仅 toplist，默认 lastupdate）")
    parser.add_argument("--max-pages", type=int, default=None,
                        help="最大爬取页数（默认自动检测）")
    parser.add_argument("--output", "-o", default="novels/_site_index.json",
                        help="输出索引文件路径")
    # 认证参数（可选，优先用缓存）
    parser.add_argument("--username", "-u", default="", help="用户名")
    parser.add_argument("--password", "-p", default="", help="密码")
    parser.add_argument("--cookie", "-c", default="", help="Cookie 字符串")

    args = parser.parse_args()

    # ── 认证 ──
    cookies = resolve_cookies(
        username=args.username,
        password=args.password,
        cookie_string=args.cookie,
    )
    if not cookies:
        print("[!] 警告: 未获取到登录凭证，列表页可能无法访问")
        cookies = {}

    # ── 发现 ──
    discoverer = NovelDiscoverer(cookies=cookies)

    start = time.time()
    if args.source == "toplist":
        novels = discoverer.discover_from_toplist(
            sort=args.sort,
            max_pages=args.max_pages,
        )
    else:
        novels = discoverer.discover_from_articlelist(
            max_pages=args.max_pages,
        )

    elapsed = time.time() - start
    print(f"[*] 耗时: {elapsed:.1f}s")

    # ── 保存 ──
    if novels:
        NovelDiscoverer.save_index(novels, args.output)
    else:
        print("[X] 未发现任何小说")
        sys.exit(1)


if __name__ == "__main__":
    main()
