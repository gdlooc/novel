"""将已下载的小说同步到 site_novels 表

扫描 novels/aid_*/metadata.json，将已下载的小说信息同步到 site_novels 表。
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import NovelDB


def sync_downloaded_novels(output_dir: str = "novels"):
    """将已下载的小说同步到 site_novels 表"""
    db = NovelDB()
    output_path = Path(output_dir)

    print("=" * 60)
    print("  同步已下载小说到 site_novels 表")
    print("=" * 60)
    print()

    # 扫描所有 aid_* 目录
    aid_dirs = sorted([d for d in output_path.iterdir() if d.is_dir() and d.name.startswith("aid_")])

    if not aid_dirs:
        print("[!] 未找到任何 aid_* 目录")
        db.close()
        return

    print(f"[*] 发现 {len(aid_dirs)} 个小说目录")
    print()

    synced = 0
    failed = 0

    for aid_dir in aid_dirs:
        meta_file = aid_dir / "metadata.json"
        if not meta_file.exists():
            print(f"  [SKIP] {aid_dir.name}: 缺少 metadata.json")
            continue

        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
            data_source_aid = meta.get("data_source_aid")
            title = meta.get("title", "未知")
            url = meta.get("data_source_book_url", "")

            if not data_source_aid:
                print(f"  [SKIP] {aid_dir.name}: metadata.json 中缺少 data_source_aid")
                continue

            # 插入/更新 site_novels
            db.upsert_site_novel(
                data_source_aid=data_source_aid,
                title=title,
                url=url,
            )

            # 标记为已下载
            # 获取本站 novel_id（从 novels 表）
            novel = db.get_novel_by_source(data_source_id=1, data_source_aid=data_source_aid)
            if novel:
                db.mark_site_novel_downloaded(
                    data_source_aid=data_source_aid,
                    downloaded_aid=novel["id"],
                )

            print(f"  [OK] {aid_dir.name}: {title[:40]} (source_aid={data_source_aid})")
            synced += 1

        except Exception as e:
            print(f"  [FAIL] {aid_dir.name}: {e}")
            failed += 1

    print()
    print("=" * 60)
    print(f"  同步完成: {synced} 成功, {failed} 失败")
    print("=" * 60)

    # 显示统计
    stats = db.get_site_novels_count()
    print()
    print(f"[统计]")
    print(f"  全站索引总数: {stats['total']}")
    print(f"  已下载: {stats['downloaded']}")
    print(f"  待下载: {stats['pending']}")

    db.close()


if __name__ == "__main__":
    sync_downloaded_novels()
