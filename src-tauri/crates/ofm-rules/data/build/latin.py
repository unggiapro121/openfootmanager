"""Which names the generator could ever produce: Latin script only (E3-5q §4.4)."""

import re
import unicodedata

_KEEP = set(" -'.’")


def clean(name):
    """The name without a bracketed note and with single spaces, or None when it is not written
    in Latin letters (a generated name never is anything else, so nothing else needs blocking)."""
    name = re.sub(r"\s*[\(\[].*?[\)\]]\s*", " ", name)
    name = " ".join(name.split())
    if len(name) < 3 or any(c.isdigit() for c in name):
        return None
    letters = 0
    for c in name:
        if c in _KEEP:
            continue
        if not c.isalpha():
            return None
        try:
            if "LATIN" not in unicodedata.name(c):
                return None
        except ValueError:
            return None
        letters += 1
    return name if letters >= 3 else None
