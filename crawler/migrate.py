"""数据迁移脚本 — 将旧格式爬虫输出转换为新 ID 体系

旧格式（v1）： 新格式（v2）：
  aid = 源站ID       aid = 本站ID（自动分配）
  cid = 源站章节ID   cid = 本站章节ID（从1递增）
  catalog_url        data_source_catalog_url
  book_url           data_source_book_url
  failed_cids        data_source_failed_cids
  prev_cid           data_source_prev_cid (+ prev_cid 本站翻译)
  next_cid           data_source_next_cid (+ next_cid 本站翻译)
  index_url          data_source_index_url
  url (chapters)     data_source_chapter_url

用法:
  python migrate.py novels/aid_3057
  python migrate.py novels/aid_3057 --dry-run     # 仅检查不写入
"""

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Dict, List

# 数据源信息（默认 wenku8）
DATA_SOURCE_ID = 1
DATA_SOURCE_NAME = "wenku8"


def assign_local_aid(output_dir: Path, old_dir: Path) -> int:
    """分配本站小说 ID"""
    max_aid = 0
    for d in output_dir.iterdir():
        if d.is_dir() and d.name.startswith("aid_") and d != old_dir:
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


def migrate_novel(novel_dir: str, dry_run: bool = False):
    """迁移一本小说的数据"""
    old_dir = Path(novel_dir)
    if not old_dir.exists():
        print(f"[X] 目录不存在: {novel_dir}")
        return

    # 读取旧元数据
    old_meta = json.loads((old_dir / "metadata.json").read_text(encoding="utf-8"))
    source_aid = old_meta.get("data_source_aid") or old_meta.get("aid", 0)

    # 检查是否已是新格式
    if old_meta.get("data_source") and old_meta.get("data_source_aid"):
        print(f"[*] aid_{old_meta.get('aid')} 已是新格式，跳过")
        return

    # 分配本地 aid
    local_aid = assign_local_aid(old_dir.parent, old_dir)
    new_dir = old_dir.parent / f"aid_{local_aid}"

    print(f"[*] 迁移: {old_dir.name} → {new_dir.name}")
    print(f"    源站 aid: {source_aid} → 本站 aid: {local_aid}")

    if dry_run:
        print("    [DRY RUN] 仅检查，不实际写入")
        return

    # 读取旧章节列表
    old_chapters = json.loads((old_dir / "chapters.json").read_text(encoding="utf-8"))
    old_chapters_dir = old_dir / "chapters"
    old_images_dir = old_dir / "images"

    # 建立源站 cid → 本站 cid 映射
    cid_map: Dict[int, int] = {}
    new_chapters_list: List[Dict] = []
    local_cid = 1

    for ch in old_chapters:
        source_cid = ch.get("data_source_cid") or ch.get("cid", 0)
        cid_map[source_cid] = local_cid

        new_chapters_list.append({
            "cid": local_cid,
            "data_source_cid": source_cid,
            "aid": local_aid,
            "data_source_aid": source_aid,
            "volume": ch.get("volume", ""),
            "title": ch.get("title", ""),
            "data_source_chapter_url": ch.get("data_source_chapter_url", ch.get("url", "")),
            "completed": ch.get("completed", False),
        })
        local_cid += 1

    # ── 写入新元数据 ──
    new_meta = {
        "aid": local_aid,
        "data_source": DATA_SOURCE_ID,
        "data_source_name": DATA_SOURCE_NAME,
        "data_source_aid": source_aid,
        "title": old_meta.get("title", ""),
        "author": old_meta.get("author", ""),
        "publisher": old_meta.get("publisher", ""),
        "status": old_meta.get("status", ""),
        "is_completed": old_meta.get("is_completed", False),
        "last_update": old_meta.get("last_update", ""),
        "word_count": old_meta.get("word_count", ""),
        "tags": old_meta.get("tags", []),
        "rating": old_meta.get("rating", ""),
        "description": old_meta.get("description", ""),
        "cover_url": old_meta.get("cover_url", ""),
        "total_chapters": old_meta.get("total_chapters", len(old_chapters)),
        "completed_chapters": old_meta.get("completed_chapters", len(old_chapters)),
        "failed_chapters": old_meta.get("failed_chapters", 0),
        "data_source_failed_cids": old_meta.get("data_source_failed_cids", old_meta.get("failed_cids", [])),
        "data_source_catalog_url": old_meta.get("data_source_catalog_url", old_meta.get("catalog_url", "")),
        "data_source_book_url": old_meta.get("data_source_book_url", old_meta.get("book_url", "")),
    }

    # ── 创建新目录并写入文件 ──
    new_dir.mkdir(parents=True, exist_ok=True)
    new_chapters_dir = new_dir / "chapters"
    new_chapters_dir.mkdir(parents=True, exist_ok=True)
    new_images_dir = new_dir / "images"
    new_images_dir.mkdir(parents=True, exist_ok=True)

    # 写入 metadata.json
    (new_dir / "metadata.json").write_text(
        json.dumps(new_meta, ensure_ascii=False, indent=2), encoding="utf-8")

    # 迁移章节文件
    for ch_data in new_chapters_list:
        old_cid = ch_data["data_source_cid"]
        new_cid = ch_data["cid"]

        # 读取旧章节 JSON
        old_json_path = old_chapters_dir / f"{old_cid}.json"
        if old_json_path.exists():
            old_ch_json = json.loads(old_json_path.read_text(encoding="utf-8"))

            new_ch_json = {
                "cid": new_cid,
                "data_source_cid": old_cid,
                "aid": local_aid,
                "data_source_aid": source_aid,
                "data_source": DATA_SOURCE_ID,
                "data_source_name": DATA_SOURCE_NAME,
                "title": old_ch_json.get("title", ""),
                "book_title": old_ch_json.get("book_title", ""),
                "content": old_ch_json.get("content", ""),
                "images": old_ch_json.get("images", []),
                "has_images": old_ch_json.get("has_images", False),
                "data_source_prev_cid": old_ch_json.get("data_source_prev_cid", old_ch_json.get("prev_cid", "")),
                "data_source_next_cid": old_ch_json.get("data_source_next_cid", old_ch_json.get("next_cid", "")),
                "data_source_index_url": old_ch_json.get("data_source_index_url", old_ch_json.get("index_url", "")),
            }
            (new_chapters_dir / f"{new_cid}.json").write_text(
                json.dumps(new_ch_json, ensure_ascii=False, indent=2), encoding="utf-8")

        # 复制 TXT 文件
        old_txt_path = old_chapters_dir / f"{old_cid}.txt"
        if old_txt_path.exists():
            shutil.copy2(old_txt_path, new_chapters_dir / f"{new_cid}.txt")

        # 复制 _images.json
        old_img_meta = old_chapters_dir / f"{old_cid}_images.json"
        if old_img_meta.exists():
            shutil.copy2(old_img_meta, new_chapters_dir / f"{new_cid}_images.json")

    # 迁移图片目录
    for old_cid, new_cid in cid_map.items():
        old_img_subdir = old_images_dir / str(old_cid)
        if old_img_subdir.exists() and old_img_subdir.is_dir():
            new_img_subdir = new_images_dir / str(new_cid)
            if not new_img_subdir.exists():
                # 复制整个图片目录
                shutil.copytree(old_img_subdir, new_img_subdir)

    # ── 后处理：翻译章节导航 ID ──
    for ch_data in new_chapters_list:
        new_cid = ch_data["cid"]
        json_path = new_chapters_dir / f"{new_cid}.json"
        if not json_path.exists():
            continue

        data = json.loads(json_path.read_text(encoding="utf-8"))
        src_prev = data.get("data_source_prev_cid", "")
        src_next = data.get("data_source_next_cid", "")

        # 翻译 prev
        if src_prev and src_prev != "index":
            try:
                data["prev_cid"] = cid_map.get(int(src_prev), 0)
            except ValueError:
                data["prev_cid"] = 0
        else:
            data["prev_cid"] = 0

        # 翻译 next
        if src_next:
            try:
                data["next_cid"] = cid_map.get(int(src_next), 0)
            except ValueError:
                data["next_cid"] = 0
        else:
            data["next_cid"] = 0

        json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    # 写入 chapters.json
    (new_dir / "chapters.json").write_text(
        json.dumps(new_chapters_list, ensure_ascii=False, indent=2), encoding="utf-8")

    # 复制断点文件
    old_cp = old_dir / ".checkpoint.json"
    if old_cp.exists():
        shutil.copy2(old_cp, new_dir / ".checkpoint.json")

    print(f"[+] 迁移完成: {old_dir.name} → {new_dir.name}")
    print(f"    本站 aid: {local_aid}, 章节: {len(new_chapters_list)}")


def main():
    parser = argparse.ArgumentParser(description="爬虫数据迁移 — v1 → v2 ID 体系")
    parser.add_argument("novel_dir", help="旧格式小说目录，如 novels/aid_3057")
    parser.add_argument("--dry-run", action="store_true", help="仅检查不写入")
    args = parser.parse_args()

    migrate_novel(args.novel_dir, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
