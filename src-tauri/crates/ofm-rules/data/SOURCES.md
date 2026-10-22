# Where the generator's data comes from

Everything here is compiled into `ofm-rules` and ships with the GPLv3 client, so it is public.
Nothing in it is licensed football data: no EA, SoFIFA, FBref or Transfermarkt content (E3-5q F7).

| File | What | Source | Licence | Built |
|---|---|---|---|---|
| `default_names.json` | Desktop name pools, 17 nations × 20 given × 20 family names | Written for the game | GPLv3 (this repository) | Before phase 3 |
| `default_nations.json` | Desktop club generation: 16 nations' cities, naming styles, strength | Written for the game | GPLv3 | Before phase 3 |
| `online/builtin-1.json` | The shipped online content pack | European, Brazilian and Argentinian pools and cities from the two files above; Vietnamese, Thai, Indonesian, Malaysian, Singaporean, Filipino, Chinese, Japanese, Korean, American, Mexican and Colombian pools, every city list of those nations, the club and stadium word lists, kits and the starter template written by hand for E3-5q1 (2026-10-23): common names and real place names only | GPLv3 | 2026-10-23 |
| `protected_people.txt` | Famous footballers and coaches the generator never names a person after | Written by hand for E3-5q1 (2026-10-23) | GPLv3 | 2026-10-23 |
| `protected_clubs.txt` | Professional clubs the generator never names a club after | Written by hand for E3-5q1 (2026-10-23), including V.League clubs and sponsor names | GPLv3 | 2026-10-23 |
| `protected_words.txt` | Sponsor and brand words a generated name never holds | Written by hand for E3-5q1 (2026-10-23) | GPLv3 | 2026-10-23 |

**Interim.** The `builtin-1` pools are small: at the pack's target scale (5,600 clubs) most nations' people share
their full name with someone (measured in `fm-document/comon/sim-bench/phase3/e3-5q1-results.txt`), which is why
`limits.maxWorldNameShare` is 1.0 for now. E3-5q2 replaces the pools with frequency-weighted ones counted over
whole populations (Wikidata, CC0, or open census data), rebuilds the protected lists from Wikidata (CC0) plus
the hand-written lists for the launch region, records each source and query date here, and sets the limit to 0.05.
