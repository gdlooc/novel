"""生成详细的关联关系报告

检查每个表的外键关联，统计缺失和不一致情况。
"""

import sys
from pathlib import Path

# 添加 crawler 根目录到 sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import NovelDB
import psycopg2


def generate_report():
    """生成关联关系报告"""
    db = NovelDB()

    print("=" * 70)
    print("  数据库表关联关系详细报告")
    print("=" * 70)
    print()

    # 1. 基础统计
    print("[1] 基础数据统计")
    print("-" * 70)

    with db._conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) as cnt FROM site_novels")
        site_total = cur.fetchone()["cnt"]

        cur.execute("SELECT COUNT(*) as cnt FROM novels")
        novels_total = cur.fetchone()["cnt"]

        cur.execute("SELECT COUNT(*) as cnt FROM volumes")
        volumes_total = cur.fetchone()["cnt"]

        cur.execute("SELECT COUNT(*) as cnt FROM chapters")
        chapters_total = cur.fetchone()["cnt"]

        cur.execute("SELECT COUNT(*) as cnt FROM chapter_images")
        images_total = cur.fetchone()["cnt"]

        cur.execute("SELECT COUNT(*) as cnt FROM novel_tags")
        tags_total = cur.fetchone()["cnt"]

    print(f"  site_novels:    {site_total:>6} 条 (全站索引)")
    print(f"  novels:         {novels_total:>6} 条 (已下载小说)")
    print(f"  volumes:        {volumes_total:>6} 条 (分卷)")
    print(f"  chapters:       {chapters_total:>6} 条 (章节)")
    print(f"  chapter_images: {images_total:>6} 条 (插图)")
    print(f"  novel_tags:     {tags_total:>6} 条 (标签)")
    print()

    # 2. 外键关联检查
    print("[2] 外键关联完整性")
    print("-" * 70)

    checks = [
        ("site_novels -> novels",
         "SELECT COUNT(*) as cnt FROM site_novels sn WHERE sn.is_downloaded = TRUE AND sn.downloaded_aid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM novels n WHERE n.id = sn.downloaded_aid)"),

        ("novels -> volumes",
         "SELECT COUNT(*) as cnt FROM volumes v WHERE NOT EXISTS (SELECT 1 FROM novels n WHERE n.id = v.novel_id)"),

        ("novels -> chapters",
         "SELECT COUNT(*) as cnt FROM chapters c WHERE NOT EXISTS (SELECT 1 FROM novels n WHERE n.id = c.novel_id)"),

        ("chapters -> volumes",
         "SELECT COUNT(*) as cnt FROM chapters c WHERE c.volume_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM volumes v WHERE v.id = c.volume_id)"),

        ("chapters -> chapter_images",
         "SELECT COUNT(*) as cnt FROM chapter_images ci WHERE NOT EXISTS (SELECT 1 FROM chapters c WHERE c.id = ci.chapter_id)"),

        ("novels -> novel_tags",
         "SELECT COUNT(*) as cnt FROM novel_tags nt WHERE NOT EXISTS (SELECT 1 FROM novels n WHERE n.id = nt.novel_id)"),
    ]

    with db._conn.cursor() as cur:
        for name, sql in checks:
            cur.execute(sql)
            orphaned = cur.fetchone()["cnt"]

            status = "[OK]" if orphaned == 0 else "[FAIL]"
            print(f"  {status} {name:30s}: {orphaned} 条孤儿记录")

    print()

    # 3. 下载状态同步检查
    print("[3] site_novels 同步状态")
    print("-" * 70)

    with db._conn.cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_downloaded = TRUE) as downloaded,
                COUNT(*) FILTER (WHERE is_downloaded = FALSE) as pending,
                COUNT(*) FILTER (WHERE is_downloaded = TRUE AND downloaded_aid IS NULL) as missing_aid
            FROM site_novels
        """)
        stats = cur.fetchone()

        print(f"  全站索引总数: {stats['total']}")
        print(f"  已下载: {stats['downloaded']}")
        print(f"  待下载: {stats['pending']}")
        print(f"  已下载但无 downloaded_aid: {stats['missing_aid']}")

        if stats["missing_aid"] > 0:
            print()
            print("  [WARNING] 发现不一致！")
            print("  建议运行: python orchestrate/sync_downloaded.py")
        else:
            print()
            print("  [OK] 下载状态同步正常")

    print()

    # 4. 每本小说的详细统计
    print("[4] 已下载小说详细统计")
    print("-" * 70)

    with db._conn.cursor() as cur:
        cur.execute("""
            SELECT
                n.id,
                n.data_source_aid,
                n.title,
                n.total_chapters,
                n.completed_chapters,
                (SELECT COUNT(*) FROM volumes WHERE novel_id = n.id) as volume_count,
                (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id) as chapter_count,
                (SELECT COUNT(*) FROM chapter_images ci
                 JOIN chapters c ON ci.chapter_id = c.id
                 WHERE c.novel_id = n.id) as image_count
            FROM novels n
            ORDER BY n.id
        """)
        novels = cur.fetchall()

        if novels:
            print(f"  {'ID':>4} {'aid':>6} {'章节数':>6} {'分卷数':>6} {'插图数':>6} {'状态'}")
            print(f"  {'-'*60}")

            for n in novels:
                nid = n["id"]
                aid = n["data_source_aid"]
                title = n["title"][:25]

                chapter_count = n["chapter_count"] or 0
                volume_count = n["volume_count"] or 0
                image_count = n["image_count"] or 0

                # 检查是否有不匹配
                status = "[OK]"
                if n["total_chapters"] != chapter_count:
                    status = "[MISMATCH]"
                elif n["completed_chapters"] != chapter_count:
                    status = "[PARTIAL]"

                print(f"  {nid:>4} {aid:>6} {chapter_count:>6} {volume_count:>6} {image_count:>6} {status}")

        print()
        print(f"  共 {len(novels)} 本已下载小说")

    print()

    # 5. 章节完整性检查
    print("[5] 章节完整性检查")
    print("-" * 70)

    with db._conn.cursor() as cur:
        # 检查 chapters 表是否匹配 crawl_progress
        cur.execute("""
            SELECT COUNT(*) as cnt
            FROM chapters c
            JOIN crawl_progress cp ON c.novel_id = cp.novel_id
            WHERE c.data_source_cid = ANY (
                SELECT jsonb_array_elements_text(cp.completed_source_cids)::int
            )
        """)
        completed_in_progress = cur.fetchone()["cnt"]

        cur.execute("""
            SELECT COUNT(*) as cnt
            FROM crawl_progress cp
            WHERE jsonb_array_length(cp.completed_source_cids) > 0
        """)
        novels_with_progress = cur.fetchone()["cnt"]

        cur.execute("SELECT COUNT(*) as cnt FROM crawl_progress")
        total_progress = cur.fetchone()["cnt"]

        print(f"  crawl_progress 记录数: {total_progress}")
        print(f"  有完成进度的小说: {novels_with_progress}")
        print(f"  progress 中已下载到 DB 的章节: {completed_in_progress}")

        # 检查是否有进度记录但无对应小说
        cur.execute("""
            SELECT COUNT(*) as cnt
            FROM crawl_progress cp
            LEFT JOIN novels n ON cp.novel_id = n.id
            WHERE n.id IS NULL
        """)
        orphaned_progress = cur.fetchone()["cnt"]

        if orphaned_progress > 0:
            print(f"  [WARNING] crawl_progress 中有 {orphaned_progress} 条孤儿记录")
        else:
            print(f"  [OK] crawl_progress 无孤儿记录")

    print()

    # 6. 分卷完整性
    print("[6] 分卷完整性")
    print("-" * 70)

    with db._conn.cursor() as cur:
        # 检查 novels 表中 total_chapters 是否与实际下载一致
        cur.execute("""
            SELECT
                n.id,
                n.data_source_aid,
                n.title,
                n.total_chapters,
                (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id) as actual_chapters,
                (SELECT COUNT(*) FROM volumes WHERE novel_id = n.id) as actual_volumes
            FROM novels n
            WHERE n.total_chapters != (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id)
               OR n.completed_chapters != (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id)
            LIMIT 10
        """)
        mismatches = cur.fetchall()

        if mismatches:
            print(f"  [WARNING] 发现 {len(mismatches)} 本小说的章节数不匹配:")
            for m in mismatches[:5]:
                print(f"    - ID={m['id']} aid={m['data_source_aid']} {m['title'][:30]}")
                print(f"      预期: {m['total_chapters']} 实际: {m['actual_chapters']}")
        else:
            print("  [OK] 所有小说的章节数匹配")

        # 检查分卷数量
        cur.execute("""
            SELECT n.id, n.title, v.volume_count
            FROM novels n
            JOIN (
                SELECT novel_id, COUNT(*) as volume_count
                FROM volumes
                GROUP BY novel_id
            ) v ON n.id = v.novel_id
            WHERE v.volume_count = 0
            LIMIT 5
        """)
        empty_volumes = cur.fetchall()

        if empty_volumes:
            print(f"  [WARNING] 发现 {len(empty_volumes)} 本小说有 0 个分卷:")
            for v in empty_volumes[:3]:
                print(f"    - ID={v['id']} {v['title'][:40]}")
        else:
            print("  [OK] 所有有章节的小说都有分卷")

    print()
    print("=" * 70)
    print("  检查完成")
    print("=" * 70)

    db.close()


if __name__ == "__main__":
    generate_report()
