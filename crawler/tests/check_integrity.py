"""检查数据库中所有表之间的 ID 关联一致性

检查项：
1. novels vs site_novels 关联（downloaded_aid）
2. novels vs volumes 关联（novel_id）
3. novels vs chapters 关联（novel_id）
4. chapters vs volumes 关联（volume_id）
5. chapters vs chapter_images 关联（chapter_id）
6. novels vs novel_tags 关联（novel_id）
7. 孤儿记录检查（orphaned records）
"""

import sys
from pathlib import Path

# 添加 crawler 根目录到 sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import NovelDB
import psycopg2


def check_database_integrity():
    """检查数据库关联完整性"""
    db = NovelDB()

    print("=" * 60)
    print("  数据库关联完整性检查")
    print("=" * 60)
    print()

    issues = []

    # 1. novels vs site_novels 关联
    print("[1/7] 检查 novels <-> site_novels 关联...")
    check_novels_site_novels(db, issues)

    # 2. novels vs volumes 关联
    print("[2/7] 检查 novels <-> volumes 关联...")
    check_novels_volumes(db, issues)

    # 3. novels vs chapters 关联
    print("[3/7] 检查 novels <-> chapters 关联...")
    check_novels_chapters(db, issues)

    # 4. chapters vs volumes 关联
    print("[4/7] 检查 chapters <-> volumes 关联...")
    check_chapters_volumes(db, issues)

    # 5. chapters vs chapter_images 关联
    print("[5/7] 检查 chapters <-> chapter_images 关联...")
    check_chapters_images(db, issues)

    # 6. novels vs novel_tags 关联
    print("[6/7] 检查 novels <-> novel_tags 关联...")
    check_novels_tags(db, issues)

    # 7. 孤儿记录检查
    print("[7/7] 检查孤儿记录...")
    check_orphaned_records(db, issues)

    print()
    print("=" * 60)
    if issues:
        print(f"  发现 {len(issues)} 个问题")
        print("=" * 60)
        print()
        for i, issue in enumerate(issues, 1):
            print(f"{i}. {issue}")
    else:
        print("  所有关联检查通过！")
        print("=" * 60)

    db.close()


def check_novels_site_novels(db: NovelDB, issues: list):
    """检查 novels 和 site_novels 的关联"""
    with db._conn.cursor() as cur:
        # 检查 site_novels 中标记为已下载的小说是否都有对应的 novels 记录
        cur.execute("""
            SELECT sn.data_source_aid, sn.downloaded_aid
            FROM site_novels sn
            WHERE sn.is_downloaded = TRUE
              AND sn.downloaded_aid IS NOT NULL
        """)
        downloaded_site = cur.fetchall()

        orphaned = []
        for row in downloaded_site:
            site_aid = row["data_source_aid"]
            downloaded_aid = row["downloaded_aid"]

            # 检查 novels 表中是否存在该 id
            cur.execute("SELECT id FROM novels WHERE id = %s", (downloaded_aid,))
            if not cur.fetchone():
                orphaned.append((site_aid, downloaded_aid))

        if orphaned:
            msg = f"site_novels 中有 {len(orphaned)} 条记录的 downloaded_aid 指向不存在的 novels.id"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
            for site_aid, dl_aid in orphaned[:5]:
                print(f"    - site_aid={site_aid}, downloaded_aid={dl_aid}")
        else:
            print(f"  [OK] {len(downloaded_site)} 条已下载记录关联正确")

        # 检查 novels 表中的小说是否都在 site_novels 中
        cur.execute("""
            SELECT n.id, n.data_source_aid
            FROM novels n
            LEFT JOIN site_novels sn ON n.data_source_aid = sn.data_source_aid
            WHERE sn.id IS NULL
        """)
        missing_in_site = cur.fetchall()

        if missing_in_site:
            msg = f"有 {len(missing_in_site)} 本已下载的小说未在 site_novels 中"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
            for row in missing_in_site[:5]:
                print(f"    - novel_id={row['id']}, aid={row['data_source_aid']}")
        else:
            print("  [OK] 所有已下载小说都在 site_novels 中")


def check_novels_volumes(db: NovelDB, issues: list):
    """检查 novels 和 volumes 的关联"""
    with db._conn.cursor() as cur:
        # 检查 volumes 中是否有 orphaned 记录（novel_id 不存在）
        cur.execute("""
            SELECT v.id, v.novel_id
            FROM volumes v
            LEFT JOIN novels n ON v.novel_id = n.id
            WHERE n.id IS NULL
        """)
        orphaned = cur.fetchall()

        if orphaned:
            msg = f"volumes 中有 {len(orphaned)} 条孤儿记录（novel_id 不存在）"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
        else:
            cur.execute("SELECT COUNT(*) FROM volumes")
            total = cur.fetchone()["count"]
            print(f"  [OK] volumes 表共 {total} 条记录，无孤儿记录")


def check_novels_chapters(db: NovelDB, issues: list):
    """检查 novels 和 chapters 的关联"""
    with db._conn.cursor() as cur:
        # 检查 chapters 中是否有 orphaned 记录（novel_id 不存在）
        cur.execute("""
            SELECT c.id, c.novel_id, c.sort_order
            FROM chapters c
            LEFT JOIN novels n ON c.novel_id = n.id
            WHERE n.id IS NULL
            LIMIT 10
        """)
        orphaned = cur.fetchall()

        if orphaned:
            msg = f"chapters 中有 {len(orphaned)} 条孤儿记录（novel_id 不存在）"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
        else:
            cur.execute("SELECT COUNT(*) FROM chapters")
            total = cur.fetchone()["count"]
            print(f"  [OK] chapters 表共 {total} 条记录，无孤儿记录")


def check_chapters_volumes(db: NovelDB, issues: list):
    """检查 chapters 和 volumes 的关联"""
    with db._conn.cursor() as cur:
        # 检查 chapters 中的 volume_id 是否都存在
        cur.execute("""
            SELECT c.id, c.novel_id, c.volume_id, v.name
            FROM chapters c
            LEFT JOIN volumes v ON c.volume_id = v.id
            WHERE c.volume_id IS NOT NULL
              AND v.id IS NULL
            LIMIT 10
        """)
        orphaned = cur.fetchall()

        if orphaned:
            msg = f"chapters 中有 {len(orphaned)} 条的 volume_id 不存在"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
            for row in orphaned[:3]:
                print(f"    - chapter_id={row['id']}, novel_id={row['novel_id']}, volume_id={row['volume_id']}")
        else:
            # 统计有多少章节有 volume_id
            cur.execute("SELECT COUNT(*) FROM chapters WHERE volume_id IS NOT NULL")
            with_volume = cur.fetchone()["count"]
            cur.execute("SELECT COUNT(*) FROM chapters WHERE volume_id IS NULL")
            without_volume = cur.fetchone()["count"]

            print(f"  [OK] 有 volume_id 的章节: {with_volume}")
            print(f"      无 volume_id 的章节: {without_volume} (可能未下载目录)")


def check_chapters_images(db: NovelDB, issues: list):
    """检查 chapters 和 chapter_images 的关联"""
    with db._conn.cursor() as cur:
        # 检查 chapter_images 中是否有 orphaned 记录
        cur.execute("""
            SELECT ci.id, ci.chapter_id
            FROM chapter_images ci
            LEFT JOIN chapters c ON ci.chapter_id = c.id
            WHERE c.id IS NULL
            LIMIT 10
        """)
        orphaned = cur.fetchall()

        if orphaned:
            msg = f"chapter_images 中有 {len(orphaned)} 条孤儿记录（chapter_id 不存在）"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
        else:
            cur.execute("SELECT COUNT(*) FROM chapter_images")
            total = cur.fetchone()["count"]
            print(f"  [OK] chapter_images 表共 {total} 条记录，无孤儿记录")


def check_novels_tags(db: NovelDB, issues: list):
    """检查 novels 和 novel_tags 的关联"""
    with db._conn.cursor() as cur:
        # 检查 novel_tags 中是否有 orphaned 记录
        cur.execute("""
            SELECT nt.novel_id, nt.tag
            FROM novel_tags nt
            LEFT JOIN novels n ON nt.novel_id = n.id
            WHERE n.id IS NULL
            LIMIT 10
        """)
        orphaned = cur.fetchall()

        if orphaned:
            msg = f"novel_tags 中有 {len(orphaned)} 条孤儿记录（novel_id 不存在）"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
        else:
            cur.execute("SELECT COUNT(*) FROM novel_tags")
            total = cur.fetchone()["count"]
            cur.execute("SELECT COUNT(DISTINCT novel_id) FROM novel_tags")
            novels_with_tags = cur.fetchone()["count"]
            print(f"  [OK] novel_tags 表共 {total} 条记录，涉及 {novels_with_tags} 本小说")


def check_orphaned_records(db: NovelDB, issues: list):
    """检查各种孤儿记录"""
    with db._conn.cursor() as cur:
        # 检查 chapters 中有 chapter_id 但 parent novel 不存在的情况
        cur.execute("""
            SELECT COUNT(*) as orphaned_chapters
            FROM chapters c
            WHERE NOT EXISTS (SELECT 1 FROM novels n WHERE n.id = c.novel_id)
        """)
        orphaned_chapters = cur.fetchone()["orphaned_chapters"]

        if orphaned_chapters > 0:
            msg = f"chapters 表中有 {orphaned_chapters} 条孤儿章节记录"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
        else:
            print("  [OK] 无孤儿章节记录")

        # 检查 volumes 中有 orphaned 的情况
        cur.execute("""
            SELECT COUNT(*) as orphaned_volumes
            FROM volumes v
            WHERE NOT EXISTS (SELECT 1 FROM novels n WHERE n.id = v.novel_id)
        """)
        orphaned_volumes = cur.fetchone()["orphaned_volumes"]

        if orphaned_volumes > 0:
            msg = f"volumes 表中有 {orphaned_volumes} 条孤儿分卷记录"
            issues.append(msg)
            print(f"  [FAIL] {msg}")
        else:
            print("  [OK] 无孤儿分卷记录")


def check_site_novels_sync():
    """检查 site_novels 和 novels 的同步状态"""
    db = NovelDB()

    print()
    print("=" * 60)
    print("  site_novels 同步状态检查")
    print("=" * 60)
    print()

    with db._conn.cursor() as cur:
        # 统计 site_novels
        cur.execute("""
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE is_downloaded = TRUE) as downloaded,
                COUNT(*) FILTER (WHERE is_downloaded = FALSE) as pending,
                COUNT(*) FILTER (WHERE downloaded_aid IS NULL AND is_downloaded = TRUE) as missing_novel_id
            FROM site_novels
        """)
        stats = cur.fetchone()

        print(f"[*] site_novels 统计:")
        print(f"  总数: {stats['total']}")
        print(f"  标记为已下载: {stats['downloaded']}")
        print(f"  待下载: {stats['pending']}")
        print(f"  [WARNING] 已下载但无 downloaded_aid: {stats['missing_novel_id']}")

        if stats["missing_novel_id"] > 0:
            print()
            print("[!] 发现不一致：已下载标记但未关联到 novels.id")
            print("[!] 建议运行: python orchestrate/sync_downloaded.py")

    db.close()


if __name__ == "__main__":
    check_database_integrity()
    check_site_novels_sync()
