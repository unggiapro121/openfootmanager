"""Small text helpers for the name pools: tone and macron stripping, the pinyin syllable set."""

import unicodedata

# Pinyin as initials × finals: a superset of the real syllables, enough to tell a Chinese name
# written in pinyin from any other.
_INITIALS = ["", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x",
             "zh", "ch", "sh", "r", "z", "c", "s", "y", "w"]
_FINALS = ["a", "o", "e", "i", "u", "v", "ai", "ei", "ui", "ao", "ou", "iu", "ie", "ve", "er",
           "an", "en", "in", "un", "vn", "ang", "eng", "ing", "ong", "ia", "iao", "ian", "iang",
           "iong", "ua", "uo", "uai", "uan", "uang", "ue", "uei", "uen", "ueng", "van"]
# Without an initial a syllable is written with y- or w- unless it is one of these.
_BARE = {"a", "o", "e", "er", "ai", "ei", "ao", "ou", "an", "en", "ang", "eng"}
PINYIN = {i + f for i in _INITIALS for f in _FINALS if (i or f in _BARE)}


def strip_marks(text):
    """Diacritics off: tone marks of pinyin, macrons of Japanese romaji (Satō → Sato)."""
    decomposed = unicodedata.normalize("NFD", text)
    return unicodedata.normalize("NFC", "".join(c for c in decomposed if unicodedata.category(c) != "Mn"))


def pinyin_syllables(word):
    """`word` split into pinyin syllables (longest first), or None if it cannot be."""
    word = word.lower().replace("ü", "v")
    if not word:
        return []
    for size in (6, 5, 4, 3, 2, 1):
        head = word[:size]
        if head in PINYIN:
            rest = pinyin_syllables(word[size:])
            if rest is not None:
                return [head] + rest
    return None
