"""修复 chapters 表中 sort_order 乱序的问题

问题根因：
  并发下载时 local_cid 按下载完成顺序（而非目录顺序）分配，
  导致第14章可能先下载完成获得 cid=1，排序完全错乱。

  此脚本在 scraper.py 修复后使用，一次性修复已有数据。

修复策略：
  按 data_source_cid 升序重新分配 sort_order。
  wenku8 的 data_source_cid 与章节在目录中的位置同序，
  因此按 data_source_cid 排序等价于按目录顺序排序。

用法:
  python orchestrate/fix_sort_order.py            # 检测并修复
  python orchestrate/fix_sort_order.py --dry-run  # 仅检测，不修改
  python orchestrate/fix_sort_order.py --aid 7    # 仅修复指定小说
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import NovelDB


def fix_sort_order(dry_run: bool = False, target_aid: int = 0):
    """修复 sort_order 乱序"""
    db = NovelDB()

    print("=" * 60)
    print("  修复 sort_order 乱序")
    if dry_run:
        print("  [DRY RUN 模式] 仅检测，不修改")
    if target_aid > 0:
        print(f"  目标小说: aid={target_aid}")
    print("=" * 60)
    print()

    with db._conn.cursor() as cur:
        # 1. 查找受影响的章节
        if target_aid > 0:
            cur.execute("SELECT id FROM novels WHERE id = %s", (target_aid,))
        else:
            cur.execute("SELECT id FROM novels ORDER BY id")

        novel_ids = [row["id"] for row in cur.fetchall()]

        if not novel_ids:
            print("[OK] 没有可修复的小说")
            db.close()
            return

        total_fixed = 0
        for novel_id in novel_ids:
            # 2. 读取当前章节列表（按 sort_order 排序）
            cur.execute(
                "SELECT id, data_source_cid, sort_order, title FROM chapters WHERE novel_id = %s ORDER BY sort_order",
                (novel_id,),
            )
            chapters = cur.fetchall()

            if not chapters:
                continue

            # 3. 检查是否乱序（sort_order 应该随 data_source_cid 单调递增）
            issues = []
            prev_cid = 0
            for ch in chapters:
                src = ch["data_source_cid"]
                if src < prev_cid:
                    issues.append(
                        f"  scid={src} sort={ch['sort_order']} {ch['title'][:20]}"
                    )
                prev_cid = src

            if not issues:
                continue

            print(f"[*] novel_id={novel_id}: 发现 sort_order 乱序")
            for issue in issues:
                print(issue)

            if dry_run:
                print(f"    (将修复 {len(chapters)} 章)")
                continue

            # 4. 修复：按 data_source_cid 重新分配 sort_order
            sorted_chapters = sorted(chapters, key=lambda c: c["data_source_cid"])
            for new_order, ch in enumerate(sorted_chapters, 1):
                if ch["sort_order"] != new_order:
                    cur.execute(
                        "UPDATE chapters SET sort_order = %s WHERE id = %s",
                        (new_order, ch["id"]),
                    )
                    total_fixed += 1

            print(f"  [OK] 已修复 {len(chapters)} 章")

        if not dry_run:
            db._conn.commit()

    print()
    print("=" * 60)
    if dry_run:
        print(f"  检测完成，发现 {total_fixed} 章需修复")
    else:
        print(f"  修复完成: {total_fixed} 章已更新")
    print("=" * 60)

    db.close()


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    target_aid = 0
    for i, arg in enumerate(sys.argv):
        if arg == "--aid" and i + 1 < len(sys.argv):
            target_aid = int(sys.argv[i + 1])
            break
    fix_sort_order(dry_run=dry_run, target_aid=target_aid)
