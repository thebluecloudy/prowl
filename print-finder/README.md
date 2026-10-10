# Print Finder

A Windows desktop tool for Owl & Twig: search open museum collections and the
Medieval Bestiary at once, look at thumbnails, star the pictures worth
printing, and download only those at full size, with a `provenance.csv`
listing each one's source and rights.

It is a single Python file and is separate from the Prowl page and worker.

## Run it

Double-click `print-finder.pyw`. The first run installs `requests` and
`pillow` if they are missing.

## Sources

| Source | Rights |
| --- | --- |
| The Met, Art Institute of Chicago, Cleveland Museum of Art | CC0 |
| Wikimedia Commons, Rijksmuseum, SMK Copenhagen, Library of Congress | Public domain (filtered) |
| Medieval Bestiary (bestiary.ca) | The medieval art is public domain. The photographs come from the libraries that hold the manuscripts, and some set terms for commercial use. Results are marked "check library terms", and the CSV says so. |

The Medieval Bestiary is searched by animal name (`owl`, `fish`, `dragon`).
You can also paste a bestiary.ca page address into the search box to pull the
pictures from that page and the beasts it links to. bestiary.ca is one
person's site, so the tool makes at most one request a second there and keeps
the beast list for 30 days in `~/.printfinder-bestiary.json`.

When a bestiary search finds nothing, a note above the results says why. Pages
it could not read are saved to `Downloads/print-finder-bestiary-debug`.

## Files it keeps in your home folder

- `.printfinder-shortlist.json`: starred pictures
- `.printfinder-settings.json`: which sources were ticked last time
- `.printfinder-bestiary.json`: bestiary.ca beast list

## Tests

Standard library only; tkinter is stubbed, so they run anywhere:

```
cd print-finder
python -m unittest discover -s __tests__ -v
```
