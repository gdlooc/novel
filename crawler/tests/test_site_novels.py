"""测试 site_novels 表 CRUD 功能

验证数据库写入、查询、更新功能。
"""

import sys
from pathlib import Path

# 添加 crawler 目录到 sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.database import NovelDB


def test_site_novels():
    """测试 site_novels 表操作"""
    db = NovelDB()

    print("=" * 60)
    print("  测试 site_novels 表 CRUD")
    print("=" * 60)
    print()

    # 1. 插入测试数据
    print("[1/5] 插入测试数据...")
    test_novels = [
        {"data_source_aid": 9999, "title": "测试小说A", "url": "https://example.com/a"},
        {"data_source_aid": 8888, "title": "测试小说B", "url": "https://example.com/b"},
    ]

    for novel in test_novels:
        site_id = db.upsert_site_novel(
            data_source_aid=novel["data_source_aid"],
            title=novel["title"],
            url=novel["url"],
        )
        print(f"  [OK] 插入/更新: aid={novel['data_source_aid']}, site_id={site_id}")

    print()

    # 2. 批量插入
    print("[2/5] 批量插入测试...")
    batch_data = [
        {"data_source_aid": 7777, "title": "批量测试C", "url": ""},
        {"data_source_aid": 6666, "title": "批量测试D", "url": ""},
    ]
    db.batch_upsert_site_novels(batch_data)
    print(f"  [OK] 批量插入 {len(batch_data)} 条")

    print()

    # 3. 查询单条
    print("[3/5] 查询单条记录...")
    novel = db.get_site_novel(9999)
    if novel:
        print(f"  [OK] 查询结果: {novel['title']} (aid={novel['data_source_aid']})")
    else:
        print("  [FAIL] 未找到记录")

    print()

    # 4. 查询列表（分页）
    print("[4/5] 查询列表（分页）...")
    novels, total = db.get_site_novels(offset=0, limit=10)
    print(f"  [OK] 总数: {total}, 本次返回: {len(novels)}")

    print()

    # 5. 统计信息
    print("[5/5] 统计信息...")
    stats = db.get_site_novels_count()
    print(f"  [OK] 总数: {stats['total']}")
    print(f"  [OK] 已下载: {stats['downloaded']}")
    print(f"  [OK] 待下载: {stats['pending']}")

    print()
    print("=" * 60)
    print("  测试完成！")
    print("=" * 60)

    # 清理测试数据
    print()
    print("[清理] 删除测试数据...")
    with db._conn.cursor() as cur:
        cur.execute("DELETE FROM site_novels WHERE data_source_aid IN (9999, 8888, 7777, 6666)")
    db._conn.commit()
    print("  [OK] 测试数据已清理")

    db.close()


if __name__ == "__main__":
    test_site_novels()
