"""The capacity measures of `validate_pack`, in Python, to size the pools before they ship."""

import math

def people_at_scale(pack):
    """Expected people of each nationality at the pack's scale, as `validate_pack` counts them:
    the locals of each nation's clubs and the region's foreigners shared by weight."""
    scale = pack["scale"]
    people = {}
    for region, content in pack["regions"].items():
        clubs = round(scale["clubs"] * scale["regionShare"].get(region, 0.0))
        total = sum(w for _, w in content["nations"]) or 1
        region_people = clubs * scale["peoplePerClub"]
        for code, weight in content["nations"]:
            expected = clubs * weight / total
            people[code] = people.get(code, 0.0) + (
                expected * scale["peoplePerClub"] * content["localShare"]
                + region_people * content["foreignFromRegionShare"] * weight / total
            )
    return people


PEOPLE_AT_SCALE = {}


def flattened(weight, alpha):
    """The integer draw weight of `validate_pack`: round(w^α × 1000), at least 1."""
    return max(1, round(weight**alpha * 1000))


def effective(entries, alpha):
    """Inverse Simpson index of the flattened weights: the number of equally likely names."""
    weights = [flattened(w, alpha) for _, w in entries]
    total = sum(weights)
    if total == 0:
        return 0.0
    return 1.0 / sum((w / total) ** 2 for w in weights)


def combinations(pool):
    alpha = pool["flatten"]
    n = effective(pool["given"], alpha) * effective(pool["family"], alpha)
    if pool.get("middle"):
        n *= effective(pool["middle"], alpha)
    return n


def predicted_share(code, pool):
    n = PEOPLE_AT_SCALE.get(code, 0)
    return 1.0 - math.exp(-max(n - 1, 0) / max(combinations(pool), 1.0))
