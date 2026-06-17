"""小说章节正文解析器

解析 /novel/{group}/{aid}/{cid}.htm 页面，提取：
- 章节标题
- 正文内容（去除头尾固定文字）
- 插图 URL 列表（如章节含插图）
- JS 导航变量（上一章/下一章 cid）

章节页 HTML 特征:
<script>
var preview_page = "175993.htm";   // 上一章（空则已是第一章）
var next_page = "69567.htm";       // 下一章（空则已是最后一章）
var index_page = "index.htm";      // 回目录
var article_id = "1973";           // 小说 aid
var chapter_id = "0";              // 当前章节 cid
</script>
<body>
... 正文内容（<br/><br/> 分隔段落，可能包含 div.divimage 插图）...
</body>
"""

import copy
import re
from pathlib import Path
from typing import Dict, List, Optional

from bs4 import BeautifulSoup


# 正文前后需要清理的固定文字
# 这些是网站在正文前后插入的版权/推广信息
FIXED_PREFIX_PATTERNS = [
    re.compile(r"本文来自\s*轻小说文库\s*\(http://www\.wenku8\.com\)"),
    re.compile(r"轻小说文库\s*\(http://www\.wenku8\.com\)"),
]
FIXED_SUFFIX_PATTERNS = [
    re.compile(r"最新最全的日本动漫轻小说\s*轻小说文库\s*\(http://www\.wenku8\.com\)\s*为你一网打尽！"),
    re.compile(r"最新最全的日本动漫轻小说.*为你一网打尽！"),
]

# 插图图片 CDN 域名（用于过滤广告图片）
ILLUSTRATION_CDN_DOMAINS = {"pic.777743.xyz"}


class ChapterParser:
    """解析章节正文页，提取净化后的文本内容"""

    # ---------- 构造函数 ----------

    def __init__(self, html: str, base_url: str = ""):
        """
        Args:
            html: 章节页 HTML 文本（GBK 解码后的 unicode 字符串）
            base_url: 页面完整 URL，用于计算章节 URL
        """
        self.html = html
        self.base_url = base_url
        self.soup = BeautifulSoup(html, "lxml")

        # 从 URL 中提取 aid 和 group（如果有 base_url）
        self._aid = ""
        if base_url:
            self._aid = self._extract_aid_from_url(base_url)

    # ---------- 公共方法 ----------

    def parse(self) -> Dict:
        """执行完整解析，返回结构化数据

        Returns:
            {
                "cid": 175993,
                "aid": 1973,
                "title": "第二十七卷...",
                "book_title": "欢迎来到实力至上主义的教室",
                "content": "在离开小组之前...",    # 净化后的正文（含 [插图: xxx] 标记）
                "images": [{"url": "...", "filename": "84737.jpeg", "index": 0}, ...],
                "has_images": True,
                "prev_cid": "175993",
                "next_cid": "69567",
                "index_url": "",
            }
        """
        nav = self._extract_navigation()

        # 重要：先提取图片 URL（只读），再提取正文（会修改 DOM）
        images = self._extract_images()
        content = self._extract_content()

        return {
            "cid": self._extract_cid(),
            "aid": nav.get("article_id", self._aid),
            "title": self._extract_chapter_title(),
            "book_title": self._extract_book_title(),
            "content": content,
            "images": images,
            "has_images": len(images) > 0,
            "prev_cid": nav.get("preview_page", ""),
            "next_cid": nav.get("next_page", ""),
            "index_url": nav.get("index_url", ""),
        }

    def to_json(self, filepath: str):
        """解析并输出为 JSON 文件"""
        import json
        result = self.parse()
        Path(filepath).write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return result

    def to_text(self) -> str:
        """解析并返回纯文本格式（章节标题 + 正文）"""
        result = self.parse()
        lines = [result["title"], "", result["content"]]
        return "\n".join(lines)

    # ---------- 私有方法：提取基本信息 ----------

    def _extract_chapter_title(self) -> str:
        """从页面提取章节标题

        策略（按优先级）:
        1. <title> 中第一个 - 之前的部分
        2. #title 元素
        3. <h1> 第一个
        """
        # 页面 <title> 格式: "章节名-书名-文库-轻小说文库"
        page_title = self.soup.find("title")
        if page_title:
            full = page_title.get_text(strip=True)
            # 取第一个 - 之前的部分
            return full.split("-")[0].strip()

        # 兜底
        title_el = self.soup.select_one("#title")
        if title_el:
            return title_el.get_text(strip=True)
        h1 = self.soup.find("h1")
        if h1:
            return h1.get_text(strip=True)
        return ""

    def _extract_book_title(self) -> str:
        """从页面标题提取所属书名"""
        page_title = self.soup.find("title")
        if page_title:
            parts = page_title.get_text(strip=True).split("-")
            # <title> 格式: "章节名-书名-文库-轻小说文库"
            if len(parts) >= 2:
                return parts[1].strip()
        return ""

    def _extract_cid(self) -> int:
        """提取当前章节 ID

        策略:
        1. 从 JS 变量 chapter_id
        2. 从 base_url 中提取
        """
        # 从 JS 变量
        nav = self._extract_navigation()
        cid = nav.get("chapter_id", "")
        if cid and cid != "0":  # 排除目录页的 chapter_id=0
            try:
                return int(cid)
            except ValueError:
                pass

        # 从 URL 中提取
        if self.base_url:
            m = re.search(r"/(\d+)\.htm", self.base_url)
            if m:
                return int(m.group(1))
        return 0

    # ---------- 私有方法：提取 JS 导航变量 ----------

    def _extract_navigation(self) -> Dict[str, str]:
        """从 <script> 中提取 JS 导航变量

        解析如下 JavaScript:
        var preview_page = "175993.htm";   // 上一章文件名
        var next_page = "69567.htm";       // 下一章文件名
        var index_page = "index.htm";      // 目录页文件名
        var article_id = "1973";           // 小说 aid
        var chapter_id = "0";              // 当前章节 cid

        Returns:
            {
                "preview_page": "175993",
                "next_page": "69567",
                "index_page": "index",
                "article_id": "1973",
                "chapter_id": "0",
                "index_url": "https://www.wenku8.net/novel/1/1973/index.htm"
            }
        """
        result = {}
        # 匹配 var xxx = "yyy"; 格式
        for match in re.finditer(
            r'var\s+(\w+)\s*=\s*"([^"]*)";',
            self.html,
        ):
            key = match.group(1)
            value = match.group(2)
            # 去掉 .htm 后缀，只保留纯数字（或 index）
            if value.endswith(".htm"):
                value = value[:-4]
            result[key] = value

        # 计算目录页的完整 URL
        if result.get("index_page") and self.base_url:
            from urllib.parse import urljoin
            result["index_url"] = urljoin(
                self.base_url, result["index_page"] + ".htm"
            )

        return result

    # ---------- 私有方法：提取插图 ----------

    @staticmethod
    def _is_illustration_url(url: str) -> bool:
        """判断 URL 是否为插图（过滤广告图片）"""
        if not url:
            return False
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        return domain in ILLUSTRATION_CDN_DOMAINS

    def _extract_images(self) -> List[Dict]:
        """从 #content 中提取插图 URL 列表

        插图结构:
        <div id="content">
            <div class="divimage">
                <a href="https://pic.777743.xyz/.../84737.jpeg" target="_blank">
                    <img src="https://pic.777743.xyz/.../84737.jpeg"
                         border="0" class="imagecontent">
                </a>
            </div>
            ...
        </div>

        Returns:
            [{"url": "https://pic.777743.xyz/.../84737.jpeg",
              "filename": "84737.jpeg",
              "index": 0}, ...]
        """
        content_div = self.soup.find("div", id="content")
        if not content_div:
            return []

        images = []
        for div_img in content_div.find_all("div", class_="divimage"):
            img = div_img.find("img")
            if not img:
                continue
            src = img.get("src", "").strip()
            if not src:
                continue
            # 过滤广告图片
            if not self._is_illustration_url(src):
                continue
            filename = src.rstrip("/").split("/")[-1] if src else ""
            if filename:
                images.append({
                    "url": src,
                    "filename": filename,
                    "index": len(images),
                })

        return images

    # ---------- 私有方法：提取正文 ----------

    def _extract_content(self) -> str:
        """提取并净化正文内容，保留插图位置标记

        处理步骤:
        1. 定位 #content div（内容区域，比 body 更干净）
        2. 移除版权声明元素 (ul#contentdp)
        3. 将 div.divimage 替换为文本标记 [插图: filename]
        4. 将 <br> 替换为换行
        5. 获取文本
        6. 清理固定前缀/后缀
        7. 清理多余空白
        """
        # 定位内容区域：优先使用 #content div
        content_div = self.soup.find("div", id="content")
        if not content_div:
            # 兜底：使用 body
            content_div = self.soup.find("body")
            if not content_div:
                return ""

        # 深拷贝 DOM 片段，避免影响 _extract_images()（已先调用）
        import copy
        working = copy.deepcopy(content_div)

        # Step 1: 移除版权声明 (ul#contentdp)
        for dp in working.find_all("ul", id="contentdp"):
            dp.decompose()

        # Step 2: 将 divimage 替换为文本标记
        for div_img in working.find_all("div", class_="divimage"):
            img = div_img.find("img")
            if img and self._is_illustration_url(img.get("src", "")):
                filename = img.get("src", "").rstrip("/").split("/")[-1]
                div_img.replace_with(f"\n[插图: {filename}]\n")
            else:
                # 非插图图片（广告等），直接移除
                div_img.decompose()

        # Step 3: 将 <br> 替换为换行
        for br in working.find_all("br"):
            br.replace_with("\n")

        # Step 4: 获取文本
        text = working.get_text()

        # Step 5: 清理 &nbsp; (\xa0)
        text = text.replace("\xa0", "")

        # Step 6: 去除固定前缀/后缀（兜底清理）
        for pattern in FIXED_PREFIX_PATTERNS:
            text = pattern.sub("", text, count=1)
        for pattern in FIXED_SUFFIX_PATTERNS:
            text = pattern.sub("", text, count=1)

        # Step 7: 清理多余空白
        text = re.sub(r"\n{3,}", "\n\n", text)   # 连续 3+ 换行 → 2 个
        text = re.sub(r" {2,}", " ", text)        # 连续空格压缩
        text = text.strip()

        return text

    # ---------- 静态工具方法 ----------

    @staticmethod
    def _extract_aid_from_url(url: str) -> str:
        """从 URL 中提取 aid

        /novel/1/1973/index.htm → 1973
        /novel/4/4282/175969.htm → 4282
        """
        m = re.search(r"/novel/\d+/(\d+)/", url)
        if m:
            return m.group(1)
        return ""


# ==================== 便捷函数 ====================

def parse_chapter_html(html: str, base_url: str = "") -> Dict:
    """便捷函数：直接解析章节页 HTML 字符串"""
    return ChapterParser(html, base_url).parse()


def parse_chapter_file(filepath: str, base_url: str = "") -> Dict:
    """便捷函数：从文件读取并解析章节页"""
    html = Path(filepath).read_text(encoding="utf-8")
    return ChapterParser(html, base_url).parse()
