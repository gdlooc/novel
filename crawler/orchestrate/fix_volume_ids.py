"""修复 chapters 表中 volume_id=NULL 的章节

问题根因：
  爬虫恢复下载时，_ensure_novel_record() 不会执行，
  _cid_to_volume 映射未初始化，导致所有章节 volume_id 为 NULL。

  此脚本在 scraper.py 修复后使用，一次性修复已有数据。

用法:
  python orchestrate/fix_volume_ids.py            # 检测并修复
  python orchestrate/fix_volume_ids.py --dry-run  # 仅检测，不修复
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import NovelDB


def fix_volume_ids(dry_run: bool = False):
    """修复所有 volume_id=NULL 的章节"""
    db = NovelDB()

    print("=" * 60)
    print("  修复 volume_id=NULL 的章节")
    if dry_run:
        print("  [DRY RUN 模式] 仅检测，不修改")
    print("=" * 60)
    print()

    with db._conn.cursor() as cur:
        # 1. 查找受影响的章节
        cur.execute("""
            SELECT
                c.novel_id,
                n.title,
                n.data_source_aid,
                COUNT(*) as null_count
            FROM chapters c
            JOIN novels n ON c.novel_id = n.id
            WHERE c.volume_id IS NULL
            GROUP BY c.novel_id, n.title, n.data_source_aid
            ORDER BY c.novel_id
        """)
        affected = cur.fetchall()

        if not affected:
            print("[OK] 所有章节 volume_id 均正常，无需修复")
            db.close()
            return

        print(f"[*] 发现 {len(affected)} 本小说的章节 volume_id=NULL:")
        print()
        for row in affected:
            print(f"    novel_id={row['novel_id']}  "
                  f"源站aid={row['data_source_aid']}  "
                  f"{row['title'][:30]}  "
                  f"({row['null_count']} 章受影响)")
        print()

        if dry_run:
            db.close()
            return

        # 2. 逐本修复
        fixed_total = 0
        for row in affected:
            novel_id = row["novel_id"]
            title = row["title"][:30]

            # 2a. 读取该小说的卷信息
            cur.execute(
                "SELECT id, sort_order FROM volumes WHERE novel_id = %s ORDER BY sort_order",
                (novel_id,),
            )
            db_volumes = {vol["sort_order"]: vol["id"] for vol in cur.fetchall()}

            if not db_volumes:
                print(f"  [SKIP] novel_id={novel_id} {title}: 无卷信息，跳过")
                continue

            # 2b. 读取该小说的章节（按 sort_order 排序）
            cur.execute(
                "SELECT id, sort_order FROM chapters WHERE novel_id = %s AND volume_id IS NULL ORDER BY sort_order",
                (novel_id,),
            )
            null_chapters = cur.fetchall()
            if not null_chapters:
                continue

            # 2c. 读取全部章节以推算分段点
            cur.execute(
                "SELECT id, sort_order FROM chapters WHERE novel_id = %s ORDER BY sort_order",
                (novel_id,),
            )
            all_chapters = cur.fetchall()

            # 获取每个卷的 sort_order 范围（从 volume 的 sort_order 推断）
            # 按 sort_order 分组：volume 0 包含前 N 章，volume 1 包含后续，以此类推
            # 简化策略：均分（如果只有1卷则全部归入）
            vol_count = len(db_volumes)
            total_chapters = len(all_chapters)

            if vol_count == 1:
                # 单卷：全部归入
                vol_id = list(db_volumes.values())[0]
                for ch in null_chapters:
                    cur.execute(
                        "UPDATE chapters SET volume_id = %s WHERE id = %s",
                        (vol_id, ch["id"]),
                    )
                    fixed_total += 1
                print(f"  [FIX] novel_id={novel_id} {title}: "
                      f"全部归入卷 {vol_id} ({len(null_chapters)} 章)")
            else:
                # 多卷：按 sort_order 均分推断章节归属
                per_vol = total_chapters // vol_count
                remainder = total_chapters % vol_count
                # 构建 sort_order → volume_id 映射
                sort_to_vol = {}
                ch_idx = 0
                for vol_idx in range(vol_count):
                    vol_id = db_volumes[vol_idx]
                    count = per_vol + (1 if vol_idx < remainder else 0)
                    for _ in range(count):
                        if ch_idx < len(all_chapters):
                            sort_order = all_chapters[ch_idx]["sort_order"]
                            sort_to_vol[sort_order] = vol_id
                            ch_idx += 1

                for ch in null_chapters:
                    vol_id = sort_to_vol.get(ch["sort_order"])
                    if vol_id:
                        cur.execute(
                            "UPDATE chapters SET volume_id = %s WHERE id = %s",
                            (vol_id, ch["id"]),
                        )
                        fixed_total += 1

                print(f"  [FIX] novel_id={novel_id} {title}: "
                      f"{len(null_chapters)} 章 → 均分到 {vol_count} 卷")

        db._conn.commit()

    print()
    print("=" * 60)
    print(f"  修复完成: {fixed_total} 章已更新")
    print("=" * 60)

    db.close()


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    fix_volume_ids(dry_run=dry_run)
