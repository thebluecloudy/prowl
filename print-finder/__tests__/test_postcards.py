"""Tests for the Postcards section of print-finder.pyw.

    python -m unittest discover -s __tests__ -v
"""

import datetime
import json
import os
import queue
import tempfile
import unittest
from unittest import mock

import requests

from test_bestiary import FakeVar, pf


class RecordingSession:
    """Answers the Met's search and object calls, recording the parameters."""

    def __init__(self, objects):
        self.objects = objects
        self.calls = []

    def get(self, url, params=None, timeout=None, **_):
        self.calls.append((url, dict(params or {})))
        response = requests.Response()
        response.status_code = 200
        if url.endswith("/search"):
            body = {"objectIDs": list(self.objects)}
        else:
            body = self.objects[int(url.rsplit("/", 1)[1])]
        response._content = json.dumps(body).encode("utf-8")
        return response


def met_object(object_id, end_year, date="ca. 1907"):
    return {
        "isPublicDomain": True, "primaryImageSmall": f"https://m.test/{object_id}s.jpg",
        "primaryImage": f"https://m.test/{object_id}.jpg", "title": "Halloween Greetings",
        "artistDisplayName": "", "objectDate": date, "objectEndDate": end_year,
        "objectURL": f"https://m.test/{object_id}", "accessionNumber": "63.350",
    }


class YearTests(unittest.TestCase):
    def test_plain_year(self):
        self.assertEqual(pf.year_of("1907"), 1907)

    def test_latest_year_of_a_range_counts(self):
        self.assertEqual(pf.year_of("1905–1915"), 1915)
        self.assertEqual(pf.year_of("ca. 1905-10"), 1910)
        self.assertEqual(pf.year_of("published 1909, posted 1912"), 1912)

    def test_full_dates_are_not_ranges(self):
        self.assertEqual(pf.year_of("1907-08-12"), 1907)

    def test_decades(self):
        self.assertEqual(pf.year_of("1920s"), 1920)

    def test_no_year(self):
        for text in ("", None, "early 20th century", "undated"):
            self.assertIsNone(pf.year_of(text))

    def test_numbers_from_the_met(self):
        self.assertEqual(pf.year_of(1910), 1910)
        self.assertIsNone(pf.year_of(0))

    def test_cutoff_moves_with_the_calendar(self):
        self.assertEqual(pf.PD_CUTOFF, datetime.date.today().year - 95)


class PublicDomainFilterTests(unittest.TestCase):
    def test_drops_cards_dated_at_or_after_the_cutoff(self):
        items = [{"id": "a", "year": 1907}, {"id": "b", "year": 1930},
                 {"id": "c", "year": 1931}, {"id": "d", "year": 1955}]
        kept, hidden = pf.public_domain_only(items, cutoff=1931)
        self.assertEqual([i["id"] for i in kept], ["a", "b"])
        self.assertEqual(hidden, 2)

    def test_undated_cards_stay(self):
        kept, hidden = pf.public_domain_only([{"id": "x", "year": None}, {"id": "y"}], 1931)
        self.assertEqual(len(kept), 2)
        self.assertEqual(hidden, 0)


class PostcardSourceTests(unittest.TestCase):
    def test_every_postcard_source_is_wrapped(self):
        self.assertEqual(set(pf.POSTCARD_SOURCES),
                         {"The Met", "Wikimedia Commons", "Library of Congress",
                          "Art Institute", "Cleveland"})
        self.assertNotIn("Medieval Bestiary", pf.POSTCARD_SOURCES)

    def test_presets_are_postcard_searches(self):
        for preset in pf.POSTCARD_PRESETS:
            self.assertRegex(preset.lower(), r"postcard")

    def test_adds_postcard_to_the_search_once(self):
        seen = []

        def fake(term, limit, session, key=None):
            seen.append(term)
            return []

        run = pf.as_postcards(fake)
        run("black cat", 5, None)
        run("Halloween postcard", 5, None)
        run("Easter post card", 5, None)
        self.assertEqual(seen, ["black cat postcard", "Halloween postcard", "Easter post card"])

    def test_cards_get_a_year_and_section(self):
        run = pf.as_postcards(lambda *a, **k: [{"date": "c. 1908", "id": "1"}])
        item = run("witch", 5, None)[0]
        self.assertEqual(item["year"], 1908)
        self.assertEqual(item["section"], "Postcards")

    def test_met_postcards_are_not_limited_to_prints(self):
        session = RecordingSession({1: met_object(1, 1910)})
        items = pf.POSTCARD_SOURCES["The Met"]("Halloween", 5, session)
        search_params = session.calls[0][1]
        self.assertEqual(search_params["q"], "Halloween postcard")
        self.assertNotIn("medium", search_params)
        self.assertEqual(items[0]["year"], 1910)

    def test_met_prints_search_still_asks_for_prints(self):
        session = RecordingSession({1: met_object(1, 1910)})
        pf.search_met("woodcut", 5, session)
        self.assertEqual(session.calls[0][1]["medium"], "Prints")

    def test_met_end_year_beats_a_vague_date(self):
        session = RecordingSession({1: met_object(1, 1915, date="early 20th century")})
        item = pf.POSTCARD_SOURCES["The Met"]("Halloween", 5, session)[0]
        self.assertEqual(item["year"], 1915)


class PostcardSearchWorkerTests(unittest.TestCase):
    def run_worker(self, table, public_domain):
        app = pf.App.__new__(pf.App)
        app.session = None
        app.messages = queue.Queue()
        app.per_source = mock.Mock(get=mock.Mock(return_value=24))
        app._search_worker("Halloween postcard", list(table), table, public_domain)
        while True:
            kind, value = app.messages.get_nowait()
            if kind == "results":
                return value

    TABLE = {"Old": lambda *a: [{"id": "1907", "year": 1907}, {"id": "1950", "year": 1950},
                                {"id": "undated", "year": None}]}

    def test_filter_on_hides_later_cards_and_says_so(self):
        found, notes = self.run_worker(self.TABLE, True)
        self.assertEqual([i["id"] for i in found], ["1907", "undated"])
        self.assertIn("Hid 1 card dated", notes[0])

    def test_filter_off_shows_everything(self):
        found, notes = self.run_worker(self.TABLE, False)
        self.assertEqual(len(found), 3)
        self.assertEqual(notes, [])


class SectionSwitchTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.settings = os.path.join(tmp.name, "settings.json")
        patch = mock.patch.object(pf, "SETTINGS", self.settings)
        patch.start()
        self.addCleanup(patch.stop)

        app = pf.App.__new__(pf.App)
        app.section = "Prints"
        app.uses = {name: {source: FakeVar(True) for source in section["sources"]}
                    for name, section in pf.SECTIONS.items()}
        app.use = app.uses["Prints"]
        app.terms = {name: section["start"] for name, section in pf.SECTIONS.items()}
        app.term = FakeVar("woodcut")
        app.pre1931 = FakeVar(True)
        app.show_section = mock.Mock()
        self.app = app

    def saved(self):
        with open(self.settings, encoding="utf-8") as handle:
            return json.load(handle)

    def test_switching_changes_sources_search_and_view(self):
        self.app.switch_section("Postcards")
        self.assertEqual(self.app.section, "Postcards")
        self.assertIs(self.app.use, self.app.uses["Postcards"])
        self.assertEqual(self.app.term.get(), "Halloween postcard")
        self.app.show_section.assert_called_once()

    def test_each_section_keeps_its_own_search(self):
        self.app.term.set("owl")
        self.app.switch_section("Postcards")
        self.app.term.set("Valentine postcard")
        self.app.switch_section("Prints")
        self.assertEqual(self.app.term.get(), "owl")
        self.app.switch_section("Postcards")
        self.assertEqual(self.app.term.get(), "Valentine postcard")

    def test_switching_to_the_open_section_does_nothing(self):
        self.app.switch_section("Prints")
        self.app.show_section.assert_not_called()

    def test_postcard_ticks_are_saved_separately(self):
        self.app.switch_section("Postcards")
        self.app.use["Cleveland"].set(False)
        self.app.save_settings()
        saved = self.saved()
        self.assertEqual(saved["section"], "Postcards")
        self.assertNotIn("Cleveland", saved["postcard_sources"])
        self.assertNotIn("sources", saved)
        self.assertTrue(saved["pre1931"])

    def test_select_all_works_on_the_postcard_sources(self):
        self.app.all_button = mock.Mock()
        self.app.switch_section("Postcards")
        self.app.toggle_all_sources()
        self.assertFalse(any(v.get() for v in self.app.uses["Postcards"].values()))
        self.assertTrue(all(v.get() for v in self.app.uses["Prints"].values()))


if __name__ == "__main__":
    unittest.main()
