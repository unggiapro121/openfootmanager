"""Build `../online/builtin-2.json`: `builtin-1`'s layout with the pools of `pools.py`, the region
weights of `pack_config.py`, the place names and words of `places.json`, and the name-share limit
at 0.05 (E3-5q2).

Usage: python3 pools.py && python3 pack.py
"""

import json
import os

from pack_config import REGIONS

HERE = os.path.dirname(os.path.abspath(__file__))
ONLINE = os.path.join(os.path.dirname(HERE), "online")


def main():
    with open(os.path.join(ONLINE, "builtin-1.json"), encoding="utf-8") as base_file:
        pack = json.load(base_file)
    with open(os.path.join(HERE, "out", "pools.json"), encoding="utf-8") as pools_file:
        pools = json.load(pools_file)
    places_path = os.path.join(HERE, "places.json")
    places = {}
    if os.path.exists(places_path):
        with open(places_path, encoding="utf-8") as places_file:
            places = json.load(places_file)

    pack["version"] = "builtin-2"
    pack["description"] = (
        "Shipped online content (E3-5q2). Name pools counted over whole populations on Wikidata "
        "(CC0) or written for the game; see data/SOURCES.md."
    )
    pack["names"] = {
        code: {
            "given": pool["given"],
            "family": pool["family"],
            **({"middle": pool["middle"]} if pool["middle"] else {}),
            "flatten": pool["flatten"],
            "order": pool["order"],
            "shirt": pool["shirt"],
        }
        for code, pool in sorted(pools.items())
    }
    pack["regions"].update(REGIONS)
    for code, change in places.get("nations", {}).items():
        nation = pack["nations"][code]
        for key in ("cities", "districts"):
            if key in change:
                nation[key] = sorted(set(nation.get(key, [])) | set(change[key]), key=str.casefold)
    for kind in ("clubStyles", "stadiumStyles"):
        for name, change in places.get(kind, {}).items():
            style = pack[kind].setdefault(name, {"patterns": [], "words": []})
            for key in ("patterns", "words"):
                if key in change:
                    merged = list(style.get(key, []))
                    merged += [value for value in change[key] if value not in merged]
                    style[key] = merged
    pack["limits"]["maxWorldNameShare"] = 0.05
    with open(os.path.join(ONLINE, "builtin-2.json"), "w", encoding="utf-8") as out:
        json.dump(pack, out, ensure_ascii=False, indent=1, sort_keys=True)
        out.write("\n")


if __name__ == "__main__":
    main()
