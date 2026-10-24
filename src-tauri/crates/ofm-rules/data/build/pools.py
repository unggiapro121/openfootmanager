"""Build the name pools of the online pack and the desktop from Wikidata and the files in
`compose/` (E3-5q F5, F7). Writes `out/pools.json`: by nation code, `given`, `family`, `middle` as
`[name, weight]`, with `flatten`, `order` and `shirt`.

Sources by nation:
- most nations: name frequencies over the whole population on Wikidata (`wikidata_pools.py`);
- JP: the same, macrons dropped (Sato, not Satō, as shirts are lettered);
- TH: the same, Western and Chinese-pinyin names left out (diaspora on Wikidata);
- CN: family names and given names on Wikidata kept only when they are pinyin; two-character
  given names composed from how often each syllable starts and ends one;
- KR: family names on Wikidata; two-syllable given names composed from how often each syllable
  starts and ends one on Wikidata;
- VN, MY: written for the game (`compose/vn.txt`, `compose/my.txt`).

The flattening α of each pool is the largest of ALPHAS whose predicted share of people sharing a
full name at the pack's scale stays at or under TARGET_SHARE (`capacity.py`, the measure of
`validate_pack`); the smaller α, the further the draw is from real frequencies.
"""

import json
import os
import sys

import capacity
from capacity import combinations, people_at_scale, predicted_share
from pack_config import REGIONS
from scripts_util import pinyin_syllables, strip_marks
from wikidata_pools import family_names, given_names

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
BUILTIN_1 = os.path.join(os.path.dirname(HERE), "online", "builtin-1.json")

TARGET_SHARE = 0.035
ALPHAS = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3]
GIVEN_CAP = 800
FAMILY_CAP = 4000
PARTICLES = {"de", "da", "do", "dos", "das", "di", "del", "della", "van", "von", "der", "den",
             "le", "la", "du", "ter", "ten", "dei", "degli", "y", "e"}
WESTERN_SOURCES = ["US", "ENG", "FR", "DE", "ES", "IT", "NL", "PT"]


def tidy(entries, max_words=3):
    """Names that are names (no notes, initials or lower-case words that are not particles),
    spellings of one name merged under its most counted one."""
    best = {}
    for name, count in entries:
        words = name.split()
        if not words or len(words) > max_words or "." in name:
            continue
        if "name" in name.lower():
            continue
        if words[0][0].islower() and words[0].lower() not in PARTICLES:
            continue
        if words[-1][0].islower():
            continue
        key = strip_marks(name).casefold()
        total, spelling, top = best.get(key, (0, name, 0))
        if count > top:
            spelling, top = name, count
        best[key] = (total + count, spelling, top)
    merged = [(spelling, total) for total, spelling, _ in best.values()]
    return sorted(merged, key=lambda pair: (-pair[1], pair[0]))


def western():
    names = set()
    for code in WESTERN_SOURCES:
        names |= {strip_marks(n).casefold() for n, _ in tidy(given_names(code))[:400]}
        names |= {strip_marks(n).casefold() for n, _ in tidy(family_names(code))[:1500]}
    return names


def read_compose(file):
    sections = {}
    current = None
    with open(os.path.join(HERE, "compose", file), encoding="utf-8") as text:
        for line in text:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("["):
                current = line.strip("[]")
                sections[current] = {}
                continue
            name, weight = line.rsplit(" ", 1)
            sections[current][name] = sections[current].get(name, 0) + int(weight)
    return {key: sorted(value.items(), key=lambda p: (-p[1], p[0])) for key, value in sections.items()}


def compose_two(first, second, top, joiner, shape):
    """Every pairing of the `top` most frequent first and second parts, weighted by the product."""
    firsts = sorted(first.items(), key=lambda p: -p[1])[:top]
    seconds = sorted(second.items(), key=lambda p: -p[1])[:top]
    out = {}
    for a, wa in firsts:
        for b, wb in seconds:
            name = shape(a, b, joiner)
            out[name] = out.get(name, 0) + wa * wb
    return sorted(out.items(), key=lambda p: (-p[1], p[0]))


def chinese(west):
    family = []
    for name, count in tidy(family_names("CN"), 1):
        plain = strip_marks(name)
        syllables = pinyin_syllables(plain)
        if syllables and len(syllables) <= 2 and plain.casefold() not in west - {"li", "lin", "lee"}:
            family.append((plain.capitalize(), count))
    family = tidy(family, 1)
    first, second, singles = {}, {}, {}
    for name, count in tidy(given_names("CN"), 1):
        syllables = pinyin_syllables(strip_marks(name))
        if not syllables:
            continue
        if len(syllables) == 1:
            singles[syllables[0]] = singles.get(syllables[0], 0) + count
        elif len(syllables) == 2:
            first[syllables[0]] = first.get(syllables[0], 0) + count
            second[syllables[1]] = second.get(syllables[1], 0) + count
    doubles = compose_two(first, second, 90, "", lambda a, b, _: (a + b).capitalize())
    # About a third of men born since the 1980s have a one-character given name.
    double_total = sum(w for _, w in doubles)
    single_total = sum(singles.values()) or 1
    scale = 0.5 * double_total / single_total
    given = doubles + [(s.capitalize(), max(1, round(w * scale))) for s, w in singles.items()]
    return tidy(given, 1), family


def korean(japanese_family):
    first, second = {}, {}
    for name, count in tidy(given_names("KR"), 1):
        parts = strip_marks(name).split("-")
        if len(parts) == 2 and all(part.isalpha() for part in parts):
            a, b = parts[0].capitalize(), parts[1].lower()
            first[a] = first.get(a, 0) + count
            second[b] = second.get(b, 0) + count
    given = compose_two(first, second, 110, "-", lambda a, b, j: f"{a}{j}{b}")
    family = [
        (strip_marks(n), c)
        for n, c in tidy(family_names("KR"), 1)
        if c >= 3 and len(strip_marks(n)) <= 6 and strip_marks(n).isalpha()
        and strip_marks(n).casefold() not in japanese_family
    ]
    return given, tidy(family, 1)


def japanese(west):
    def clean(entries):
        out = [(strip_marks(n), c) for n, c in tidy(entries, 1)]
        return [(n, c) for n, c in tidy(out, 1) if n.casefold() not in west and n.isalpha()]

    return clean(given_names("JP")), clean(family_names("JP"))


def thai(west):
    def keep(name):
        plain = strip_marks(name)
        return plain.isalpha() and plain.casefold() not in west and not (
            pinyin_syllables(plain) and len(plain) <= 6
        )

    given = [(n, c) for n, c in tidy(given_names("TH"), 1) if keep(n)]
    family = [(n, c) for n, c in tidy(family_names("TH"), 1) if keep(n)]
    return given, family


def singaporean(given, family):
    """Singapore on Wikidata is sparse and holds many expatriates. Family names: those met on
    Wikidata that are no Western family name. Given names: those met at least twice, and the
    English given names most Singaporeans of Chinese descent carry (from the English pool, at a
    tenth of their weight there)."""
    broad = set()
    for code in ("ENG", "US", "SCO", "IE", "WAL", "DE", "FR", "NL"):
        broad |= {strip_marks(n).casefold() for n, _ in tidy(family_names(code))[:6000]}
    family = [(n, c) for n, c in family if strip_marks(n).casefold() not in broad]
    english = {n: max(1, c // 10) for n, c in tidy(given_names("ENG"))[:300]}
    merged = dict((n, c) for n, c in given if c >= 2)
    for n, c in english.items():
        merged[n] = merged.get(n, 0) + c
    return sorted(merged.items(), key=lambda p: (-p[1], p[0])), family


def vietnamese():
    sections = read_compose("vn.txt")
    return sections["given"], sections["family"], sections["middle"]


def malay():
    sections = read_compose("my.txt")
    base = dict(sections["given"])
    prefix = dict(sections["prefix"])
    base_total = sum(base.values())
    prefix_total = sum(prefix.values())
    given = {}
    # About half carry a prefix (Mohd Faiz); the father's name stands as the family name.
    for name, weight in base.items():
        given[name] = given.get(name, 0) + weight * prefix_total
        for p, wp in prefix.items():
            given[f"{p} {name}"] = given.get(f"{p} {name}", 0) + wp * weight
    del base_total
    return sorted(given.items(), key=lambda p: (-p[1], p[0])), sections["given"]


def choose_alpha(code, pool):
    for alpha in ALPHAS:
        pool["flatten"] = alpha
        if predicted_share(code, pool) <= TARGET_SHARE:
            return alpha
    return ALPHAS[-1]


def main():
    with open(BUILTIN_1, encoding="utf-8") as pack_file:
        layout = json.load(pack_file)
    old = layout["names"]
    layout["regions"].update(REGIONS)
    capacity.PEOPLE_AT_SCALE.update(people_at_scale(layout))
    west = western()
    pools = {}
    for code in sorted(old):
        style = old[code]
        middle = []
        if code == "CN":
            given, family = chinese(west)
        elif code == "KR":
            given, family = korean({n.casefold() for n, _ in japanese(west)[1][:3000]})
        elif code == "JP":
            given, family = japanese(west)
        elif code == "TH":
            given, family = thai(west)
        elif code == "VN":
            given, family, middle = vietnamese()
        elif code == "MY":
            given, family = malay()
        else:
            given = tidy(given_names(code))
            family = tidy(family_names(code, male_only=code == "ID"))
            if code == "SG":
                given, family = singaporean(given, family)
        composed = code in ("CN", "KR", "MY")
        pool = {
            "given": [[n, int(c)] for n, c in given[: (None if composed else GIVEN_CAP)]],
            "family": [[n, int(c)] for n, c in family[:FAMILY_CAP]],
            "middle": [[n, int(c)] for n, c in middle],
            "flatten": 1.0,
            "order": style["order"],
            "shirt": style["shirt"],
        }
        alpha = choose_alpha(code, pool)
        share = predicted_share(code, pool)
        pools[code] = pool
        print(
            f"{code:4} given {len(pool['given']):6} family {len(pool['family']):5} "
            f"middle {len(pool['middle']):3} α {alpha:4} N {combinations(pool):12.0f} "
            f"people {capacity.PEOPLE_AT_SCALE[code]:6.0f} share {share * 100:5.2f}%",
            file=sys.stderr,
        )
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "pools.json"), "w", encoding="utf-8") as out:
        json.dump(pools, out, ensure_ascii=False, sort_keys=True)


if __name__ == "__main__":
    main()
