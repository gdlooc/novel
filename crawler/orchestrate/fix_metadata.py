"""修复 novels 表中不一致的元数据

更新 novels.total_chapters 和 novels.completed_chapters 为实际数据库值。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import NovelDB


def fix_novel_metadata():
    """修复 novels 表的不一致元数据"""
    db = NovelDB()

    print("=" * 60)
    print("  修复 novels 表元数据")
    print("=" * 60)
    print()

    with db._conn.cursor() as cur:
        # 查找不匹配的记录
        cur.execute("""
            SELECT
                n.id,
                n.data_source_aid,
                n.title,
                n.total_chapters,
                n.completed_chapters,
                (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id) as actual_count
            FROM novels n
            WHERE n.total_chapters != (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id)
               OR n.completed_chapters != (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id)
        """)
        mismatches = cur.fetchall()

        if not mismatches:
            print("[OK] 所有小说元数据一致，无需修复")
            db.close()
            return

        print(f"[*] 发现 {len(mismatches)} 本小说元数据不匹配:")
        print()

        for row in mismatches:
            nid = row["id"]
            aid = row["data_source_aid"]
            title = row["title"][:40]
            total = row["total_chapters"]
            completed = row["completed_chapters"]
            actual = row["actual_count"]

            print(f"  ID={nid} aid={aid} {title}")
            print(f"    当前: total={total}, completed={completed}")
            print(f"    实际: {actual}")
            print()

            # 修复
            try:
                cur.execute("""
                    UPDATE novels
                    SET total_chapters = %s,
                        completed_chapters = %s,
                        updated_at = NOW()
                    WHERE id = %s
                """, (actual, actual, nid))

                print(f"  [OK] 已修复: total={actual}, completed={actual}")

            except Exception as e:
                print(f"  [FAIL] 修复失败: {e}")

        db._conn.commit()

    print()
    print("=" * 60)
    print("  修复完成")
    print("=" * 60)

    db.close()


if __name__ == "__main__":
    fix_novel_metadata()
