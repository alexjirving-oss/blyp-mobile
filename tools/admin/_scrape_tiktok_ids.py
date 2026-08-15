"""Scrape TikTok profile for video IDs via webpage + SIGI_STATE / __UNIVERSAL_DATA."""
import json
import re
import sys
import time
import urllib.request

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/",
    })
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode("utf-8", "replace")

def extract_ids(html: str) -> list[str]:
    ids = set()
    # Common patterns in embedded JSON
    for m in re.finditer(r'"id"\s*:\s*"(\d{15,25})"', html):
        ids.add(m.group(1))
    for m in re.finditer(r'"aweme_id"\s*:\s*"(\d{15,25})"', html):
        ids.add(m.group(1))
    for m in re.finditer(r'/video/(\d{15,25})', html):
        ids.add(m.group(1))
    # Prefer longer numeric IDs typical of TikTok
    return sorted(ids)

def main():
    handle = sys.argv[1].lstrip("@")
    out = sys.argv[2]
    url = f"https://www.tiktok.com/@{handle}"
    print(f"fetch {url}")
    try:
        html = fetch(url)
    except Exception as e:
        print(f"FETCH_FAIL {e}")
        sys.exit(1)
    Path = __import__("pathlib").Path
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    debug = Path(out).with_suffix(".html")
    debug.write_text(html[:500000], encoding="utf-8")
    ids = extract_ids(html)
    Path(out).write_text("\n".join(ids) + ("\n" if ids else ""), encoding="utf-8")
    print(f"ids={len(ids)} out={out} html_bytes={len(html)}")
    if not ids:
        # show a hint
        low = html.lower()
        for needle in ("captcha", "verify", "login", "empty", "couldn't find"):
            if needle in low:
                print(f"hint_contains:{needle}")
        sys.exit(3)

if __name__ == "__main__":
    main()
