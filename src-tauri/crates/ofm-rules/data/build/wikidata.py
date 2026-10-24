"""Wikidata (CC0) through the QLever SPARQL endpoint, with an on-disk cache.

The world generator's protected lists and name frequencies are built from Wikidata (E3-5q F6, F7).
QLever answers aggregate queries over the whole of Wikidata in seconds, where the public query
service times out. Each answer is cached by the hash of its query, so a rebuild with the same
queries reads the same data; delete the cache to take a fresh snapshot, and record its date in
`../SOURCES.md`.
"""

import csv
import hashlib
import io
import os
import sys
import time
import urllib.parse
import urllib.request

ENDPOINT = "https://qlever.dev/api/wikidata"
CACHE = os.environ.get(
    "OFM_WIKIDATA_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
)
USER_AGENT = "openfootmanager-worldgen-data/1.0 (E3-5q2; https://github.com/openfootmanager)"

PREFIXES = """PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
"""


def query(sparql, retries=3):
    """Rows of a SELECT query as lists of strings: IRIs shortened to their Q-id, literals bare."""
    text = PREFIXES + sparql
    key = hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, key + ".tsv")
    if not os.path.exists(path):
        body = urllib.parse.urlencode({"query": text}).encode("utf-8")
        for attempt in range(retries):
            request = urllib.request.Request(
                ENDPOINT,
                data=body,
                headers={"Accept": "text/tab-separated-values", "User-Agent": USER_AGENT},
            )
            try:
                with urllib.request.urlopen(request, timeout=600) as response:
                    data = response.read().decode("utf-8")
                break
            except Exception as error:  # a busy endpoint: wait and try again
                if attempt == retries - 1:
                    raise
                print(f"  retry after {error}", file=sys.stderr)
                time.sleep(10 * (attempt + 1))
        with open(path, "w", encoding="utf-8") as out:
            out.write(data)
    with open(path, encoding="utf-8") as cached:
        reader = csv.reader(cached, delimiter="\t", quoting=csv.QUOTE_NONE)
        rows = list(reader)
    return [[value_of(cell) for cell in row] for row in rows[1:]]


def value_of(cell):
    """An IRI as its Q-id, a literal without its quotes, language tag or datatype."""
    cell = cell.strip()
    if cell.startswith("<http://www.wikidata.org/entity/"):
        return cell[len("<http://www.wikidata.org/entity/") : -1]
    if cell.startswith('"'):
        end = cell.rfind('"')
        return cell[1:end].replace('\\"', '"').replace("\\t", " ").replace("\\n", " ")
    return cell
