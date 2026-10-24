"""What `builtin-2` changes in the layout of `builtin-1`: region weights and scale (E3-5q §4.4).

Singapore's share of the Southeast Asian clubs is halved (the other nations' weights doubled):
its people's names on Wikidata are too few for 2,700 Singaporeans at the pack's scale (Qq3).
"""

REGIONS = {
    "AsiaSoutheast": {
        "nations": [["VN", 20], ["TH", 8], ["ID", 8], ["MY", 4], ["PH", 4], ["SG", 1]],
        "localShare": 0.75,
        "foreignFromRegionShare": 0.15,
    },
}
