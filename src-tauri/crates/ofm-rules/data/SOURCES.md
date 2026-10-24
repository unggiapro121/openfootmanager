# Where the generator's data comes from

Everything here is compiled into `ofm-rules` and ships with the GPLv3 client, so it is public.
Nothing in it is licensed football data: no EA, SoFIFA, FBref or Transfermarkt content (E3-5q F7).

Built on 2026-10-24 by the scripts in `build/` (Python 3, standard library only). Wikidata is read
through the QLever SPARQL endpoint (`https://qlever.dev/api/wikidata`), whose index is a recent
Wikidata dump; Wikidata's data is CC0. To rebuild: delete `build/.cache`, then
`python3 build/protected.py && python3 build/pools.py && python3 build/pack.py && python3 build/desktop_names.py`,
and record the new date here.

| File | What | Source | Licence | Built |
|---|---|---|---|---|
| `online/builtin-2.json` | The shipped online content pack | `online/builtin-1.json`'s layout (cities, club and stadium styles and words, kits, starter template, written for E3-5q1) with the name pools below, Southeast Asia's nation weights doubled but Singapore's (`build/pack_config.py`), extra Brazilian cities and words (`build/places.json`), and `maxWorldNameShare` 0.05 | GPLv3 (layout) / CC0 (Wikidata counts) | `build/pack.py`, 2026-10-24 |
| `online/builtin-1.json` | The E3-5q1 pack, kept as the layout `builtin-2` is built from; no longer compiled in | Written for the game, E3-5q1 | GPLv3 | 2026-10-23 |
| `default_names.json` | The desktop's shipped name pools: the same pools as `builtin-2`, in the desktop's format (`GB` is England's) | As the pools below | As below | `build/desktop_names.py`, 2026-10-24 |
| `default_nations.json` | Desktop club generation: 16 nations' cities, naming styles, strength | Written for the game | GPLv3 | Before phase 3 |
| `protected_people.txt` | People the generator never names a person after | Wikidata: footballers and football managers (P106) with 20 or more Wikipedia articles; every member (P54) of a national team (subclass of Q6979593) of a pack nation; every member of a club (subclass of Q476028) of a Southeast Asian pack nation; every Latin-script label and alias of each | CC0 | `build/protected.py`, 2026-10-24 |
| `protected_people_vn.txt` | Vietnamese footballers and coaches, by hand | Written for the game (names are facts; no list was copied) | GPLv3 | 2026-10-24 |
| `protected_clubs.txt` | Clubs the generator never names a club after | Wikidata: every association football club of a pack nation, every Latin-script label and alias; the home nations told apart by location (P131) | CC0 | `build/protected.py`, 2026-10-24 |
| `protected_clubs_vn.txt` | Vietnamese clubs, past names and sponsors, by hand | Written for the game | GPLv3 | 2026-10-24 |
| `protected_words.txt` | Sponsor and brand words a generated name never holds | Written by hand for E3-5q1 | GPLv3 | 2026-10-23 |

**Name pools** (`build/pools.py`):

| Nations | Given names | Family names |
|---|---|---|
| AR BE BR CO DE ENG ES FR HR ID IE IT MX NIR NL PH PT SCO SE US WAL | Wikidata: men (P21) born 1950 or later of the nation's citizenship (P27; the home nations by place of birth), counted by given name (P735), the item's label in the nation's language or English | Wikidata: everyone born 1950 or later, counted by family name (P734); Indonesia men only, as the second name is the father's |
| JP | As above, macrons dropped (Sato, not Satō), Western names left out | As above, same treatment |
| TH | As above, Western and Chinese-pinyin names left out (diaspora) | As above |
| CN | Composed: each syllable's frequency as the first and the second of a two-character given name on Wikidata (pinyin only), every pairing of the 90 most frequent, and one-character names at about a third of the draws | Wikidata, pinyin only, tone marks dropped |
| KR | Composed: each syllable's frequency as the first and the second of a hyphenated given name on Wikidata, every pairing of the 110 most frequent | Wikidata, at least three bearers, Japanese family names left out |
| SG | Wikidata names met at least twice, and the 300 most frequent English given names at a tenth of their weight (most Singaporeans of Chinese descent carry one) | Wikidata, Western family names left out |
| VN | Written for the game: `build/compose/vn.txt` (family names weighted by their commonly cited shares, middle and given names by judgement) | Same file |
| MY | Written for the game: `build/compose/my.txt` (Malay given names, with or without a prefix such as Mohd) | The same given names: a Malay man's second name is his father's |

Each pool's flattening α is the largest of 1.0, 0.9 … 0.3 whose predicted share of people sharing
a full name at the pack's scale (5,600 clubs) is at most 3.5%, `validate_pack`'s measure.
