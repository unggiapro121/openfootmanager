"""Build `../default_names.json`, the desktop's shipped name pools, from `out/pools.json`: the
same pools the online pack ships (E3-5q F11), in the desktop's format (two name lists, with
the weights, middle names, flattening, order and shirt rule as optional fields an old reader
ignores). `GB` is England's pool, for the home nations' fallback.

Usage: python3 pools.py && python3 desktop_names.py
"""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    with open(os.path.join(HERE, "out", "pools.json"), encoding="utf-8") as source:
        pools = json.load(source)
    out = {}
    for code, pool in sorted(pools.items()):
        entry = {
            "first_names": [n for n, _ in pool["given"]],
            "last_names": [n for n, _ in pool["family"]],
            "first_name_weights": [w for _, w in pool["given"]],
            "last_name_weights": [w for _, w in pool["family"]],
            "flatten": pool["flatten"],
            "order": pool["order"],
            "shirt": pool["shirt"],
        }
        if pool["middle"]:
            entry["middle_names"] = [n for n, _ in pool["middle"]]
            entry["middle_name_weights"] = [w for _, w in pool["middle"]]
        out[code] = entry
    out["GB"] = out["ENG"]
    document = {
        "version": 2,
        "description": "Name pools for generated people (E3-5q2): counted over whole populations on "
        "Wikidata (CC0) or written for the game; built by ofm-rules/data/build. See data/SOURCES.md.",
        "pools": out,
    }
    with open(os.path.join(os.path.dirname(HERE), "default_names.json"), "w", encoding="utf-8") as target:
        json.dump(document, target, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        target.write("\n")


if __name__ == "__main__":
    main()
