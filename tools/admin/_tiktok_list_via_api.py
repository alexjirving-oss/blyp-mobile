"""Resolve TikTok secUid from profile HTML, then page /api/post/item_list/ for video IDs."""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def fetch(url: str, cookies: str | None = None) -> bytes:
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/",
    }
    if cookies:
        headers["Cookie"] = cookies
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


def sec_uid_from_profile(handle: str) -> tuple[str, str]:
    html = fetch(f"https://www.tiktok.com/@{handle}").decode("utf-8", "replace")
    m = re.search(
        r'<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>(.*?)</script>',
        html,
        re.S,
    )
    if not m:
        raise RuntimeError("no UNIVERSAL_DATA")
    raw = m.group(1)
    # Prefer user-detail secUid matching uniqueId
    try:
        data = json.loads(raw)
        user = (
            data.get("__DEFAULT_SCOPE__", {})
            .get("webapp.user-detail", {})
            .get("userInfo", {})
            .get("user", {})
        )
        if user.get("uniqueId", "").lower() == handle.lower() and user.get("secUid"):
            return user["secUid"], raw
    except Exception:
        pass
    mm = re.search(r'"secUid"\s*:\s*"([^"]+)"', raw)
    if not mm:
        raise RuntimeError("no secUid")
    return mm.group(1), raw


def list_items(sec_uid: str, cookies: str | None = None, max_pages: int = 40) -> list[str]:
    ids: list[str] = []
    cursor = 0
    for page in range(max_pages):
        qs = urllib.parse.urlencode(
            {
                "aid": "1988",
                "app_language": "en",
                "app_name": "tiktok_web",
                "browser_language": "en-US",
                "browser_name": "Mozilla",
                "browser_online": "true",
                "browser_platform": "Win32",
                "browser_version": "5.0 (Windows)",
                "channel": "tiktok_web",
                "cookie_enabled": "true",
                "count": "30",
                "cursor": str(cursor),
                "device_id": "7123456789012345678",
                "device_platform": "web_pc",
                "focus_state": "true",
                "from_page": "user",
                "history_len": "3",
                "is_fullscreen": "false",
                "is_page_visible": "true",
                "language": "en",
                "os": "windows",
                "priority_region": "",
                "referer": "",
                "region": "US",
                "screen_height": "1080",
                "screen_width": "1920",
                "secUid": sec_uid,
                "tz_name": "Europe/London",
                "user_is_login": "false",
                "webcast_language": "en",
            }
        )
        url = f"https://www.tiktok.com/api/post/item_list/?{qs}"
        try:
            body = fetch(url, cookies=cookies).decode("utf-8", "replace")
        except Exception as e:
            print(f"page{page}_fail {e}")
            break
        try:
            j = json.loads(body)
        except Exception:
            print(f"page{page}_bad_json {body[:200]!r}")
            break
        items = j.get("itemList") or j.get("items") or []
        print(f"page{page} status={j.get('statusCode')} items={len(items)} hasMore={j.get('hasMore')} cursor={j.get('cursor')}")
        if not items:
            # dump small keys for debug
            print("keys", list(j.keys())[:20])
            break
        for it in items:
            vid = str(it.get("id") or it.get("aweme_id") or "")
            if vid.isdigit():
                ids.append(vid)
        if not j.get("hasMore"):
            break
        cursor = j.get("cursor") or (cursor + 30)
        time.sleep(0.8)
    # dedupe preserve order
    seen = set()
    out = []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
    return out


def main():
    handle = sys.argv[1].lstrip("@")
    out = Path(sys.argv[2])
    cookie_file = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    cookies = None
    if cookie_file and cookie_file.exists():
        # accept raw Cookie header file or Netscape — if Netscape, build header for tiktok.com
        text = cookie_file.read_text(encoding="utf-8", errors="replace")
        if text.lstrip().startswith("# Netscape") or "\t" in text.splitlines()[0] if text else False:
            parts = []
            for line in text.splitlines():
                if not line or line.startswith("#"):
                    continue
                cols = line.split("\t")
                if len(cols) >= 7 and "tiktok" in cols[0]:
                    parts.append(f"{cols[5]}={cols[6]}")
            cookies = "; ".join(parts) if parts else None
        else:
            cookies = text.strip() or None

    print(f"resolve @{handle}")
    sec, _ = sec_uid_from_profile(handle)
    print(f"secUid={sec[:40]}...")
    ids = list_items(sec, cookies=cookies)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(ids) + ("\n" if ids else ""), encoding="utf-8")
    print(f"TOTAL ids={len(ids)} -> {out}")
    sys.exit(0 if ids else 3)


if __name__ == "__main__":
    main()
