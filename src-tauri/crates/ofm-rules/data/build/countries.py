"""The nations of the online content pack, and the desktop pools, with their Wikidata items."""

# Pack code → (Wikidata country item, label language for names written in Latin script).
NATIONS = {
    "AR": ("Q414", "es"),
    "BE": ("Q31", "nl"),
    "BR": ("Q155", "pt"),
    "CN": ("Q148", "en"),
    "CO": ("Q739", "es"),
    "DE": ("Q183", "de"),
    "ENG": ("Q145", "en"),
    "ES": ("Q29", "es"),
    "FR": ("Q142", "fr"),
    "HR": ("Q224", "hr"),
    "ID": ("Q252", "id"),
    "IE": ("Q27", "en"),
    "IT": ("Q38", "it"),
    "JP": ("Q17", "en"),
    "KR": ("Q884", "en"),
    "MX": ("Q96", "es"),
    "MY": ("Q833", "ms"),
    "NIR": ("Q145", "en"),
    "NL": ("Q55", "nl"),
    "PH": ("Q928", "en"),
    "PT": ("Q45", "pt"),
    "SCO": ("Q145", "en"),
    "SE": ("Q34", "sv"),
    "SG": ("Q334", "en"),
    "TH": ("Q869", "en"),
    "US": ("Q30", "en"),
    "VN": ("Q881", "vi"),
    "WAL": ("Q145", "en"),
}

# Further citizenship items a nation's people are recorded with.
EXTRA_CITIZENSHIP = {"NL": ["Q29999"]}

# The four home nations share the United Kingdom's citizenship: they are told apart by where a
# person was born, or a club is (P131*).
HOME_NATIONS = {"ENG": "Q21", "SCO": "Q22", "WAL": "Q25", "NIR": "Q26"}

# Southeast Asian nations of the launch region: every player of any of their clubs is protected.
SOUTHEAST_ASIA = ["VN", "TH", "ID", "MY", "SG", "PH"]
