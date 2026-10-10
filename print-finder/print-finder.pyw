#!/usr/bin/env python3
"""
Print Finder -- Owl & Twig Vintage

Search three open-access museums at once, look at thumbnails, star the ones
worth printing, and download only those at full resolution with a provenance
CSV attached.

Built for graphic work: woodcuts, woodblock prints, linocuts, engravings --
flat black shapes that survive being printed on cotton.

    pip install requests pillow

Then double-click.

Sources, all keyless:
  The Met                  ~500,000 objects
  Art Institute of Chicago  50,000+ CC0 images
  Cleveland Museum of Art   ~40,000 CC0 images
  Wikimedia Commons, Rijksmuseum, SMK Copenhagen, Library of Congress
  Medieval Bestiary (bestiary.ca) -- manuscript beasts. NOT public domain:
      the libraries that hold the manuscripts own the images, so these are
      marked "check rights" and the CSV says so.
"""

import csv
import io
import json
import os
import queue
import re
import threading
import time
import tkinter as tk
import webbrowser
from tkinter import filedialog, messagebox, ttk


def _ensure(packages):
    """Install anything missing, with a progress window, then carry on.
    The user should never see a wall of instructions."""
    import importlib
    import subprocess
    import sys

    missing = []
    for module, package in packages:
        try:
            importlib.import_module(module)
        except ImportError:
            missing.append(package)

    if not missing:
        return

    import tkinter as _tk
    from tkinter import messagebox as _mb

    splash = _tk.Tk()
    splash.title("First run")
    splash.configure(bg="#faf7f1")
    splash.geometry("380x130")
    splash.resizable(False, False)
    _tk.Label(splash, text="Setting up", font=("Georgia", 14), bg="#faf7f1",
              fg="#4a5d43").pack(pady=(22, 4))
    note = _tk.Label(splash, text="Installing " + ", ".join(missing) + "…",
                     font=("Georgia", 9), bg="#faf7f1", fg="#6b6459")
    note.pack()
    _tk.Label(splash, text="This happens once and takes a moment.",
              font=("Georgia", 8, "italic"), bg="#faf7f1", fg="#6b6459").pack(pady=(6, 0))
    splash.update()

    command = [sys.executable, "-m", "pip", "install", "--quiet",
               "--disable-pip-version-check", *missing]
    flags = 0
    if hasattr(subprocess, "CREATE_NO_WINDOW"):
        flags = subprocess.CREATE_NO_WINDOW          # keep the console hidden on Windows

    try:
        subprocess.run(command, check=True, creationflags=flags,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=600)
    except Exception:
        try:
            subprocess.run(command + ["--user"], check=True, creationflags=flags,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=600)
        except Exception as error:
            splash.destroy()
            root = _tk.Tk()
            root.withdraw()
            _mb.showerror(
                "Could not set up",
                "Automatic setup failed:\n\n" + str(error)[:300] +
                "\n\nAs a fallback, run this in Command Prompt:\n\n    pip install "
                + " ".join(missing),
            )
            raise SystemExit

    splash.destroy()
    for module, _ in packages:
        importlib.invalidate_caches()


_ensure([("requests", "requests"), ("PIL", "pillow")])

import requests
from PIL import Image, ImageTk

HOME = os.path.expanduser("~")
SHORTLIST = os.path.join(HOME, ".printfinder-shortlist.json")
SETTINGS = os.path.join(HOME, ".printfinder-settings.json")
BESTIARY_CACHE = os.path.join(HOME, ".printfinder-bestiary.json")

INK = "#22201d"
MUTED = "#6b6459"
CREAM = "#faf7f1"
MOSS = "#4a5d43"
BRASS = "#a8862c"
RULE = "#e3ddd2"
STAR = "#a8862c"

UA = {"User-Agent": "OwlAndTwigPrintFinder/1.0 (owlandtwigvintage.com)"}

# Searches that reliably surface flat, high-contrast graphic work.
PRESETS = [
    "woodcut",
    "woodblock print",
    "linocut",
    "wood engraving",
    "Japanese woodblock print",
    "botanical print",
    "bird print",
    "moth butterfly print",
    "mushroom fungi",
    "owl",
    "cat print",
    "skeleton skull print",
    "ornament pattern design",
    "ukiyo-e",
    "natural history illustration",
    "seed catalog cover",
    "silhouette",
]


# --------------------------------------------------------------------------
# Museum adapters. Each returns a list of dicts with the same shape.
# --------------------------------------------------------------------------

def search_met(term, limit, session, key=None):
    hits = session.get(
        "https://collectionapi.metmuseum.org/public/collection/v1/search",
        params={"q": term, "hasImages": "true", "medium": "Prints"},
        timeout=30,
    )
    hits.raise_for_status()
    ids = (hits.json().get("objectIDs") or [])[:limit]

    out = []
    for object_id in ids:
        try:
            detail = session.get(
                f"https://collectionapi.metmuseum.org/public/collection/v1/objects/{object_id}",
                timeout=30,
            )
            detail.raise_for_status()
            item = detail.json()
        except requests.RequestException:
            continue

        if not item.get("isPublicDomain") or not item.get("primaryImageSmall"):
            continue

        out.append(
            {
                "source": "The Met",
                "id": f"met-{object_id}",
                "title": item.get("title") or "Untitled",
                "artist": item.get("artistDisplayName") or "Unknown",
                "date": item.get("objectDate") or "",
                "thumb": item.get("primaryImageSmall"),
                "full": item.get("primaryImage") or item.get("primaryImageSmall"),
                "page": item.get("objectURL", ""),
                "credit": f"{item.get('title','Untitled')}, {item.get('objectDate','')}. "
                          f"The Metropolitan Museum of Art, {item.get('accessionNumber','')}. CC0.",
            }
        )
    return out


def search_aic(term, limit, session, key=None):
    response = session.get(
        "https://api.artic.edu/api/v1/artworks/search",
        params={
            "q": term,
            "limit": min(limit, 100),
            "fields": "id,title,artist_title,date_display,image_id,is_public_domain,main_reference_number",
        },
        timeout=30,
    )
    response.raise_for_status()

    out = []
    for item in response.json().get("data", []):
        if not item.get("is_public_domain") or not item.get("image_id"):
            continue
        image_id = item["image_id"]
        out.append(
            {
                "source": "Art Institute of Chicago",
                "id": f"aic-{item['id']}",
                "title": item.get("title") or "Untitled",
                "artist": item.get("artist_title") or "Unknown",
                "date": item.get("date_display") or "",
                "thumb": f"https://www.artic.edu/iiif/2/{image_id}/full/400,/0/default.jpg",
                "full": f"https://www.artic.edu/iiif/2/{image_id}/full/full/0/default.jpg",
                "page": f"https://www.artic.edu/artworks/{item['id']}",
                "credit": f"{item.get('artist_title','Unknown')}. {item.get('title','Untitled')}, "
                          f"{item.get('date_display','')}. The Art Institute of Chicago. CC0.",
            }
        )
    return out


def search_cma(term, limit, session, key=None):
    response = session.get(
        "https://openaccess-api.clevelandart.org/api/artworks/",
        params={"q": term, "cc0": "1", "has_image": "1", "limit": min(limit, 100)},
        timeout=30,
    )
    response.raise_for_status()

    out = []
    for item in response.json().get("data", []):
        images = item.get("images") or {}
        web = (images.get("web") or {}).get("url")
        if not web:
            continue
        full = (images.get("print") or {}).get("url") or web
        creators = item.get("creators") or []
        artist = creators[0].get("description", "Unknown") if creators else "Unknown"
        out.append(
            {
                "source": "Cleveland Museum of Art",
                "id": f"cma-{item.get('id')}",
                "title": item.get("title") or "Untitled",
                "artist": artist,
                "date": item.get("creation_date") or "",
                "thumb": web,
                "full": full,
                "page": item.get("url", ""),
                "credit": f"{artist}. {item.get('title','Untitled')}, {item.get('creation_date','')}. "
                          f"The Cleveland Museum of Art, {item.get('accession_number','')}. CC0.",
            }
        )
    return out



def search_commons(term, limit, session, key=None):
    """Wikimedia Commons -- the widest net. Holds the Rijksmuseum scans we
    already used, plus Biodiversity Heritage Library plates and much else."""
    response = session.get(
        "https://commons.wikimedia.org/w/api.php",
        params={
            "action": "query", "format": "json", "generator": "search",
            "gsrsearch": f"{term} filetype:bitmap", "gsrnamespace": "6",
            "gsrlimit": min(limit, 50), "prop": "imageinfo",
            "iiprop": "url|extmetadata", "iiurlwidth": "400",
        },
        timeout=30,
    )
    response.raise_for_status()
    pages = (response.json().get("query") or {}).get("pages") or {}

    out = []
    for page in pages.values():
        info = (page.get("imageinfo") or [{}])[0]
        if not info.get("thumburl"):
            continue
        meta = info.get("extmetadata") or {}

        def field(name):
            raw = (meta.get(name) or {}).get("value", "")
            return re.sub(r"<[^>]+>", "", raw).strip()

        licence = field("LicenseShortName")
        if licence and not re.search(r"public domain|CC0|PD", licence, re.I):
            continue

        title = page["title"].replace("File:", "")
        title = re.sub(r"\.(jpg|jpeg|png|tif|tiff)$", "", title, flags=re.I)
        out.append({
            "source": "Wikimedia Commons",
            "id": f"commons-{page['pageid']}",
            "title": title,
            "artist": field("Artist") or "Unknown",
            "date": field("DateTimeOriginal")[:40],
            "thumb": info["thumburl"],
            "full": info.get("url", info["thumburl"]),
            "page": info.get("descriptionurl", ""),
            "credit": f"{title}. {field('Credit') or 'Wikimedia Commons'}. {licence or 'Public domain'}.",
        })
    return out


def _dig(node, want):
    """Walk a Linked Art record and pull out the first value of interest.
    The records nest deeply and the shape varies by object, so we search
    rather than assume a path."""
    found = []

    def walk(item):
        if isinstance(item, dict):
            for key, value in item.items():
                if want == "micrio" and key in ("id", "@id") and isinstance(value, str):
                    match = re.search(r"iiif\.micr\.io/([A-Za-z0-9]+)", value)
                    if match:
                        found.append(match.group(1))
                if want == "label" and key in ("_label", "content") and isinstance(value, str):
                    found.append(value)
                walk(value)
        elif isinstance(item, list):
            for entry in item:
                walk(entry)

    walk(node)
    return found


def search_rijks(term, limit, session, key=None):
    """Rijksmuseum, via its keyless Linked Art search plus IIIF images.

    Two steps: the search returns bare identifiers, each of which is then
    resolved to a full record. That makes it slower than the other sources
    but it needs no account.
    """
    response = session.get(
        "https://data.rijksmuseum.nl/search/collection",
        params={"title": term, "imageAvailable": "true"},
        headers={"Accept": "application/ld+json"},
        timeout=30,
    )
    response.raise_for_status()
    items = response.json().get("orderedItems", [])[:limit]

    out = []
    for entry in items:
        identifier = entry.get("id")
        if not identifier:
            continue
        try:
            record = session.get(
                identifier, headers={"Accept": "application/ld+json"}, timeout=30
            )
            record.raise_for_status()
            data = record.json()
        except (requests.RequestException, ValueError):
            continue

        micrio = _dig(data, "micrio")
        if not micrio:
            continue
        image_id = micrio[0]

        title = data.get("_label") or "Untitled"
        labels = _dig(data, "label")
        maker = next((l for l in labels if l and l != title), "Unknown")

        out.append({
            "source": "Rijksmuseum",
            "id": f"rijks-{identifier.rsplit('/', 1)[-1]}",
            "title": title[:90],
            "artist": maker[:60],
            "date": "",
            "thumb": f"https://iiif.micr.io/{image_id}/full/400,/0/default.jpg",
            "full": f"https://iiif.micr.io/{image_id}/full/max/0/default.jpg",
            "page": identifier,
            "credit": f"{title}. Rijksmuseum, Amsterdam. Public domain.",
        })
    return out


def search_smk(term, limit, session, key=None):
    """Statens Museum for Kunst, Copenhagen. Strong on Nordic graphic work."""
    response = session.get(
        "https://api.smk.dk/api/v1/art/search/",
        params={
            "keys": term, "offset": 0, "rows": min(limit, 50),
            "filters": "[has_image:true],[public_domain:true]",
        },
        timeout=30,
    )
    response.raise_for_status()

    out = []
    for item in response.json().get("items", []):
        thumb = item.get("image_thumbnail")
        if not thumb:
            continue
        titles = item.get("titles") or [{}]
        title = titles[0].get("title", "Untitled")
        makers = item.get("production") or [{}]
        artist = makers[0].get("creator", "Unknown")
        number = item.get("object_number", "")
        out.append({
            "source": "SMK Copenhagen",
            "id": f"smk-{number}",
            "title": title,
            "artist": artist,
            "date": (item.get("production_date") or [{}])[0].get("period", ""),
            "thumb": thumb,
            "full": item.get("image_native") or item.get("image_thumbnail"),
            "page": f"https://open.smk.dk/en/artwork/image/{number}",
            "credit": f"{artist}. {title}. SMK, Copenhagen, {number}. Public domain.",
        })
    return out


def search_loc(term, limit, session, key=None):
    """Library of Congress prints and photographs. Deep in ephemera and posters."""
    response = session.get(
        "https://www.loc.gov/pictures/search/",
        params={"q": term, "fo": "json", "c": min(limit, 40)},
        timeout=30,
    )
    response.raise_for_status()

    out = []
    for item in response.json().get("results", []):
        thumb = item.get("image", {}).get("thumb") or item.get("image", {}).get("square")
        if not thumb:
            continue
        if thumb.startswith("//"):
            thumb = "https:" + thumb
        full = item.get("image", {}).get("full") or thumb
        if full.startswith("//"):
            full = "https:" + full
        rights = (item.get("rights") or "")
        out.append({
            "source": "Library of Congress",
            "id": f"loc-{item.get('pk')}",
            "title": (item.get("title") or "Untitled")[:80],
            "artist": (item.get("creator") or "Unknown")[:60],
            "date": item.get("created_published_date") or "",
            "thumb": thumb,
            "full": full,
            "page": item.get("links", {}).get("item", ""),
            "credit": f"{item.get('title','Untitled')}. Library of Congress, "
                      f"Prints and Photographs Division. {rights[:80]}",
        })
    return out


BESTIARY = "https://bestiary.ca/"
BESTIARY_RIGHTS = ("NOT public domain by default. Owned by the library that holds the "
                   "manuscript; see the image's Copyright tab on bestiary.ca and get "
                   "permission before printing or selling.")

# Words in a search that describe the medium, not the animal. The bestiary is
# searched by beast name, so "owl print" should look for "owl".
BESTIARY_SKIP = {
    "a", "an", "and", "the", "of", "print", "prints", "woodcut", "woodblock",
    "linocut", "wood", "engraving", "illustration", "japanese", "botanical",
    "natural", "history", "ornament", "pattern", "design", "seed", "catalog",
    "cover", "ukiyo-e", "silhouette", "medieval", "bestiary", "manuscript",
}

_bestiary_lock = threading.Lock()
_bestiary_last = [0.0]


DEBUG_DIR = os.path.join(HOME, "Downloads", "print-finder-bestiary-debug")

# Why the last bestiary search came back the way it did, for the status line.
bestiary_note = [""]


def _bestiary_get(session, url):
    """bestiary.ca is one person's site, not a museum API: one request a
    second at most, from however many threads ask."""
    with _bestiary_lock:
        wait = 1.0 - (time.monotonic() - _bestiary_last[0])
        if wait > 0:
            time.sleep(wait)
        _bestiary_last[0] = time.monotonic()
    response = session.get(url, timeout=30,
                           headers={"Accept": "text/html,application/xhtml+xml,*/*;q=0.8"})
    response.raise_for_status()
    return response.text


def _bestiary_debug(name, html):
    """Keep a copy of a page we could not read, so it can be sent for a fix."""
    try:
        os.makedirs(DEBUG_DIR, exist_ok=True)
        with open(os.path.join(DEBUG_DIR, name), "w", encoding="utf-8") as handle:
            handle.write(html)
    except OSError:
        pass


def _text(fragment):
    from html import unescape
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def parse_bestiary_index(html):
    """{beast id: name} from a beast list page. Matches beast123.htm links
    only, not beastgallery123.htm or beastbiblio123.htm. Any quoting, any
    path, absolute or relative."""
    beasts = {}
    for match in re.finditer(
        r"""<a\b[^>]*?\bhref\s*=\s*["']?(?:[^"'\s>]*/)?beast(\d+)\.html?(?:[#?][^"'\s>]*)?["']?[^>]*>(.*?)</a>""",
        html, re.I | re.S,
    ):
        name = _text(match.group(2))
        if name and match.group(1) not in beasts:
            beasts[match.group(1)] = name
    return beasts


# Any reference to an image file named img<number>, wherever it sits: an <img>
# tag, a link, a data- attribute or a JavaScript slideshow list.
_IMAGE_REF = re.compile(
    r"""(?<![^"'()\s<>=,;\[{])((?:[^"'()\s<>=,;\[{]*/)?img(\d+)\.(?:jpe?g|png|gif))""", re.I
)


def parse_bestiary_gallery(html, base):
    """[(image number, image url, alt text)] in page order, one per picture.
    The number is what identifies a picture; the same one often appears as a
    thumbnail and as a full image, and we keep the first address seen."""
    from urllib.parse import urljoin

    alts = {}
    for tag in re.finditer(r"<img\b[^>]*>", html, re.I):
        number = re.search(r"img(\d+)\.(?:jpe?g|png|gif)", tag.group(0), re.I)
        label = re.search(r"""\b(?:alt|title)\s*=\s*["']([^"']*)""", tag.group(0), re.I)
        if number and label and number.group(1) not in alts:
            alts[number.group(1)] = _text(label.group(1))

    found, seen = [], set()
    for match in _IMAGE_REF.finditer(html.replace("\\/", "/")):
        path, number = match.group(1).replace("\\", ""), match.group(2)
        if number in seen:
            continue
        seen.add(number)
        found.append((number, urljoin(base, path), alts.get(number, "")))
    return found


def _gallery_scripts(html, base):
    """Same-site script and data files a slideshow might load its list from."""
    from urllib.parse import urljoin, urlparse

    host = urlparse(BESTIARY).netloc
    urls = []
    for ref in re.findall(r"""(?:src|href)\s*=\s*["']([^"']+\.(?:js|json|xml))["']""", html, re.I):
        url = urljoin(base, ref)
        if urlparse(url).netloc.endswith(host) and not re.search(
            r"jquery|bootstrap|google|analytics|font", url, re.I
        ) and url not in urls:
            urls.append(url)
    return urls[:3]


INDEX_VERSION = 2          # bump to throw away beast lists saved by older versions
INDEX_START = ("beasts/beastalpha.htm", "beasts.htm")
INDEX_MAX_PAGES = 40


def _list_pages(html, base):
    """Other beast-list pages a list page links to: a letter of the alphabet,
    a category, the next page. Beast pages themselves carry a number
    (beast245.htm, beastgallery245.htm) and are not list pages."""
    from urllib.parse import urljoin, urlparse

    pages = []
    for ref in re.findall(
        r"""\bhref\s*=\s*["']?((?:[^"'\s>]*/)?beast[a-z_-]*\.html?(?:\?[^"'\s>#]*)?)""",
        html, re.I,
    ):
        url = urljoin(base, ref.replace("&amp;", "&"))
        if urlparse(url).netloc.endswith(urlparse(BESTIARY).netloc) and url not in pages:
            pages.append(url)
    return pages


def bestiary_index(session):
    """{beast id: name} for every beast on bestiary.ca. The list is spread
    over several pages, so this follows every list page it finds. Saved for
    30 days, so only the first search waits for it."""
    try:
        with open(BESTIARY_CACHE, encoding="utf-8") as handle:
            cached = json.load(handle)
        if (cached.get("version") == INDEX_VERSION and cached.get("beasts")
                and time.time() - cached.get("saved", 0) < 30 * 86400):
            return cached["beasts"]
    except (OSError, ValueError, AttributeError):
        pass

    beasts, errors = {}, []
    queue_, visited = [BESTIARY + page for page in INDEX_START], set()
    while queue_ and len(visited) < INDEX_MAX_PAGES:
        url = queue_.pop(0)
        if url in visited:
            continue
        visited.add(url)
        try:
            html = _bestiary_get(session, url)
        except requests.RequestException as error:
            errors.append(f"{url.replace(BESTIARY, '')}: {error}")
            continue
        found = parse_bestiary_index(html)
        if not found and url.replace(BESTIARY, "") in INDEX_START:
            _bestiary_debug(url.replace(BESTIARY, "").replace("/", "_"), html)
        beasts.update({k: v for k, v in found.items() if k not in beasts})
        queue_.extend(u for u in _list_pages(html, url) if u not in visited)

    if not beasts:
        if errors and len(errors) == len(visited):
            raise requests.RequestException("could not reach bestiary.ca (" + errors[0][:90] + ")")
        raise requests.RequestException(
            "read the beast list but found no beasts in it; page saved to " + DEBUG_DIR
        )

    try:
        with open(BESTIARY_CACHE, "w", encoding="utf-8") as handle:
            json.dump({"version": INDEX_VERSION, "saved": time.time(), "beasts": beasts}, handle)
    except OSError:
        pass
    return beasts

def _words(text, skip=frozenset()):
    """Lower-case words with a plural s dropped ("owls" -> "owl", not "ass").
    Hyphenated names count whole and in parts, so "Screech-owl" is an owl."""
    words = set()
    for word in re.findall(r"[a-z-]+", text.lower()):
        for part in {word, *word.split("-")}:
            if part and part not in skip:
                words.add(part[:-1] if len(part) > 3 and part.endswith("s") else part)
    return words


def search_words(term):
    return _words(term, BESTIARY_SKIP)


def match_beasts(term, beasts):
    """Beast ids whose name matches a word of the search, whole-name hits first."""
    words = search_words(term)
    if not words:
        return []
    exact, partial = [], []
    for beast_id, name in beasts.items():
        name_words = _words(name)
        if not words & name_words:
            continue
        (exact if name_words <= words else partial).append(beast_id)
    return exact + partial


def bestiary_images(session, beast_id):
    """Pictures for one beast: its gallery page first, then any script or data
    file the gallery loads, then the beast's own page. Returns (images, page,
    what went wrong)."""
    gallery = f"{BESTIARY}beasts/beastgallery{beast_id}.htm"
    problems = []
    try:
        html = _bestiary_get(session, gallery)
    except requests.RequestException as error:
        problems.append(f"gallery: {error}")
        html = ""

    images = parse_bestiary_gallery(html, gallery)
    for script in [] if images else _gallery_scripts(html, gallery):
        try:
            images = parse_bestiary_gallery(_bestiary_get(session, script), script)
        except requests.RequestException:
            continue
        if images:
            break

    if not images:
        page = f"{BESTIARY}beasts/beast{beast_id}.htm"
        try:
            beast_html = _bestiary_get(session, page)
            images = parse_bestiary_gallery(beast_html, page)
        except requests.RequestException as error:
            if not html:   # only worth reporting if the gallery failed too
                problems.append(f"beast page: {error}")
            beast_html = ""
        if not images:
            if html:
                _bestiary_debug(f"beastgallery{beast_id}.htm", html)
            if beast_html:
                _bestiary_debug(f"beast{beast_id}.htm", beast_html)
    return images, gallery, "; ".join(problems)


def _bestiary_item(name, number, thumb, alt, page):
    title = f"{name}, bestiary image {number}"
    guessed = f"{BESTIARY}beastimage/img{number}.jpg"
    # An address that is already the full image is used as is;
    # otherwise guess the usual one and keep what we found as backup.
    is_full = re.search(rf"/beastimage/img{number}\.\w+$", thumb, re.I)
    return {
        "source": "Medieval Bestiary",
        "id": f"bestiary-{number}",
        "title": title,
        "artist": alt or "Medieval manuscript",
        "date": "medieval",
        "thumb": thumb,
        "full": thumb if is_full else guessed,
        "fallback": None if is_full else thumb,
        "page": page,
        "credit": f"{title}. The Medieval Bestiary (bestiary.ca), from a "
                  f"manuscript held by its library; see that image's Source "
                  f"and Copyright tabs.",
        "rights": BESTIARY_RIGHTS,
    }


def is_bestiary_url(term):
    return bool(re.match(r"\s*https?://(?:www\.)?bestiary\.ca/", term or "", re.I))


def _page_name(html, fallback):
    """'Medieval Bestiary : Encyclopedia : Thomas of Cantimpré' -> 'Thomas of Cantimpré'."""
    title = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    name = _text(title.group(1)).split(":")[-1].strip() if title else ""
    return name or fallback


def _companion_galleries(url):
    """Gallery pages that likely go with a pasted page: a beast's gallery, or
    the gallery for an encyclopedia entry or a manuscript."""
    for pattern, gallery in (
        (r"/beasts/beast[a-z]*?(\d+)\.htm", "beasts/beastgallery{}.htm"),
        (r"/prisources/ps[a-z]*?(\d+)\.htm", "prisources/psgallery{}.htm"),
        (r"/manuscripts/manu[a-z]*?(\d+)\.htm", "manuscripts/manugallery{}.htm"),
    ):
        match = re.search(pattern, url, re.I)
        if match:
            candidate = BESTIARY + gallery.format(match.group(1))
            if candidate.rstrip("/") != url.rstrip("/"):
                return [candidate]
    return []


def bestiary_from_url(url, limit, session, follow=6):
    """Pictures for a bestiary.ca page someone pasted in: the page's own
    pictures, its gallery, then the galleries of up to `follow` beasts it
    links to (an encyclopedia entry lists hundreds; at one request a second
    we stop once we have enough)."""
    url = url.strip().replace("http://", "https://", 1).replace("//www.", "//", 1)
    try:
        html = _bestiary_get(session, url)
    except requests.RequestException as error:
        raise requests.RequestException(f"could not open that page ({str(error)[:90]})")

    name = _page_name(html, "bestiary.ca page")
    out, seen = [], set()

    def add(images, label, page):
        for number, thumb, alt in images:
            if number not in seen and len(out) < limit:
                seen.add(number)
                out.append(_bestiary_item(label, number, thumb, alt, page))

    add(parse_bestiary_gallery(html, url), name, url)
    for gallery in _companion_galleries(url):
        if len(out) >= limit:
            break
        try:
            add(parse_bestiary_gallery(_bestiary_get(session, gallery), gallery), name, gallery)
        except requests.RequestException:
            pass

    linked = parse_bestiary_index(html)
    for beast_id, beast in list(linked.items())[:follow]:
        if len(out) >= limit:
            break
        images, page, _ = bestiary_images(session, beast_id)
        add(images, beast, page)

    if not out:
        _bestiary_debug("pasted-page.htm", html)
        bestiary_note[0] = (f"no pictures found on \u201c{name}\u201d"
                            + (f" or the first {min(follow, len(linked))} beasts it lists"
                               if linked else "")
                            + "; page saved to " + DEBUG_DIR)
    elif linked and len(linked) > follow:
        bestiary_note[0] = (f"{name} lists {len(linked)} beasts; showing pictures from the "
                            f"first {follow}. Search a beast by name for more.")
    return out


def search_bestiary(term, limit, session, key=None):
    """The Medieval Bestiary (bestiary.ca): manuscript illustrations of beasts,
    found by beast name ("owl", "dragon", "unicorn") or by pasting a
    bestiary.ca page address. Its images belong to the holding libraries, so
    every result is flagged as needing a rights check."""
    bestiary_note[0] = ""
    if is_bestiary_url(term):
        return bestiary_from_url(term, limit, session)
    if not search_words(term):
        bestiary_note[0] = ("searches by animal name only \u2014 try owl, lion, dragon, "
                            "unicorn, or paste a bestiary.ca page address")
        return []

    beasts = bestiary_index(session)
    matched = match_beasts(term, beasts)[:3]
    if not matched:
        bestiary_note[0] = (f"no beast called \u201c{' '.join(sorted(search_words(term)))}\u201d "
                            f"among its {len(beasts)} beasts")
        return []

    out, unreadable, problems = [], [], []
    for beast_id in matched:
        name = beasts[beast_id]
        images, page, problem = bestiary_images(session, beast_id)
        if problem:
            problems.append(problem)
        if not images:
            unreadable.append(name)
        for number, thumb, alt in images:
            if len(out) >= limit:
                return out
            out.append(_bestiary_item(name, number, thumb, alt, page))

    if not out:
        if problems:
            bestiary_note[0] = "found " + ", ".join(unreadable) + " but " + problems[0][:100]
        else:
            bestiary_note[0] = ("found " + ", ".join(unreadable) + " but could not read the "
                                "pictures; pages saved to " + DEBUG_DIR)
    return out

SOURCES = {
    "The Met": search_met,
    "Art Institute": search_aic,
    "Cleveland": search_cma,
    "Wikimedia Commons": search_commons,
    "Rijksmuseum": search_rijks,
    "SMK Copenhagen": search_smk,
    "Library of Congress": search_loc,
    "Medieval Bestiary": search_bestiary,
}

NEEDS_KEY = set()   # every source is keyless
CHECK_RIGHTS = {"Medieval Bestiary"}   # sources whose images are not public domain


def slugify(text):
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:45] or "untitled"


# --------------------------------------------------------------------------

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Print Finder \u2014 Owl & Twig")
        self.configure(bg=CREAM)
        self.geometry("1060x800")
        self.minsize(880, 620)

        self.session = requests.Session()
        self.session.headers.update(UA)

        self.term = tk.StringVar(value="woodcut")
        self.per_source = tk.IntVar(value=24)
        self.status = tk.StringVar(value="Ready")
        # Sources ticked last time; everything ticked on a first run.
        ticked = self.load_settings().get("sources")
        self.use = {
            name: tk.BooleanVar(value=not isinstance(ticked, list) or name in ticked)
            for name in SOURCES
        }

        self.results = []
        self.thumbs = {}          # keeps PhotoImage refs alive
        self.shortlist = self.load_shortlist()
        self.rijks_key = tk.StringVar(value="")
        self.messages = queue.Queue()

        self.build()
        self.after(80, self.drain)

    # ---------- persistence ----------

    def load_shortlist(self):
        try:
            with open(SHORTLIST, encoding="utf-8") as handle:
                return json.load(handle)
        except (OSError, ValueError):
            return {}

    def load_settings(self):
        try:
            with open(SETTINGS, encoding="utf-8") as handle:
                settings = json.load(handle)
            return settings if isinstance(settings, dict) else {}
        except (OSError, ValueError):
            return {}

    def save_settings(self):
        settings = self.load_settings()
        settings["sources"] = [name for name in SOURCES if self.use[name].get()]
        try:
            with open(SETTINGS, "w", encoding="utf-8") as handle:
                json.dump(settings, handle)
        except OSError:
            pass

    def save_shortlist(self):
        try:
            with open(SHORTLIST, "w", encoding="utf-8") as handle:
                json.dump(self.shortlist, handle, indent=1)
        except OSError:
            pass

    # ---------- layout ----------

    def build(self):
        head = tk.Frame(self, bg=CREAM, padx=18, pady=14)
        head.pack(fill="x")

        tk.Label(head, text="Print Finder", font=("Georgia", 19), bg=CREAM, fg=MOSS).pack(anchor="w")
        tk.Label(
            head,
            text="Graphic work from museums and archives. Star what you'd print; download only those. "
                 "Tip: paste a bestiary.ca page address to pull its pictures.",
            font=("Georgia", 10, "italic"), bg=CREAM, fg=MUTED,
        ).pack(anchor="w", pady=(2, 0))

        bar = tk.Frame(self, bg=CREAM, padx=18)
        bar.pack(fill="x", pady=(4, 0))

        combo = ttk.Combobox(bar, textvariable=self.term, values=PRESETS, font=("Georgia", 11))
        combo.pack(side="left", fill="x", expand=True, ipady=3)
        combo.bind("<Return>", lambda _: self.search())

        tk.Button(
            bar, text="Search", command=self.search, font=("Georgia", 10),
            bg=MOSS, fg="white", relief="flat", padx=18, pady=5, cursor="hand2",
        ).pack(side="left", padx=(8, 0))

        opts = tk.Frame(self, bg=CREAM, padx=18, pady=4)
        opts.pack(fill="x")
        names = list(SOURCES)
        for index, name in enumerate(names):
            label = name
            tk.Checkbutton(
                opts, text=label, variable=self.use[name], font=("Georgia", 9),
                bg=CREAM, fg=INK, activebackground=CREAM, selectcolor="white",
                command=self.sources_changed,
            ).grid(row=index // 4, column=index % 4, sticky="w", padx=(0, 16))
        self.all_button = tk.Button(
            opts, command=self.toggle_all_sources, font=("Georgia", 9), width=11,
            bg=CREAM, fg=MUTED, relief="solid", bd=1, cursor="hand2",
        )
        self.all_button.grid(row=0, column=4, rowspan=2, sticky="w", padx=(4, 0))
        self.refresh_all_button()

        keyrow = tk.Frame(self, bg=CREAM, padx=18, pady=6)
        keyrow.pack(fill="x")
        tk.Label(keyrow, text="None need an account. Medieval Bestiary images are NOT public domain — "
                              "check rights before printing.",
                 font=("Georgia", 8, "italic"), bg=CREAM, fg=MUTED).pack(side="left")
        tk.Label(keyrow, text="per source", font=("Georgia", 9), bg=CREAM, fg=MUTED).pack(side="right")
        ttk.Spinbox(keyrow, from_=6, to=60, increment=6, width=4,
                    textvariable=self.per_source).pack(side="right", padx=(0, 6))

        tk.Frame(self, bg=RULE, height=1).pack(fill="x", padx=18)

        # scrolling result grid
        wrap = tk.Frame(self, bg=CREAM)
        wrap.pack(fill="both", expand=True, padx=12, pady=8)

        self.canvas = tk.Canvas(wrap, bg=CREAM, highlightthickness=0)
        scroll = tk.Scrollbar(wrap, command=self.canvas.yview)
        self.grid_frame = tk.Frame(self.canvas, bg=CREAM)

        self.grid_frame.bind(
            "<Configure>",
            lambda _: self.canvas.configure(scrollregion=self.canvas.bbox("all")),
        )
        self.canvas.create_window((0, 0), window=self.grid_frame, anchor="nw")
        self.canvas.configure(yscrollcommand=scroll.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self.canvas.bind_all(
            "<MouseWheel>",
            lambda event: self.canvas.yview_scroll(int(-event.delta / 120), "units"),
        )

        foot = tk.Frame(self, bg=CREAM, padx=18, pady=10)
        foot.pack(fill="x")
        tk.Label(foot, textvariable=self.status, font=("Georgia", 9), bg=CREAM, fg=MUTED).pack(side="left")

        self.count_label = tk.Label(foot, text="", font=("Georgia", 10), bg=CREAM, fg=BRASS)
        self.count_label.pack(side="right", padx=(0, 12))
        tk.Button(
            foot, text="Download starred", command=self.download_starred,
            font=("Georgia", 10), bg=BRASS, fg="white", relief="flat",
            padx=16, pady=6, cursor="hand2",
        ).pack(side="right")
        tk.Button(
            foot, text="View shortlist", command=self.show_shortlist,
            font=("Georgia", 10), bg=CREAM, fg=MUTED, relief="solid", bd=1,
            padx=14, pady=5, cursor="hand2",
        ).pack(side="right", padx=(0, 8))

        self.refresh_count()

    # ---------- source choice ----------

    def all_sources_ticked(self):
        return all(var.get() for var in self.use.values())

    def refresh_all_button(self):
        self.all_button.configure(
            text="Select none" if self.all_sources_ticked() else "Select all"
        )

    def toggle_all_sources(self):
        tick = not self.all_sources_ticked()
        for var in self.use.values():
            var.set(tick)
        self.sources_changed()

    def sources_changed(self):
        self.refresh_all_button()
        self.save_settings()

    # ---------- searching ----------

    def search(self):
        term = self.term.get().strip()
        if not term:
            return
        chosen = [name for name in SOURCES if self.use[name].get()]
        if is_bestiary_url(term):
            chosen = ["Medieval Bestiary"]   # a pasted bestiary.ca page means only that
        if not chosen:
            messagebox.showinfo("Pick a source", "Tick at least one museum.")
            return

        for child in self.grid_frame.winfo_children():
            child.destroy()
        self.thumbs.clear()
        self.results = []
        self.status.set(f"Searching for \u201c{term}\u201d\u2026")

        threading.Thread(
            target=self._search_worker, args=(term, chosen), daemon=True
        ).start()

    def _search_worker(self, term, chosen):
        found, notes = [], []
        for name in chosen:
            try:
                items = SOURCES[name](term, self.per_source.get(), self.session,
                                      None)
                found.extend(items)
                self.messages.put(("status", f"{name}: {len(items)}"))
                if name == "Medieval Bestiary" and bestiary_note[0]:
                    notes.append(f"{name}: {bestiary_note[0]}")
            except Exception as error:
                # Any failure in one source must not leave the search hanging.
                self.messages.put(("status", f"{name} failed: {type(error).__name__}"))
                notes.append(f"{name} failed: {error}"[:200])
        self.messages.put(("results", (found, notes)))

    def render(self, found, notes=()):
        self.results = found
        columns = 4
        first_row = 0
        if notes:
            # Say why a source came back empty, above the results.
            tk.Label(
                self.grid_frame, text="\n".join(notes), font=("Georgia", 9, "italic"),
                bg=CREAM, fg=BRASS, justify="left", anchor="w", wraplength=820,
            ).grid(row=0, column=0, columnspan=columns, sticky="w", padx=8, pady=(4, 8))
            first_row = 1
        if not found:
            tk.Label(
                self.grid_frame,
                text="Nothing came back. Try a broader word \u2014 'woodcut' rather than 'Dutch woodcut 1918'.",
                font=("Georgia", 11, "italic"), bg=CREAM, fg=MUTED,
            ).grid(row=first_row, column=0, columnspan=columns, padx=20, pady=40)
            self.status.set("No results")
            return

        for index, item in enumerate(found):
            tile = tk.Frame(self.grid_frame, bg=CREAM, padx=6, pady=6)
            tile.grid(row=first_row + index // columns, column=index % columns, sticky="n")

            holder = tk.Label(tile, bg="white", width=26, height=11,
                              relief="solid", bd=1, text="\u2026", fg=MUTED)
            holder.pack()
            holder.bind("<Button-1>", lambda _, url=item["page"]: url and webbrowser.open(url))

            caption = item["title"][:42] + ("\u2026" if len(item["title"]) > 42 else "")
            tk.Label(tile, text=caption, font=("Georgia", 9), bg=CREAM, fg=INK,
                     wraplength=190, justify="left").pack(anchor="w", pady=(4, 0))
            tk.Label(tile, text=f"{item['source']} \u00b7 {item['date']}"[:46],
                     font=("Georgia", 8), bg=CREAM, fg=MUTED,
                     wraplength=190, justify="left").pack(anchor="w")
            if item["source"] in CHECK_RIGHTS:
                tk.Label(tile, text="\u26a0 check rights before printing",
                         font=("Georgia", 8, "italic"), bg=CREAM, fg=BRASS).pack(anchor="w")

            starred = item["id"] in self.shortlist
            button = tk.Button(
                tile, font=("Georgia", 9), relief="flat", cursor="hand2",
                bg=STAR if starred else CREAM,
                fg="white" if starred else MUTED,
                text="\u2605 Starred" if starred else "\u2606 Star",
            )
            button.configure(command=lambda i=item, b=button: self.toggle(i, b))
            button.pack(anchor="w", pady=(3, 0))

            threading.Thread(
                target=self._thumb_worker, args=(item, holder), daemon=True
            ).start()

        self.status.set(f"{len(found)} results")

    def _thumb_worker(self, item, holder):
        try:
            response = self.session.get(item["thumb"], timeout=45)
            response.raise_for_status()
            image = Image.open(io.BytesIO(response.content))
            image.thumbnail((190, 190))
            self.messages.put(("thumb", (item["id"], image, holder)))
        except Exception:
            self.messages.put(("thumbfail", holder))

    def place_thumb(self, item_id, image, holder):
        photo = ImageTk.PhotoImage(image)
        self.thumbs[item_id] = photo
        holder.configure(image=photo, width=190, height=190, text="")

    # ---------- shortlist ----------

    def toggle(self, item, button):
        if item["id"] in self.shortlist:
            del self.shortlist[item["id"]]
            button.configure(text="\u2606 Star", bg=CREAM, fg=MUTED)
        else:
            self.shortlist[item["id"]] = item
            button.configure(text="\u2605 Starred", bg=STAR, fg="white")
        self.save_shortlist()
        self.refresh_count()

    def refresh_count(self):
        total = len(self.shortlist)
        self.count_label.configure(text=f"{total} starred" if total else "nothing starred yet")

    def show_shortlist(self):
        if not self.shortlist:
            messagebox.showinfo("Shortlist", "Nothing starred yet.")
            return
        window = tk.Toplevel(self)
        window.title("Shortlist")
        window.configure(bg=CREAM)
        window.geometry("620x480")

        text = tk.Text(window, font=("Consolas", 9), bg="white", fg=INK,
                       relief="solid", bd=1, wrap="word")
        text.pack(fill="both", expand=True, padx=12, pady=12)
        for item in self.shortlist.values():
            text.insert("end", f"{item['title']}\n  {item['artist']} \u00b7 {item['date']}\n"
                               f"  {item['source']}\n  {item['page']}\n\n")
        text.configure(state="disabled")

        tk.Button(
            window, text="Clear shortlist", font=("Georgia", 9),
            bg=CREAM, fg=MUTED, relief="solid", bd=1, padx=12, pady=4,
            command=lambda: (self.shortlist.clear(), self.save_shortlist(),
                             self.refresh_count(), window.destroy()),
        ).pack(pady=(0, 12))

    # ---------- downloading ----------

    def download_starred(self):
        if not self.shortlist:
            messagebox.showinfo("Nothing starred", "Star a few images first.")
            return
        folder = filedialog.askdirectory(
            title="Where should these go?", initialdir=os.path.join(HOME, "Downloads")
        )
        if not folder:
            return
        threading.Thread(
            target=self._download_worker,
            args=(folder, list(self.shortlist.values())),
            daemon=True,
        ).start()

    def _download_worker(self, folder, items):
        target = os.path.join(folder, "print-finder")
        os.makedirs(target, exist_ok=True)
        rows = []

        for index, item in enumerate(items, start=1):
            self.messages.put(("status", f"Downloading {index} of {len(items)}"))
            name = f"{slugify(item['source'])}_{slugify(item['title'])}.jpg"
            path = os.path.join(target, name)

            try:
                if not os.path.exists(path):
                    try:
                        response = self.session.get(item["full"], timeout=240)
                        response.raise_for_status()
                    except requests.RequestException:
                        if not item.get("fallback"):
                            raise
                        response = self.session.get(item["fallback"], timeout=240)
                        response.raise_for_status()
                    with open(path, "wb") as handle:
                        handle.write(response.content)
                rows.append(
                    {
                        "file": name,
                        "title": item["title"],
                        "artist": item["artist"],
                        "date": item["date"],
                        "source": item["source"],
                        "page": item["page"],
                        "credit_line": item["credit"],
                        "rights": item.get("rights", "Public domain / CC0"),
                    }
                )
            except requests.RequestException as error:
                self.messages.put(("status", f"{name}: {type(error).__name__}"))

        if rows:
            with open(os.path.join(target, "provenance.csv"), "w",
                      newline="", encoding="utf-8-sig") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
                writer.writeheader()
                writer.writerows(rows)

        restricted = sum(1 for row in rows if row["source"] in CHECK_RIGHTS)
        self.messages.put(("done", (target, len(rows), restricted)))

    # ---------- message pump ----------

    def drain(self):
        try:
            while True:
                kind, value = self.messages.get_nowait()
                if kind == "status":
                    self.status.set(value)
                elif kind == "results":
                    self.render(*value)
                elif kind == "thumb":
                    self.place_thumb(*value)
                elif kind == "thumbfail":
                    value.configure(text="no image")
                elif kind == "done":
                    target, count, restricted = value
                    self.status.set(f"Saved {count} files")
                    warning = (
                        f"\n\n{restricted} of them are from the Medieval Bestiary and are "
                        "NOT public domain. Check the rights column in provenance.csv "
                        "before printing them."
                    ) if restricted else ""
                    if messagebox.askyesno(
                        "Finished",
                        f"{count} images and provenance.csv saved.{warning}\n\nOpen the folder?",
                    ):
                        webbrowser.open(f"file:///{target}")
        except queue.Empty:
            pass
        self.after(80, self.drain)


if __name__ == "__main__":
    App().mainloop()
