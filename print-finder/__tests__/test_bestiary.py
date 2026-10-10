"""Tests for the Medieval Bestiary (bestiary.ca) source in print-finder.pyw.

Standard library only. From the print-finder folder:

    python -m unittest discover -s __tests__ -v

The GUI is never opened: tkinter is stubbed so the module can be imported
headless, and the network is a fake session serving canned HTML.
"""

import csv
import importlib.util
import json
import os
import queue
import sys
import tempfile
import types
import unittest
from unittest import mock

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
PROGRAM = os.path.join(HERE, os.pardir, "print-finder.pyw")


def _load_program():
    """Import print-finder.pyw with tkinter and PIL.ImageTk stubbed."""
    tk = types.ModuleType("tkinter")
    tk.Tk = type("Tk", (), {})
    for name in ("filedialog", "messagebox", "ttk"):
        sub = types.ModuleType(f"tkinter.{name}")
        setattr(tk, name, sub)
        sys.modules[f"tkinter.{name}"] = sub
    sys.modules["tkinter"] = tk
    sys.modules["PIL.ImageTk"] = types.ModuleType("PIL.ImageTk")

    loader = importlib.machinery.SourceFileLoader("print_finder", PROGRAM)
    spec = importlib.util.spec_from_loader("print_finder", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


pf = _load_program()


INDEX_HTML = """
<html><body>
<ul>
  <li><a href="beasts/beast155.htm">Owl</a></li>
  <li><a href="beasts/beast156.htm"><b>Horned</b> Owl</a></li>
  <li><a href="beasts/beast262.htm">Lion</a></li>
  <li><a href="beasts/beast100.htm">Cat</a></li>
  <li><a href="beasts/beast300.htm">Sea-horse</a></li>
  <li><a href="beasts/beast400.htm">Ant &amp; Antlion</a></li>
  <li><a href="beasts/beastgallery155.htm">Owl gallery</a></li>
  <li><a href="beasts/beastbiblio155.htm">Owl bibliography</a></li>
</ul>
</body></html>
"""

# Thumbnails in a separate folder: the full image has to be guessed.
GALLERY_THUMBS = """
<img src="../images/logo.gif" alt="Medieval Bestiary">
<img src="../beastimage/thumbs/img1001.jpg" alt="Owl mobbed by birds">
<img src='../beastimage/thumbs/img1002.jpg' alt='Owl, BL Harley 4751 f. 47r'>
<img src="../beastimage/thumbs/img1001.jpg" alt="duplicate of the first">
<img src="/beastimage/thumbs/img1003.JPG">
"""

# Gallery that shows the full images directly.
GALLERY_FULL = '<img src="/beastimage/img2001.png" alt="Lion">'


class FakeSession:
    """Serves canned pages by URL. Anything else is a 404."""

    def __init__(self, pages):
        self.pages = pages
        self.requested = []

    def get(self, url, timeout=None, **_):
        self.requested.append(url)
        response = requests.Response()
        response.url = url
        if url in self.pages:
            response.status_code = 200
            body = self.pages[url]
            response._content = body if isinstance(body, bytes) else body.encode("utf-8")
        else:
            response.status_code = 404
            response._content = b""
        return response


class BestiaryTestCase(unittest.TestCase):
    """Isolates the index cache and skips the one-request-a-second wait."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        cache = os.path.join(self.tmp.name, "bestiary.json")
        self.debug = os.path.join(self.tmp.name, "debug")
        for patch in (
            mock.patch.object(pf, "BESTIARY_CACHE", cache),
            mock.patch.object(pf, "DEBUG_DIR", self.debug),
            mock.patch.object(pf.time, "sleep"),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.cache = cache


class ParseIndexTests(unittest.TestCase):
    def test_reads_beast_links_and_names(self):
        beasts = pf.parse_bestiary_index(INDEX_HTML)
        self.assertEqual(beasts["155"], ["Owl"])
        self.assertEqual(beasts["262"], ["Lion"])

    def test_strips_inner_tags_and_entities(self):
        beasts = pf.parse_bestiary_index(INDEX_HTML)
        self.assertEqual(beasts["156"], ["Horned Owl"])
        self.assertEqual(beasts["400"], ["Ant & Antlion"])

    def test_ignores_gallery_and_bibliography_links(self):
        beasts = pf.parse_bestiary_index(INDEX_HTML)
        names = [n for names in beasts.values() for n in names]
        self.assertNotIn("Owl gallery", names)
        self.assertNotIn("Owl bibliography", names)
        self.assertEqual(len(beasts), 6)

    def test_every_name_of_a_beast_is_kept_once(self):
        html = ('<a href="beast1.htm">Owl</a> <a href="beast1.htm">Bubo</a>'
                '<a href="beast1.htm">owl</a>')
        self.assertEqual(pf.parse_bestiary_index(html), {"1": ["Owl", "Bubo"]})

    def test_empty_page(self):
        self.assertEqual(pf.parse_bestiary_index("<html></html>"), {})


class ParseGalleryTests(unittest.TestCase):
    BASE = "https://bestiary.ca/beasts/beastgallery155.htm"

    def test_reads_images_in_order_without_duplicates(self):
        images = pf.parse_bestiary_gallery(GALLERY_THUMBS, self.BASE)
        self.assertEqual([number for number, _, _ in images], ["1001", "1002", "1003"])

    def test_resolves_relative_and_root_paths(self):
        images = dict((n, t) for n, t, _ in pf.parse_bestiary_gallery(GALLERY_THUMBS, self.BASE))
        self.assertEqual(images["1001"], "https://bestiary.ca/beastimage/thumbs/img1001.jpg")
        self.assertEqual(images["1003"], "https://bestiary.ca/beastimage/thumbs/img1003.JPG")

    def test_keeps_alt_text_and_handles_single_quotes(self):
        alts = {n: a for n, _, a in pf.parse_bestiary_gallery(GALLERY_THUMBS, self.BASE)}
        self.assertEqual(alts["1002"], "Owl, BL Harley 4751 f. 47r")
        self.assertEqual(alts["1003"], "")

    def test_skips_site_artwork(self):
        thumbs = [t for _, t, _ in pf.parse_bestiary_gallery(GALLERY_THUMBS, self.BASE)]
        self.assertFalse(any("logo" in t for t in thumbs))


class OtherPageLayoutTests(unittest.TestCase):
    """The live site could not be inspected, so the readers accept any of the
    usual ways a page can name its pictures and its beasts."""

    BASE = "https://bestiary.ca/beasts/beastgallery79.htm"

    def numbers(self, html):
        return [n for n, _, _ in pf.parse_bestiary_gallery(html, self.BASE)]

    def test_javascript_slideshow_list(self):
        html = '<script>var pics = ["../beastimage/img5.jpg", \'../beastimage/img6.jpg\'];</script>'
        self.assertEqual(self.numbers(html), ["5", "6"])

    def test_json_with_escaped_slashes(self):
        html = '<script>{"src":"\\/beastimage\\/img7.jpg"}</script>'
        images = pf.parse_bestiary_gallery(html, self.BASE)
        self.assertEqual(images[0][1], "https://bestiary.ca/beastimage/img7.jpg")

    def test_unquoted_attributes_links_and_data_attributes(self):
        html = ('<img src=../beastimage/img8.jpg>'
                '<a href="../beastimage/img9.jpg">big</a>'
                '<div data-full="/beastimage/img10.png"></div>')
        self.assertEqual(self.numbers(html), ["8", "9", "10"])

    def test_thumbnail_and_full_of_one_picture_count_once(self):
        html = ('<a href="../beastimage/img11.jpg"><img src="../beastimage/thumbs/img11.jpg"'
                ' title="Lion and cubs"></a>')
        images = pf.parse_bestiary_gallery(html, self.BASE)
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0][1], "https://bestiary.ca/beastimage/img11.jpg")
        self.assertEqual(images[0][2], "Lion and cubs")

    def test_words_that_merely_end_in_img_are_not_pictures(self):
        self.assertEqual(self.numbers('<div style="background:url(logoimg9.gif)">'), [])

    def test_picture_links_named_by_title_or_alt(self):
        html = ('<a href="beast245.htm" title="Owl"><img src="owl.gif"></a>'
                '<a href="beast181.htm"><img src="dog.gif" alt="Dog"></a>')
        self.assertEqual(pf.parse_bestiary_index(html), {"245": ["Owl"], "181": ["Dog"]})

    def test_drop_down_and_clickable_rows(self):
        html = ('<select><option value="beast245.htm">Owl</option></select>'
                '<table><tr onclick="location.href=\'beast181.htm\'"><td>Dog</td></tr></table>')
        self.assertEqual(pf.parse_bestiary_index(html), {"245": ["Owl"], "181": ["Dog"]})

    def test_rows_holding_a_gallery_link_are_not_beasts(self):
        html = '<li data-go="beastgallery245.htm">Owl gallery</li>'
        self.assertEqual(pf.parse_bestiary_index(html), {})

    def test_index_links_in_any_style(self):
        html = ("<a href='beast1.htm'>Owl</a>"
                '<a href=beast2.htm>Lion</a>'
                '<a href="https://bestiary.ca/beasts/beast3.html">Cat</a>'
                '<a class="x" href="/beasts/beast4.htm#top">Dog</a>')
        self.assertEqual(pf.parse_bestiary_index(html),
                         {"1": ["Owl"], "2": ["Lion"], "3": ["Cat"], "4": ["Dog"]})


# bestiary.ca's real beast list layout, trimmed: one row per name the beast
# went by, the medieval name linked, the common name in the next column.
REAL_TABLE = """
<table id="filter-table" class="beast-table3 note-text">
  <tr><th>Name</th><th>Common</th><th>Type</th><th></th></tr>
  <tr>
    <td><a href="beast245.htm">Bubo</a></td>
    <td>Owl</td><td>Bird</td><td></td>
  </tr><tr>
    <td><span id="letter-C"></span>
<a href="beast181.htm">Ca</a></td>
    <td>Dog</td><td>Beast</td><td></td>
  </tr><tr>
    <td><a href="beast181.htm">Canis</a></td>
    <td>Dog</td><td>Beast</td><td>Dogs are loyal to their masters</td>
  </tr><tr>
    <td><a href="beast245.htm">Chat-huant</a></td>
    <td>Owl</td><td>Bird</td><td></td>
  </tr><tr>
    <td><a href="beast100.htm">Fish</a></td>
    <td>Fish</td><td>Fish</td><td>Fish are creatures of the water</td>
  </tr><tr>
    <td><a href="beast350.htm">Canis marinus</a></td>
    <td>Sea-dog</td><td>Fish</td><td></td>
  </tr>
</table>
"""


class RealListLayoutTests(unittest.TestCase):
    """Owls and dogs went missing because only the first, medieval name of
    each beast was read ("Bubo", "Ca") and never its common name."""

    def setUp(self):
        self.beasts = pf.parse_bestiary_index(REAL_TABLE)

    def test_common_name_comes_first_then_medieval_names(self):
        self.assertEqual(self.beasts["245"], ["Owl", "Bubo", "Chat-huant"])
        self.assertEqual(self.beasts["181"], ["Dog", "Ca", "Canis"])

    def test_type_and_description_columns_are_not_names(self):
        names = [n for names in self.beasts.values() for n in names]
        self.assertNotIn("Bird", names)
        self.assertNotIn("Dogs are loyal to their masters", names)

    def test_owl_and_dog_are_found_by_common_name(self):
        self.assertEqual(pf.match_beasts("owl", self.beasts), ["245"])
        self.assertEqual(pf.match_beasts("dogs", self.beasts), ["181", "350"])

    def test_medieval_names_work_too(self):
        self.assertEqual(pf.match_beasts("bubo", self.beasts), ["245"])
        self.assertEqual(pf.match_beasts("canis", self.beasts)[0], "181")

    def test_searching_a_type_does_not_match_every_beast_of_that_type(self):
        self.assertEqual(pf.match_beasts("bird", self.beasts), [])

    def test_header_row_is_not_a_beast(self):
        self.assertEqual(set(self.beasts), {"245", "181", "100", "350"})


class MatchBeastsTests(unittest.TestCase):
    BEASTS = {"155": ["Owl"], "156": ["Horned Owl"], "262": ["Lion"], "100": ["Cat"],
              "300": ["Sea-horse"]}

    def test_medium_words_are_ignored(self):
        self.assertEqual(pf.match_beasts("owl woodcut print", self.BEASTS)[0], "155")

    def test_whole_name_matches_come_first(self):
        self.assertEqual(pf.match_beasts("owl", self.BEASTS), ["155", "156"])

    def test_plurals_match(self):
        self.assertEqual(pf.match_beasts("cats", self.BEASTS), ["100"])
        self.assertEqual(pf.match_beasts("lions", self.BEASTS), ["262"])

    def test_hyphenated_names(self):
        self.assertEqual(pf.match_beasts("sea-horse", self.BEASTS), ["300"])

    def test_only_medium_words_gives_nothing(self):
        self.assertEqual(pf.match_beasts("woodcut", self.BEASTS), [])
        self.assertEqual(pf.match_beasts("Japanese woodblock print", self.BEASTS), [])

    def test_no_such_beast(self):
        self.assertEqual(pf.match_beasts("skeleton skull", self.BEASTS), [])

    def test_hyphenated_names_match_their_parts(self):
        beasts = {"1": ["Screech-owl"], "2": ["Owl"]}
        self.assertEqual(pf.match_beasts("owl", beasts), ["2", "1"])

    def test_short_words_ending_in_s_are_not_stemmed(self):
        self.assertEqual(pf.match_beasts("ass", {"1": ["Ass"]}), ["1"])


class SearchBestiaryTests(BestiaryTestCase):
    def pages(self, **extra):
        pages = {
            "https://bestiary.ca/beasts/beastalpha.htm": INDEX_HTML,
            "https://bestiary.ca/beasts/beastgallery155.htm": GALLERY_THUMBS,
            "https://bestiary.ca/beasts/beastgallery262.htm": GALLERY_FULL,
        }
        pages.update(extra)
        return pages

    def test_returns_items_with_the_shared_shape(self):
        items = pf.search_bestiary("owl", 24, FakeSession(self.pages()))
        self.assertEqual(len(items), 3)
        expected = {"source", "id", "title", "artist", "date", "thumb", "full",
                    "page", "credit", "rights"}
        for item in items:
            self.assertTrue(expected <= set(item))
            self.assertEqual(item["source"], "Medieval Bestiary")

    def test_every_result_is_flagged_not_public_domain(self):
        items = pf.search_bestiary("owl", 24, FakeSession(self.pages()))
        for item in items:
            self.assertIn("library", item["rights"])
            self.assertNotIn("CC0", item["credit"])
        self.assertIn("Medieval Bestiary", pf.CHECK_RIGHTS)

    def test_titles_are_unique_so_downloads_do_not_overwrite(self):
        items = pf.search_bestiary("owl", 24, FakeSession(self.pages()))
        names = {pf.slugify(i["title"]) for i in items}
        self.assertEqual(len(names), len(items))

    def test_thumbnail_gallery_guesses_full_image_and_keeps_thumb_as_fallback(self):
        item = pf.search_bestiary("owl", 24, FakeSession(self.pages()))[0]
        self.assertEqual(item["full"], "https://bestiary.ca/beastimage/img1001.jpg")
        self.assertEqual(item["fallback"], "https://bestiary.ca/beastimage/thumbs/img1001.jpg")
        self.assertEqual(item["artist"], "Owl mobbed by birds")

    def test_full_image_gallery_uses_the_real_address(self):
        item = pf.search_bestiary("lion", 24, FakeSession(self.pages()))[0]
        self.assertEqual(item["full"], "https://bestiary.ca/beastimage/img2001.png")
        self.assertIsNone(item["fallback"])

    def test_limit_is_respected(self):
        self.assertEqual(len(pf.search_bestiary("owl", 2, FakeSession(self.pages()))), 2)

    def test_missing_gallery_is_skipped_not_fatal(self):
        # Horned Owl (156) has no gallery page in the fake site.
        items = pf.search_bestiary("horned owl", 24, FakeSession(self.pages()))
        self.assertEqual({i["page"] for i in items},
                         {"https://bestiary.ca/beasts/beastgallery155.htm"})

    def test_unmatched_search_returns_nothing_and_fetches_no_gallery(self):
        session = FakeSession(self.pages())
        self.assertEqual(pf.search_bestiary("woodcut", 24, session), [])
        self.assertFalse(any("beastgallery" in url for url in session.requested))

    def test_site_down_raises_request_error_for_the_status_line(self):
        with self.assertRaises(requests.RequestException):
            pf.search_bestiary("owl", 24, FakeSession({}))

    def test_falls_back_to_second_index_page(self):
        pages = self.pages()
        del pages["https://bestiary.ca/beasts/beastalpha.htm"]
        pages["https://bestiary.ca/beasts.htm"] = INDEX_HTML
        self.assertEqual(len(pf.search_bestiary("owl", 24, FakeSession(pages))), 3)

    def test_index_is_cached_between_searches(self):
        pf.search_bestiary("owl", 24, FakeSession(self.pages()))
        second = FakeSession(self.pages())
        pf.search_bestiary("owl", 24, second)
        self.assertNotIn("https://bestiary.ca/beasts/beastalpha.htm", second.requested)

    def test_stale_or_corrupt_cache_is_refetched(self):
        for content in ('{"saved": 0, "beasts": {"1": ["Owl"]}}', "[]", "not json"):
            with open(self.cache, "w", encoding="utf-8") as handle:
                handle.write(content)
            session = FakeSession(self.pages())
            pf.search_bestiary("owl", 24, session)
            self.assertIn("https://bestiary.ca/beasts/beastalpha.htm", session.requested)
        with open(self.cache, encoding="utf-8") as handle:
            self.assertIn("155", json.load(handle)["beasts"])

    def test_requests_are_spaced_out(self):
        pf._bestiary_last[0] = pf.time.monotonic()
        pf._bestiary_get(FakeSession({"https://x.test/": "ok"}), "https://x.test/")
        self.assertTrue(pf.time.sleep.called)


class FullBeastListTests(BestiaryTestCase):
    """Owls went missing because the beast list is spread over several pages
    and only the first two were read."""

    ALPHA = "https://bestiary.ca/beasts/beastalpha.htm"

    def site(self):
        return {
            self.ALPHA: ('<a href="beastalpha.htm?l=A">A</a> <a href="beastalphaO.htm">O</a>'
                         '<a href="beast100.htm">Fish</a>'
                         '<a href="beastgallery100.htm">Fish gallery</a>'
                         '<a href="https://elsewhere.example/beastlist.htm">x</a>'),
            "https://bestiary.ca/beasts/beastalpha.htm?l=A": '<a href="beast1.htm">Amphisbaena</a>',
            "https://bestiary.ca/beasts/beastalphaO.htm":
                ('<a href="beast245.htm">Owl</a> <a href="beastalpha.htm">back</a>'),
            "https://bestiary.ca/beasts/beastgallery245.htm": '<img src="/beastimage/img245.jpg">',
        }

    def test_follows_every_list_page(self):
        session = FakeSession(self.site())
        beasts = pf.bestiary_index(session)
        self.assertEqual(beasts, {"100": ["Fish"], "1": ["Amphisbaena"], "245": ["Owl"]})
        self.assertEqual(session.requested.count(self.ALPHA), 1)
        self.assertFalse(any("elsewhere" in url for url in session.requested))
        self.assertFalse(any("beastgallery" in url for url in session.requested))

    def test_owl_is_found(self):
        items = pf.search_bestiary("owl", 24, FakeSession(self.site()))
        self.assertEqual([i["id"] for i in items], ["bestiary-245"])

    def test_list_saved_by_an_older_version_is_replaced(self):
        with open(self.cache, "w", encoding="utf-8") as handle:
            json.dump({"saved": pf.time.time(), "beasts": {"100": "Fish"}}, handle)
        items = pf.search_bestiary("owl", 24, FakeSession(self.site()))
        self.assertEqual(len(items), 1)
        with open(self.cache, encoding="utf-8") as handle:
            saved = json.load(handle)
        self.assertEqual(saved["version"], pf.INDEX_VERSION)
        self.assertIn("245", saved["beasts"])

    def test_page_limit_stops_runaway_crawls(self):
        pages = {f"https://bestiary.ca/beasts/beastlist{chr(97 + n)}.htm":
                 f'<a href="beast{n}.htm">B{n}</a><a href="beastlist{chr(98 + n)}.htm">next</a>'
                 for n in range(25)}
        pages[self.ALPHA] = '<a href="beastlista.htm">start</a>'
        session = FakeSession(pages)
        with mock.patch.object(pf, "INDEX_MAX_PAGES", 5):
            pf.bestiary_index(session)
        self.assertEqual(len(session.requested), 5)


class RealListSearchTests(BestiaryTestCase):
    def test_owl_search_shows_owl_pictures_titled_owl(self):
        pages = {
            "https://bestiary.ca/beasts/beastalpha.htm": REAL_TABLE,
            "https://bestiary.ca/beasts/beastgallery245.htm": '<img src="/beastimage/img7.jpg">',
        }
        items = pf.search_bestiary("owl", 24, FakeSession(pages))
        self.assertEqual([i["title"] for i in items], ["Owl, bestiary image 7"])

    def test_list_saved_in_the_old_one_name_format_is_replaced(self):
        with open(self.cache, "w", encoding="utf-8") as handle:
            json.dump({"version": pf.INDEX_VERSION, "saved": pf.time.time(),
                       "beasts": {"245": "Bubo"}}, handle)
        session = FakeSession({"https://bestiary.ca/beasts/beastalpha.htm": REAL_TABLE})
        self.assertEqual(pf.bestiary_index(session)["245"][0], "Owl")


class FallbackAndExplanationTests(BestiaryTestCase):
    INDEX = "https://bestiary.ca/beasts/beastalpha.htm"
    GALLERY = "https://bestiary.ca/beasts/beastgallery155.htm"

    def test_gallery_that_loads_its_list_from_a_script_file(self):
        pages = {
            self.INDEX: INDEX_HTML,
            self.GALLERY: '<script src="../js/jquery.min.js"></script>'
                          '<script src="../js/gallery155.js"></script>',
            "https://bestiary.ca/js/gallery155.js": 'show(["/beastimage/img42.jpg"]);',
        }
        session = FakeSession(pages)
        items = pf.search_bestiary("owl", 24, session)
        self.assertEqual([i["id"] for i in items], ["bestiary-42"])
        self.assertNotIn("https://bestiary.ca/js/jquery.min.js", session.requested)

    def test_scripts_from_other_sites_are_not_fetched(self):
        html = '<script src="https://cdn.example.com/gallery.js"></script>'
        self.assertEqual(pf._gallery_scripts(html, self.GALLERY), [])

    def test_beast_page_is_used_when_the_gallery_has_nothing(self):
        pages = {
            self.INDEX: INDEX_HTML,
            self.GALLERY: "<p>no pictures here</p>",
            "https://bestiary.ca/beasts/beast155.htm": '<img src="/beastimage/img77.jpg">',
        }
        items = pf.search_bestiary("owl", 24, FakeSession(pages))
        self.assertIn("bestiary-77", [i["id"] for i in items])

    def test_unreadable_pages_are_saved_and_explained(self):
        pages = {self.INDEX: INDEX_HTML, self.GALLERY: "<p>mystery layout</p>",
                 "https://bestiary.ca/beasts/beastgallery156.htm": "<p>also odd</p>"}
        self.assertEqual(pf.search_bestiary("owl", 24, FakeSession(pages)), [])
        self.assertIn("could not read the pictures", pf.bestiary_note[0])
        self.assertIn("Owl", pf.bestiary_note[0])
        self.assertIn("beastgallery155.htm", os.listdir(self.debug))

    def test_blocked_gallery_says_so(self):
        pages = {self.INDEX: INDEX_HTML}
        self.assertEqual(pf.search_bestiary("lion", 24, FakeSession(pages)), [])
        self.assertIn("404", pf.bestiary_note[0])

    def test_search_without_an_animal_explains_itself(self):
        self.assertEqual(pf.search_bestiary("woodcut", 24, FakeSession({})), [])
        self.assertIn("animal name", pf.bestiary_note[0])

    def test_unknown_animal_explains_itself(self):
        pf.search_bestiary("zebra print", 24, FakeSession({self.INDEX: INDEX_HTML}))
        self.assertIn("zebra", pf.bestiary_note[0])
        self.assertIn("6 beasts", pf.bestiary_note[0])

    def test_beast_list_with_no_beasts_is_saved_and_reported(self):
        pages = {self.INDEX: "<p>new design</p>", "https://bestiary.ca/beasts.htm": "<p>?</p>"}
        with self.assertRaises(requests.RequestException) as caught:
            pf.search_bestiary("owl", 24, FakeSession(pages))
        self.assertIn("found no beasts", str(caught.exception))
        self.assertIn("beasts_beastalpha.htm", os.listdir(self.debug))

    def test_unreachable_site_names_the_http_error(self):
        with self.assertRaises(requests.RequestException) as caught:
            pf.search_bestiary("owl", 24, FakeSession({}))
        self.assertIn("could not reach bestiary.ca", str(caught.exception))
        self.assertIn("404", str(caught.exception))


class PastedLinkTests(BestiaryTestCase):
    """A bestiary.ca address typed into the search box, such as the
    encyclopedia entry for Thomas of Cantimpre."""

    PAGE = "https://bestiary.ca/prisources/psdetail1798.htm"
    ENTRY = """<html><head><title>Medieval Bestiary : Encyclopedia : Thomas of Cantimpr&eacute;</title>
    </head><body>
      <a href="../beasts/beast155.htm">Owl</a>
      <a href="../beasts/beast262.htm">Lion</a>
      <a href="../beasts/beast100.htm">Cat</a>
    </body></html>"""

    def pages(self, **extra):
        pages = {
            self.PAGE: self.ENTRY,
            "https://bestiary.ca/beasts/beastgallery155.htm": GALLERY_THUMBS,
            "https://bestiary.ca/beasts/beastgallery262.htm": GALLERY_FULL,
        }
        pages.update(extra)
        return pages

    def test_recognises_bestiary_links_only(self):
        self.assertTrue(pf.is_bestiary_url(self.PAGE))
        self.assertTrue(pf.is_bestiary_url("  http://www.bestiary.ca/beasts/beast155.htm"))
        self.assertFalse(pf.is_bestiary_url("owl"))
        self.assertFalse(pf.is_bestiary_url("https://example.com/bestiary.ca/"))

    def test_follows_the_beasts_an_entry_lists(self):
        items = pf.search_bestiary(self.PAGE, 24, FakeSession(self.pages()))
        self.assertEqual([i["id"] for i in items],
                         ["bestiary-1001", "bestiary-1002", "bestiary-1003", "bestiary-2001"])
        self.assertTrue(items[0]["title"].startswith("Owl,"))
        self.assertTrue(all(i["rights"] == pf.BESTIARY_RIGHTS for i in items))

    def test_tries_the_entry_gallery_first(self):
        session = FakeSession(self.pages(**{
            "https://bestiary.ca/prisources/psgallery1798.htm": '<img src="/beastimage/img500.jpg">',
        }))
        items = pf.search_bestiary(self.PAGE, 24, session)
        self.assertEqual(items[0]["id"], "bestiary-500")
        self.assertEqual(items[0]["title"], "Thomas of Cantimpr\u00e9, bestiary image 500")

    def test_stops_following_once_it_has_enough(self):
        session = FakeSession(self.pages())
        items = pf.search_bestiary(self.PAGE, 2, session)
        self.assertEqual(len(items), 2)
        self.assertNotIn("https://bestiary.ca/beasts/beastgallery262.htm", session.requested)

    def test_long_lists_say_only_the_first_few_were_used(self):
        entry = "<title>A : B : Big List</title>" + "".join(
            f'<a href="../beasts/beast{n}.htm">Beast {n}</a>' for n in range(1, 21))
        galleries = {f"https://bestiary.ca/beasts/beastgallery{n}.htm":
                     f'<img src="/beastimage/img{900 + n}.jpg">' for n in range(1, 21)}
        items = pf.search_bestiary(self.PAGE, 50, FakeSession({self.PAGE: entry, **galleries}))
        self.assertEqual(len(items), 6)
        self.assertIn("lists 20 beasts", pf.bestiary_note[0])

    def test_page_with_nothing_usable_is_saved_and_explained(self):
        items = pf.search_bestiary(self.PAGE, 24, FakeSession({self.PAGE: "<title>X : Empty</title>"}))
        self.assertEqual(items, [])
        self.assertIn("no pictures found on \u201cEmpty\u201d", pf.bestiary_note[0])
        self.assertIn("pasted-page.htm", os.listdir(self.debug))

    def test_unreachable_page_says_so(self):
        with self.assertRaises(requests.RequestException) as caught:
            pf.search_bestiary(self.PAGE, 24, FakeSession({}))
        self.assertIn("could not open that page", str(caught.exception))

    def test_pasted_beast_page_uses_its_gallery(self):
        page = "https://bestiary.ca/beasts/beast262.htm"
        items = pf.search_bestiary(page, 24, FakeSession(self.pages(**{page: "<title>A : Lion</title>"})))
        self.assertEqual([i["id"] for i in items], ["bestiary-2001"])

    def test_pasted_gallery_is_not_fetched_twice(self):
        page = "https://bestiary.ca/beasts/beastgallery262.htm"
        session = FakeSession(self.pages())
        pf.search_bestiary(page, 24, session)
        self.assertEqual(session.requested.count(page), 1)


class SearchWorkerTests(unittest.TestCase):
    def run_worker(self, sources):
        app = pf.App.__new__(pf.App)
        app.session = None
        app.messages = queue.Queue()
        app.per_source = mock.Mock(get=mock.Mock(return_value=24))
        with mock.patch.dict(pf.SOURCES, sources, clear=True):
            app._search_worker("owl", list(sources))
        messages = []
        while not app.messages.empty():
            messages.append(app.messages.get())
        return dict(m for m in messages if m[0] == "results")["results"]

    def test_empty_bestiary_search_carries_its_reason(self):
        def empty(*_):
            pf.bestiary_note[0] = "no beast called x"
            return []
        found, notes = self.run_worker({"Medieval Bestiary": empty})
        self.assertEqual(found, [])
        self.assertEqual(notes, ["Medieval Bestiary: no beast called x"])

    def test_unexpected_error_in_one_source_does_not_stop_the_others(self):
        def broken(*_):
            raise KeyError("surprise")
        found, notes = self.run_worker({
            "Broken": broken,
            "Fine": lambda *_: [{"id": "a"}],
        })
        self.assertEqual(found, [{"id": "a"}])
        self.assertIn("Broken failed", notes[0])


class FakeVar:
    def __init__(self, value):
        self.value = value

    def get(self):
        return self.value

    def set(self, value):
        self.value = value


class SourceToggleTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.settings = os.path.join(tmp.name, "settings.json")
        patch = mock.patch.object(pf, "SETTINGS", self.settings)
        patch.start()
        self.addCleanup(patch.stop)

    def make_app(self, ticked):
        app = pf.App.__new__(pf.App)
        app.use = {name: FakeVar(name in ticked) for name in pf.SOURCES}
        app.all_button = mock.Mock()
        return app

    def label(self, app):
        return app.all_button.configure.call_args.kwargs["text"]

    def saved(self):
        with open(self.settings, encoding="utf-8") as handle:
            return json.load(handle)["sources"]

    def test_all_ticked_becomes_none(self):
        app = self.make_app(set(pf.SOURCES))
        app.toggle_all_sources()
        self.assertFalse(any(v.get() for v in app.use.values()))
        self.assertEqual(self.label(app), "Select all")
        self.assertEqual(self.saved(), [])

    def test_some_ticked_becomes_all(self):
        app = self.make_app({"Medieval Bestiary"})
        app.toggle_all_sources()
        self.assertTrue(all(v.get() for v in app.use.values()))
        self.assertEqual(self.label(app), "Select none")
        self.assertEqual(self.saved(), list(pf.SOURCES))

    def test_none_ticked_becomes_all(self):
        app = self.make_app(set())
        app.toggle_all_sources()
        self.assertTrue(app.all_sources_ticked())

    def test_ticking_one_box_is_remembered(self):
        app = self.make_app({"Medieval Bestiary"})
        app.sources_changed()
        self.assertEqual(self.saved(), ["Medieval Bestiary"])
        self.assertEqual(self.label(app), "Select all")

    def test_other_settings_are_kept(self):
        with open(self.settings, "w", encoding="utf-8") as handle:
            json.dump({"rijks_key": "abc"}, handle)
        self.make_app({"The Met"}).save_settings()
        with open(self.settings, encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["rijks_key"], "abc")

    def test_damaged_settings_file_is_ignored(self):
        for content in ("[1, 2]", "not json"):
            with open(self.settings, "w", encoding="utf-8") as handle:
                handle.write(content)
            self.assertEqual(self.make_app(set()).load_settings(), {})


class DownloadTests(BestiaryTestCase):
    def run_download(self, items, pages):
        app = pf.App.__new__(pf.App)
        app.session = FakeSession(pages)
        app.messages = queue.Queue()
        folder = os.path.join(self.tmp.name, "out")
        app._download_worker(folder, items)
        messages = []
        while not app.messages.empty():
            messages.append(app.messages.get())
        target = os.path.join(folder, "print-finder")
        with open(os.path.join(target, "provenance.csv"), encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        return target, rows, messages

    def bestiary_item(self, **overrides):
        item = {
            "source": "Medieval Bestiary", "id": "bestiary-1001",
            "title": "Owl, bestiary image 1001", "artist": "Medieval manuscript",
            "date": "medieval", "thumb": "https://b.test/thumb.jpg",
            "full": "https://b.test/full.jpg", "fallback": "https://b.test/thumb.jpg",
            "page": "https://bestiary.ca/beasts/beastgallery155.htm",
            "credit": "Owl.", "rights": pf.BESTIARY_RIGHTS,
        }
        item.update(overrides)
        return item

    def met_item(self):
        return {
            "source": "The Met", "id": "met-1", "title": "Owl", "artist": "Hokusai",
            "date": "1830", "thumb": "https://m.test/s.jpg", "full": "https://m.test/f.jpg",
            "page": "https://m.test/", "credit": "Owl. The Met. CC0.",
        }

    def test_rights_column_follows_the_source(self):
        _, rows, messages = self.run_download(
            [self.bestiary_item(), self.met_item()],
            {"https://b.test/full.jpg": b"B", "https://m.test/f.jpg": b"M"},
        )
        rights = {row["source"]: row["rights"] for row in rows}
        self.assertEqual(rights["Medieval Bestiary"], pf.BESTIARY_RIGHTS)
        self.assertEqual(rights["The Met"], "Public domain / CC0")
        self.assertIn(("done", (mock.ANY, 2, 1)), messages)

    def test_uses_fallback_when_full_image_is_missing(self):
        target, rows, _ = self.run_download(
            [self.bestiary_item()], {"https://b.test/thumb.jpg": b"THUMB"}
        )
        with open(os.path.join(target, rows[0]["file"]), "rb") as handle:
            self.assertEqual(handle.read(), b"THUMB")

    def test_other_sources_never_silently_save_a_thumbnail(self):
        app = pf.App.__new__(pf.App)
        app.session = FakeSession({"https://m.test/s.jpg": b"small"})
        app.messages = queue.Queue()
        folder = os.path.join(self.tmp.name, "out")
        app._download_worker(folder, [self.met_item()])
        target = os.path.join(folder, "print-finder")
        self.assertFalse(os.path.exists(os.path.join(target, "provenance.csv")))
        self.assertEqual(os.listdir(target), [])


if __name__ == "__main__":
    unittest.main()
