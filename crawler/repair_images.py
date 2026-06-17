"""插图修复脚本

重新下载已爬取章节中之前下载失败的插图。
使用 requests + Referer 防盗链绕过，必要时回退到 Playwright。

用法:
  python repair_images.py novels/aid_3057
  python repair_images.py novels/aid_3057 --use-playwright   # 全部用 Playwright
  python repair_images.py novels/aid_3057 --dry-run           # 仅检查不下载
"""

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

import requests as http_requests
from database import NovelDB


# ═══════════════════════════════════════════════════════════════
# 配置
# ═══════════════════════════════════════════════════════════════

_REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def build_referer(source_cid: int, source_aid: int) -> str:
    """根据源站 cid 和 aid 构造来源页 URL"""
    group = source_aid // 1000
    return f"https://www.wenku8.net/novel/{group}/{source_aid}/{source_cid}.htm"


async def download_via_playwright(image_url: str, referer: str) -> Optional[bytes]:
    """使用 Playwright 浏览器下载图片"""
    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                ],
            )
            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                user_agent=_REQUEST_HEADERS["User-Agent"],
                locale="zh-CN",
            )
            page = await context.new_page()

            # 先访问来源页建立 Referer 链
            try:
                await page.goto(referer, wait_until="domcontentloaded", timeout=15000)
                await page.wait_for_timeout(500)
            except Exception:
                pass

            # 用浏览器内 fetch 下载图片字节
            img_bytes = await page.evaluate("""
                async (url) => {
                    const resp = await fetch(url);
                    if (!resp.ok) return null;
                    const blob = await resp.blob();
                    const buf = await blob.arrayBuffer();
                    return Array.from(new Uint8Array(buf));
                }
            """, image_url)

            await browser.close()

            if img_bytes:
                return bytes(img_bytes)
            return None
    except Exception as e:
        print(f"    [!] Playwright 异常: {e}")
        return None


def download_via_requests(url: str, referer: str, timeout: int = 15) -> Optional[bytes]:
    """使用 requests + Referer 下载图片"""
    headers = {**_REQUEST_HEADERS, "Referer": referer,
               "Origin": "https://www.wenku8.net"}
    try:
        resp = http_requests.get(url, headers=headers, timeout=timeout)
        if resp.status_code == 200:
            return resp.content
        elif resp.status_code == 403:
            return None  # 防盗链拒绝
        else:
            print(f"    [!] HTTP {resp.status_code}")
            return None
    except Exception as e:
        print(f"    [!] 请求异常: {e}")
        return None


def repair_novel(
    novel_dir: str,
    use_playwright: bool = True,
    dry_run: bool = False,
):
    """修复一本小说的所有插图

    Args:
        novel_dir: 小说数据目录路径
        use_playwright: 是否使用 Playwright 作为回退方案
        dry_run: 仅检查，不实际下载
    """
    base = Path(novel_dir)
    if not base.exists():
        print(f"[X] 目录不存在: {novel_dir}")
        return

    # 加载元数据
    meta = json.loads((base / "metadata.json").read_text(encoding="utf-8"))
    local_aid = meta.get("aid", 0)
    title = meta.get("title", "未知")
    total = meta.get("total_chapters", 0)

    print(f"\n{'='*60}")
    print(f"  插图修复 — {title}")
    print(f"  aid={local_aid}  总章节={total}")
    print(f"{'='*60}\n")

    chapters_dir = base / "chapters"
    images_root = base.parent / "images" / str(local_aid)

    # 收集有插图的章节
    chapters_with_images = []
    for json_file in sorted(chapters_dir.glob("*.json")):
        # 跳过 _images.json 和 chapters.json
        if json_file.name.endswith("_images.json"):
            continue
        if json_file.name == "chapters.json":
            continue
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
            if data.get("has_images") and data.get("images"):
                chapters_with_images.append(data)
        except Exception:
            continue

    print(f"[*] 发现 {len(chapters_with_images)} 个含插图的章节\n")

    if not chapters_with_images:
        print("  没有需要处理的插图章节")
        return

    total_ok = 0
    total_fail = 0
    total_skip = 0

    for i, ch_data in enumerate(chapters_with_images, 1):
        local_cid = ch_data["cid"]
        source_cid = ch_data.get("data_source_cid", local_cid)
        source_aid = ch_data.get("data_source_aid", local_aid)
        chap_title = ch_data.get("title", f"cid_{local_cid}")[:40]
        images = ch_data.get("images", [])
        chapter_url = build_referer(source_cid, source_aid)

        status_parts = []

        for idx, img in enumerate(images, 1):
            url = img["url"]
            ext = img.get("filename", ".jpg").rsplit(".", 1)[-1] if "." in img.get("filename", "") else "jpg"
            new_filename = f"{idx}.{ext}"
            img_dir = images_root / str(local_cid)
            local_path = img_dir / new_filename

            # 跳过已存在且非空的文件
            if local_path.exists() and local_path.stat().st_size > 0:
                total_skip += 1
                continue

            if dry_run:
                status_parts.append(f"{new_filename} (缺失)")
                continue

            img_dir.mkdir(parents=True, exist_ok=True)

            # ── 策略1: requests + Referer ──
            img_bytes = download_via_requests(url, chapter_url)

            # ── 策略2: Playwright 回退 ──
            if img_bytes is None and use_playwright:
                loop = asyncio.new_event_loop()
                img_bytes = loop.run_until_complete(
                    download_via_playwright(url, chapter_url)
                )
                loop.close()

            if img_bytes:
                local_path.write_bytes(img_bytes)
                total_ok += 1
                status_parts.append(f"{new_filename} [OK]")
            else:
                total_fail += 1
                status_parts.append(f"{new_filename} [FAIL]")

        # ── 写入 DB ──
        if not dry_run and (total_ok > 0 or total_skip > 0):
            try:
                db = NovelDB()
                db_chapters = db.get_chapters(local_aid)
                db_chapter_id = None
                for dc in db_chapters:
                    if dc.get("sort_order") == local_cid:
                        db_chapter_id = dc["id"]
                        break
                if db_chapter_id:
                    db_images = []
                    for idx, img in enumerate(images, 1):
                        ext = img.get("filename", ".jpg").rsplit(".", 1)[-1] if "." in img.get("filename", "") else "jpg"
                        db_images.append({
                            "url": img["url"],
                            "filename": f"{idx}.{ext}",
                            "local_path": str(images_root / str(local_cid) / f"{idx}.{ext}"),
                            "downloaded": True,
                        })
                    db.insert_images(db_chapter_id, db_images)
                db.close()
            except Exception as e:
                print(f"    [!] DB 写入失败: {e}")

        # 进度输出
        ok = "[FAIL]" not in " ".join(status_parts)
        icon = "[OK]" if ok else "[!]"
        detail = ", ".join(status_parts)
        print(f"  [{i:2d}/{len(chapters_with_images)}] cid={local_cid} {icon}  "
              f"{chap_title[:30]}  [{detail}]")

    print(f"\n{'='*60}")
    print(f"  完成: OK={total_ok}  SKIP={total_skip}  FAIL={total_fail}")
    print(f"{'='*60}")

    if dry_run:
        print("  [*] 仅检查模式，未实际下载")


# ═══════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="插图修复 — 重新下载之前失败的章节插图",
    )
    parser.add_argument("novel_dir", help="小说数据目录，如 novels/aid_3057")
    parser.add_argument("--use-playwright", action="store_true",
                        default=True, help="requests 失败后回退 Playwright（默认启用）")
    parser.add_argument("--no-playwright", action="store_true",
                        help="禁用 Playwright 回退")
    parser.add_argument("--dry-run", action="store_true",
                        help="仅检查哪些图片缺失，不下载")

    args = parser.parse_args()
    use_pw = not args.no_playwright
    repair_novel(args.novel_dir, use_playwright=use_pw, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
