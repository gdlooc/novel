"""小说数据导出器

将爬取的章节数据导出为不同格式:
- TXT: 合并全文（按卷/章结构）
- JSON: 结构化数据
- EPUB: 电子书（可选，需额外安装 ebooklib）

用法:
  python exporter.py novels/aid_1973/ --format txt
  python exporter.py novels/aid_1973/ --format json
  python exporter.py novels/aid_1973/ --format all
"""

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional


class NovelExporter:
    """小说数据导出器

    读取 NovelScraper 输出目录，导出为不同格式。

    目录结构要求（由 NovelScraper 生成）:
    novels/aid_1973/
      metadata.json          ← 书名、作者等
      chapters.json          ← 章节列表 [{cid, volume, title, url, completed}, ...]
      chapters/
        {cid}.txt            ← 单章正文
        {cid}.json           ← 单章完整数据
    """

    # ---------- 构造函数 ----------

    def __init__(self, novel_dir: str):
        """
        Args:
            novel_dir: 小说数据目录路径（由 NovelScraper 生成）
        """
        self.novel_dir = Path(novel_dir)
        if not self.novel_dir.exists():
            raise FileNotFoundError(f"目录不存在: {novel_dir}")

        # 加载元数据
        self.metadata = self._load_json("metadata.json")
        self.chapters_list = self._load_json("chapters.json")

        self.title = self.metadata.get("title", self.novel_dir.name)
        self.author = self.metadata.get("author", "未知")

        # 计算统计信息
        self.total = len(self.chapters_list)
        self.completed = sum(1 for c in self.chapters_list if c.get("completed"))

        print(f"[*] 加载小说: {self.title}")
        print(f"    作者: {self.author}")
        print(f"    章节: {self.completed}/{self.total} 已完成")

    # ---------- 公共导出方法 ----------

    def export_txt(
        self,
        output_path: Optional[str] = None,
        split_by_volume: bool = False,
    ):
        """导出为 TXT 文本文件

        Args:
            output_path: 输出文件路径
                - split_by_volume=True 时作为输出目录（None=novel_dir）
                - split_by_volume=False 时作为输出文件（None=自动命名）
            split_by_volume: True=每卷一个文件，False=合并为单文件
        """
        chapters_dir = self.novel_dir / "chapters"

        if split_by_volume:
            return self._export_txt_by_volume(output_path or str(self.novel_dir))
        else:
            return self._export_txt_merged(output_path, chapters_dir)

    def _export_txt_merged(self, output_path: Optional[str], chapters_dir: Path) -> str:
        """导出为合并的单文件"""
        if output_path is None:
            output_path = str(self.novel_dir / f"{self._safe_filename(self.title)}.txt")

        print(f"[*] 导出 TXT（合并） → {output_path}")

        sections = []
        current_volume = None
        for ch in self.chapters_list:
            if not ch.get("completed"):
                continue

            vol = ch.get("volume", "")
            cid = ch["cid"]

            # 卷分隔符
            if vol and vol != current_volume:
                current_volume = vol
                sections.append(f"\n{'='*60}")
                sections.append(f"  {vol}")
                sections.append(f"{'='*60}\n")

            txt_file = chapters_dir / f"{cid}.txt"
            if txt_file.exists():
                content = txt_file.read_text(encoding="utf-8")
                sections.append(content)
                sections.append("")

        full_text = "\n".join(sections)
        Path(output_path).write_text(full_text, encoding="utf-8")

        print(f"[+] 已导出: {output_path}")
        print(f"    总字数: {len(full_text):,}")
        return output_path

    def _export_txt_by_volume(self, output_dir: str) -> List[str]:
        """导出为按卷分文件

        生成文件命名: {卷序号:02d}_{卷名}.txt
        例: 01_第一卷.txt, 02_第二卷.txt
        """
        print(f"[*] 导出 TXT（分卷） → {output_dir}/")

        chapters_dir = self.novel_dir / "chapters"
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)

        # 按卷分组
        volumes: Dict[str, List[Dict]] = {}
        vol_order = []  # 保持卷顺序
        for ch in self.chapters_list:
            if not ch.get("completed"):
                continue
            vol = ch.get("volume", "正文")
            if vol not in volumes:
                volumes[vol] = []
                vol_order.append(vol)
            volumes[vol].append(ch)

        saved_files = []
        total_chars = 0

        for idx, vol_name in enumerate(vol_order, 1):
            chapters = volumes[vol_name]

            # 构建卷文件内容
            lines = [f"{vol_name}", f"{'='*40}", ""]
            for ch in chapters:
                txt_file = chapters_dir / f"{ch['cid']}.txt"
                if txt_file.exists():
                    content = txt_file.read_text(encoding="utf-8")
                    lines.append(content)
                    lines.append("")

            vol_text = "\n".join(lines)

            # 安全文件名: 序号_卷名.txt
            safe_vol = self._safe_filename(vol_name)
            vol_file = out / f"{idx:02d}_{safe_vol}.txt"
            vol_file.write_text(vol_text, encoding="utf-8")
            saved_files.append(str(vol_file))
            total_chars += len(vol_text)

            print(f"    [{idx:02d}] {vol_name}  ({len(chapters)}章, {len(vol_text):,}字) → {vol_file.name}")

        print(f"[+] 已导出 {len(saved_files)} 卷, 总字数: {total_chars:,}")
        return saved_files

    def export_json(self, output_path: Optional[str] = None, include_content: bool = True):
        """导出为 JSON 结构化数据

        Args:
            output_path: 输出文件路径
            include_content: 是否包含章节正文（False 则只含元数据）
        """
        if output_path is None:
            output_path = str(self.novel_dir / f"{self._safe_filename(self.title)}.json")

        print(f"[*] 导出 JSON → {output_path}")

        result = {
            "meta": {
                "aid": self.metadata.get("aid"),
                "title": self.title,
                "author": self.author,
                "total_chapters": self.total,
                "completed_chapters": self.completed,
            },
            "volumes": self._build_volume_structure(include_content),
        }

        Path(output_path).write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        print(f"[+] 已导出: {output_path}")
        return output_path

    # 插图标记正则: [插图: filename]
    _ILLUSTRATION_MARKER = re.compile(r'\[插图:\s*([^\]]+)\]')

    def export_epub(self, output_path: Optional[str] = None):
        """导出为 EPUB 电子书

        需要安装: pip install ebooklib

        支持:
        - 嵌入章节插图（从 images/{cid}/ 目录加载）
        - 嵌入封面图（从 metadata.json 的 cover_url 下载）

        Args:
            output_path: 输出文件路径
        """
        try:
            from ebooklib import epub
        except ImportError:
            print("[X] 需要安装 ebooklib: pip install ebooklib")
            return None

        if output_path is None:
            output_path = str(self.novel_dir / f"{self._safe_filename(self.title)}.epub")

        print(f"[*] 导出 EPUB → {output_path}")

        book = epub.EpubBook()
        local_aid = self.metadata.get("aid", 0)
        book.set_identifier(f"novel_aid_{local_aid}")
        book.set_title(self.title)
        book.set_language("zh")
        book.add_author(self.author)

        # --- 封面图 ---
        self._add_cover_image(book)

        # 章节列表
        chapters_dir = self.novel_dir / "chapters"
        epub_chapters = []
        spine = ["nav"]
        total_images = 0

        for ch in self.chapters_list:
            if not ch.get("completed"):
                continue

            cid = ch["cid"]
            txt_file = chapters_dir / f"{cid}.txt"
            if not txt_file.exists():
                continue

            content = txt_file.read_text(encoding="utf-8")

            # 处理插图标记，嵌入图片
            content, embedded_count = self._embed_images_in_html(
                book, content, cid
            )
            total_images += embedded_count

            # 将内容转为 HTML 段落
            html_content = "<html><body>"
            # 添加章节标题
            html_content += f"<h2>{ch.get('title', '')}</h2>"
            for line in content.split("\n"):
                line = line.strip()
                if not line:
                    continue
                # 插图标记被替换为 <img> 标签
                if line.startswith("<div") and "img" in line:
                    html_content += line
                else:
                    html_content += f"<p>{line}</p>"
            html_content += "</body></html>"

            chapter = epub.EpubHtml(
                title=ch.get("title", f"cid_{cid}"),
                file_name=f"chapter_{cid}.xhtml",
                lang="zh",
            )
            chapter.content = html_content
            book.add_item(chapter)
            epub_chapters.append(chapter)
            spine.append(chapter)

        # 目录
        book.toc = epub_chapters
        book.add_item(epub.EpubNcx())
        book.add_item(epub.EpubNav())
        book.spine = spine

        epub.write_epub(output_path, book)
        print(f"[+] 已导出: {output_path}  (嵌入 {total_images} 张图片)")
        return output_path

    def _embed_images_in_html(self, book, content: str, cid: int) -> tuple:
        """替换内容中的 [插图: filename] 为 <img> 标签，并将图片嵌入 EPUB

        Args:
            book: epub.EpubBook 实例
            content: 章节文本内容
            cid: 章节 ID

        Returns:
            (处理后的内容, 嵌入的图片数量)
        """
        images_dir = self.novel_dir / "images" / str(cid)
        count = 0

        def replace_marker(match):
            nonlocal count
            filename = match.group(1).strip()
            img_path = images_dir / filename

            if img_path.exists():
                # 创建 EPUB 图片项
                img_item_name = f"img_{cid}_{filename}"
                try:
                    with open(img_path, "rb") as f:
                        img_data = f.read()
                    from ebooklib import epub
                    # 确定 MIME 类型
                    ext = filename.rsplit(".", 1)[-1].lower()
                    mime_map = {
                        "jpg": "image/jpeg", "jpeg": "image/jpeg",
                        "png": "image/png", "gif": "image/gif",
                        "webp": "image/webp",
                    }
                    mime = mime_map.get(ext, "image/jpeg")
                    img_item = epub.EpubImage()
                    img_item.file_name = img_item_name
                    img_item.media_type = mime
                    img_item.content = img_data
                    book.add_item(img_item)
                    count += 1
                    return (
                        f'<div class="illustration">'
                        f'<img src="{img_item_name}" alt="{filename}"/>'
                        f'</div>'
                    )
                except Exception as e:
                    print(f"\n  [!] 嵌入图片 {filename} 失败: {e}")
                    return match.group(0)  # 保留原始标记
            else:
                # 图片文件不存在，保留标记
                return match.group(0)

        result = self._ILLUSTRATION_MARKER.sub(replace_marker, content)
        return result, count

    def _add_cover_image(self, book):
        """尝试添加封面图到 EPUB"""
        cover_url = self.metadata.get("cover_url", "")
        if not cover_url:
            return

        # 检查是否已经下载了封面
        cover_file = self.novel_dir / "cover.jpg"
        if not cover_file.exists():
            # 尝试下载封面
            try:
                import requests
                resp = requests.get(cover_url, timeout=15)
                if resp.status_code == 200:
                    cover_file.write_bytes(resp.content)
                    print(f"  [*] 封面图已下载")
                else:
                    return
            except Exception:
                return

        try:
            from ebooklib import epub
            book.set_cover(
                "cover.jpg",
                cover_file.read_bytes(),
            )
            print(f"  [*] 封面图已嵌入")
        except Exception as e:
            # 封面嵌入失败不阻塞
            pass

    def export_all(self, split_by_volume: bool = False):
        """导出所有格式（TXT + JSON）"""
        self.export_txt(split_by_volume=split_by_volume)
        self.export_json()

    # ---------- 私有方法 ----------

    def _load_json(self, filename: str) -> dict:
        """加载 JSON 文件"""
        path = self.novel_dir / filename
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        return {} if filename == "metadata.json" else []

    def _build_volume_structure(self, include_content: bool) -> List[Dict]:
        """构建分卷结构"""
        chapters_dir = self.novel_dir / "chapters"
        volumes = []
        current_vol = None

        for ch in self.chapters_list:
            if not ch.get("completed"):
                continue

            vol_name = ch.get("volume", "")
            if vol_name != current_vol:
                current_vol = vol_name
                volumes.append({"name": vol_name, "chapters": []})

            cid = ch["cid"]
            chapter_data = {
                "cid": cid,
                "title": ch["title"],
            }

            if include_content:
                txt_file = chapters_dir / f"{cid}.txt"
                if txt_file.exists():
                    content = txt_file.read_text(encoding="utf-8")
                    # 去除标题行（txt 第一行是标题）
                    lines = content.split("\n", 1)
                    chapter_data["content"] = lines[1].strip() if len(lines) > 1 else content.strip()

            # 加载图片元数据
            images_file = chapters_dir / f"{cid}_images.json"
            if images_file.exists():
                chapter_data["images"] = json.loads(
                    images_file.read_text(encoding="utf-8")
                )

            volumes[-1]["chapters"].append(chapter_data)

        return volumes

    @staticmethod
    def _safe_filename(name: str) -> str:
        """生成安全的文件名（去除特殊字符）"""
        import re
        # 保留中文、字母、数字、空格、常用符号
        safe = re.sub(r'[<>:"/\\|?*]', "_", name)
        # 限制长度
        if len(safe) > 80:
            safe = safe[:80]
        return safe.strip()


# ==================== CLI 入口 ====================

def main():
    parser = argparse.ArgumentParser(
        description="小说数据导出器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python exporter.py novels/aid_1973/ --format txt                       # 合并导出单文件
  python exporter.py novels/aid_1973/ --format txt --split-by-volume     # 每卷一个文件
  python exporter.py novels/aid_1973/ --format json
  python exporter.py novels/aid_1973/ --format epub
  python exporter.py novels/aid_1973/ --format all --split-by-volume
  python exporter.py novels/aid_1973/ --format txt --output 书名.txt
        """,
    )
    parser.add_argument("novel_dir", help="小说数据目录")
    parser.add_argument("--format", "-f", default="txt",
                        choices=["txt", "json", "epub", "all"],
                        help="输出格式")
    parser.add_argument("--output", "-o", default=None,
                        help="输出文件路径（可选）")
    parser.add_argument("--split-by-volume", action="store_true",
                        help="按卷分文件导出（仅 txt 格式生效）")

    args = parser.parse_args()

    try:
        exporter = NovelExporter(args.novel_dir)

        if args.format == "txt":
            exporter.export_txt(args.output, split_by_volume=args.split_by_volume)
        elif args.format == "json":
            exporter.export_json(args.output)
        elif args.format == "epub":
            exporter.export_epub(args.output)
        elif args.format == "all":
            exporter.export_all(split_by_volume=args.split_by_volume)

    except FileNotFoundError as e:
        print(f"[X] {e}")
        sys.exit(1)
    except Exception as e:
        print(f"[X] 导出失败: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
