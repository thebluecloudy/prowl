#!/usr/bin/env python3
"""
Daily ShopGoodwill digest scraper for the Prowl page.

Loads the "Ceramic Panther" ShopGoodwill search in headless Chromium and writes
sgw-digest.json: the full UNFILTERED result set — title, price, bids, time left,
link, image. No keyword filtering, no verdicts; Matthew reviews this feed himself.

Why a headless browser: the ShopGoodwill buyer API truncates responses (declares
a Content-Length, then closes the connection early), while the rendered search
page loads fine. So the Action scrapes what a browser sees.

Selector strategy is deliberately class-name-independent: tiles are located by
their /item/ links and fields are parsed from tile text with regexes, so an
Angular template restyle won't silently break the scrape.

Fails closed: if all attempts fail, the old sgw-digest.json is left untouched and
the script exits non-zero — the workflow goes red, but the panel keeps showing
the last good digest with its date.
"""
import json
import os
import re
import sys
import time
from datetime import date

REPO_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(REPO_DIR, "sgw-digest.json")

# Matthew's "Ceramic Panther" search. The caed/cadb params in his bookmarked URL
# are closed-auction date filters and inert while scs=false, so they're dropped
# here to avoid a stale hardcoded date.
SEARCH_URL = (
    "https://shopgoodwill.com/categories/listing"
    "?sg=Keyword&c=&s=&lp=0&hp=999999&sbn=&spo=false&snpo=false&socs=false"
    "&sd=false&sca=false&scs=false&sis=false&col=1&p=1&ps=40&desc=false"
    "&ss=0&UseBuyerPrefs=true&sus=false&cln=1&catIds=&pn=&wc=false"
    "&mci=false&hmt=false&layout=grid&ihp=&st=Ceramic%20Panther"
)

ATTEMPTS = 3
BACKOFF = [10, 30]  # seconds between attempts

PRICE_RE = re.compile(r"\$\s?[\d,]+\.\d{2}")
BIDS_RE = re.compile(r"bids?\s*:\s*(\d+)|(\d+)[ \t]+bids?", re.IGNORECASE)
BIDS_LINE_RE = re.compile(r"bids?\s*:\s*\d+", re.IGNORECASE)
TIME_RE = re.compile(r"\b(?:\d+\s*d(?:\s*\d+\s*h)?|\d+\s*h(?:\s*\d+\s*m)?|\d+\s*m)(?!\d)",
                     re.IGNORECASE)
SKIP_LINE_RE = re.compile(r"^(time remaining|quick bid)\s*:?\s*$", re.IGNORECASE)
COUNT_RE = re.compile(r"of\s+(\d+)\s+entries", re.IGNORECASE)
ITEM_RE = re.compile(r"/item/(\d+)")
BOT_RE = re.compile(r"just a moment|attention required|are you a robot",
                    re.IGNORECASE)

# Structural card extraction: no CSS class names. For each unique /item/ id we
# take the anchor that carries the title text, then climb ancestors until we
# find one whose text holds a price AND which contains a product image (we
# skip icon images like the wishlist heart) — that ancestor is the whole
# listing card.
CARD_JS = """() => {
  const seen = new Set(); const cards = [];
  for (const a of document.querySelectorAll('a[href*="/item/"]')) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\\/item\\/(\\d+)/);
    if (!m || seen.has(m[1])) continue;
    if (!((a.innerText || '').trim())) continue;  // image anchor, not title
    seen.add(m[1]);
    let el = a, card = null, cardImg = '';
    for (let i = 0; i < 8 && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const t = el.innerText || '';
      const prodImg = [...el.querySelectorAll('img')]
        .find(im => !((im.getAttribute('src') || '').includes('icon-')));
      if (/\\$\\s?[\\d,]+\\.\\d{2}/.test(t) && prodImg) {
        card = el;
        cardImg = prodImg.getAttribute('src')
                 || prodImg.getAttribute('data-src') || '';
        break;
      }
    }
    cards.push({id: m[1],
                text: card ? card.innerText : (a.innerText || ''),
                img: cardImg});
  }
  return cards;
}"""

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def _proxy_from_env():
    """Honor *_PROXY env vars (this VM routes egress through one; GitHub
    Actions runners won't have it set and will go direct)."""
    for var in ("https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY"):
        val = os.environ.get(var)
        if not val:
            continue
        from urllib.parse import urlparse
        u = urlparse(val if "://" in val else "http://" + val)
        proxy = {"server": "%s://%s:%d" % (u.scheme, u.hostname, u.port)}
        if u.username:
            proxy["username"] = u.username
        if u.password:
            proxy["password"] = u.password
        return proxy
    return None


def parse_card(card):
    """Extract one listing from a card dict {id, text, img}. None if unparseable."""
    item_id = card.get("id") or ""
    if not ITEM_RE.search("/item/" + item_id):
        return None

    text = card.get("text") or ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    price_m = PRICE_RE.search(text)
    bids_m = BIDS_RE.search(text)
    time_m = TIME_RE.search(text)

    # Title = text lines that aren't price/bids/time metadata.
    title_lines = []
    for ln in lines:
        if PRICE_RE.search(ln) and len(ln) < 20:
            continue
        if BIDS_LINE_RE.search(ln) or re.fullmatch(r"\d+\s+bids?",
                                                   ln, re.IGNORECASE):
            continue
        if TIME_RE.fullmatch(ln) or SKIP_LINE_RE.match(ln):
            continue
        if "quick bid" in ln.lower():
            continue
        title_lines.append(ln)
    title = " ".join(title_lines).strip()
    if not title or not price_m:
        return None

    bids = 0
    if bids_m:
        bids = int(bids_m.group(1) or bids_m.group(2) or 0)

    return {
        "title": title,
        "price": price_m.group(0).replace(" ", ""),
        "bids": bids,
        "time_left": time_m.group(0) if time_m else "",
        "url": "https://shopgoodwill.com/item/%s" % item_id,
        "image": card.get("img") or "",
    }


def scrape_once(p):
    from playwright.sync_api import TimeoutError as PwTimeout
    browser = p.chromium.launch(headless=True, channel="chromium",
                                args=["--no-sandbox", "--disable-dev-shm-usage"])
    try:
        context = browser.new_context(user_agent=UA,
                                        viewport={"width": 1366, "height": 900},
                                        proxy=_proxy_from_env())
        page = context.new_page()
        page.goto(SEARCH_URL, wait_until="domcontentloaded", timeout=60000)

        if BOT_RE.search(page.title() or ""):
            raise RuntimeError("bot challenge page")

        # Tiles may legitimately be absent on a zero-result day.
        try:
            page.wait_for_selector('a[href*="/item/"]', timeout=30000)
        except PwTimeout:
            body = page.inner_text("body") or ""
            cm = COUNT_RE.search(body)
            if cm and int(cm.group(1)) == 0:
                return []  # genuine quiet day
            raise RuntimeError("no listing tiles rendered")

        # Settle lazy content; scroll in case the result set grows past one
        # viewport (ps=40 keeps it to one page).
        for _ in range(3):
            page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            page.wait_for_timeout(1500)

        cards = page.evaluate(CARD_JS)
        items = []
        for card in cards:
            it = parse_card(card)
            if it:
                items.append(it)

        # Cross-check against the page's own result count when it's visible.
        cm = COUNT_RE.search(page.inner_text("body") or "")
        if cm and int(cm.group(1)) != len(items):
            raise RuntimeError("count mismatch: page says %s, parsed %d"
                               % (cm.group(1), len(items)))
        if not items and not cm:
            raise RuntimeError("empty result with no count to confirm it")
        return items
    finally:
        browser.close()


def main():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright not installed", file=sys.stderr)
        return 2

    last_err = None
    with sync_playwright() as p:
        for attempt in range(ATTEMPTS):
            try:
                items = scrape_once(p)
                break
            except Exception as e:
                last_err = e
                print("attempt %d/%d failed: %s"
                      % (attempt + 1, ATTEMPTS, e), file=sys.stderr)
                if attempt < ATTEMPTS - 1:
                    time.sleep(BACKOFF[attempt])
        else:
            print("all attempts failed; leaving %s untouched"
                  % OUT_PATH, file=sys.stderr)
            return 1

    payload = {
        "updated": date.today().isoformat(),
        "search": "Ceramic Panther",
        "items": items,
    }
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f, indent=1)
    print("wrote %s (%d items)" % (OUT_PATH, len(items)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
