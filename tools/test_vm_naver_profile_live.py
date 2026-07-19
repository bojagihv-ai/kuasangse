from __future__ import annotations

import logging
import sys
import time
from pathlib import Path


def main() -> int:
    if len(sys.argv) != 3:
        print("VM_NAVER_LIVE_DIRECT_ERROR=invalid_arguments")
        return 2

    worker_root = Path(r"C:\JepumScraper")
    if not worker_root.is_dir():
        print("VM_NAVER_LIVE_DIRECT_ERROR=worker_root_missing")
        return 2

    sys.path.insert(0, str(worker_root))
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    from scrapers.naver_shopping_scraper import NaverShoppingBlockedError, _scrape_naver_pro

    query = sys.argv[1]
    max_count = int(sys.argv[2])
    started_at = time.time()
    try:
        results = _scrape_naver_pro(query, max_count)
    except NaverShoppingBlockedError:
        print("VM_NAVER_LIVE_DIRECT_TOTAL=0")
        print("VM_NAVER_LIVE_HTML_STATE=blocked_live_chrome")
        return 0
    print(f"VM_NAVER_LIVE_DIRECT_TOTAL={len(results)}")
    if not results:
        snapshots = [
            path
            for path in (worker_root / "logs").glob("naver_fail_*.html")
            if path.stat().st_mtime >= started_at - 3
        ]
        if not snapshots:
            print("VM_NAVER_LIVE_HTML_STATE=missing")
        else:
            latest = max(snapshots, key=lambda path: path.stat().st_mtime)
            html = latest.read_text(encoding="utf-8", errors="ignore")
            flags = []
            if "\ube44\uc815\uc0c1\uc801\uc778 \uc811\uadfc" in html or "captcha" in html.lower():
                flags.append("blocked")
            if "\ub85c\uadf8\uc778" in html.lower() or "login" in html.lower():
                flags.append("login")
            if "basicList_item" in html or "product_item" in html:
                flags.append("product_markup")
            if query.lower() in html.lower():
                flags.append("query_present")
            state = ",".join(flags) if flags else "unclassified"
            print(f"VM_NAVER_LIVE_HTML_STATE={state};bytes={len(html)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
