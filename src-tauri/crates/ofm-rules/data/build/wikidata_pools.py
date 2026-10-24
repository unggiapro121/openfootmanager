"""Name frequencies counted over a nation's whole population on Wikidata (CC0), E3-5q F7.

Given names: men (P21 = male) born in 1950 or later, by given name (P735). Family names: everyone
born in 1950 or later, by family name (P734). Counted over every person of that citizenship, not
over footballers: the most common names among footballers are footballers' names. The four home
nations, which share a citizenship, are told apart by place of birth. Each name is its item's
label in the nation's language, or in English, kept only in Latin script.
"""

from countries import EXTRA_CITIZENSHIP, HOME_NATIONS, NATIONS
from latin import clean
from wikidata import query

SINCE = 1950


def _where(code):
    item, _ = NATIONS[code]
    items = " ".join(f"wd:{q}" for q in [item] + EXTRA_CITIZENSHIP.get(code, []))
    place = ""
    if code in HOME_NATIONS:
        place = f"?p wdt:P19/wdt:P131* wd:{HOME_NATIONS[code]} ."
    return f"VALUES ?citizenship {{ {items} }} ?p wdt:P31 wd:Q5 ; wdt:P27 ?citizenship . {place}"


def _counts(code, prop, male_only):
    _, lang = NATIONS[code]
    male = "?p wdt:P21 wd:Q6581097 ." if male_only else ""
    rows = query(f"""
SELECT ?name (COUNT(DISTINCT ?p) AS ?n) WHERE {{
  {_where(code)} {male}
  ?p wdt:{prop} ?item ; wdt:P569 ?born . FILTER(YEAR(?born) >= {SINCE})
  OPTIONAL {{ ?item rdfs:label ?native . FILTER(LANG(?native) = "{lang}") }}
  OPTIONAL {{ ?item rdfs:label ?english . FILTER(LANG(?english) = "en") }}
  BIND(COALESCE(?native, ?english) AS ?name) FILTER(BOUND(?name))
}} GROUP BY ?name ORDER BY DESC(?n)""")
    out = {}
    for name, count in rows:
        name = clean(name)
        if name:
            out[name] = out.get(name, 0) + int(count)
    return sorted(out.items(), key=lambda pair: (-pair[1], pair[0]))


def given_names(code):
    return _counts(code, "P735", True)


def family_names(code, male_only=False):
    """Family names; `male_only` where the second name is the father's given name, so a woman's
    (Putri, Dewi) is never a man's."""
    return _counts(code, "P734", male_only)
