//! Club and stadium names for an online world (E3-5q §4.6, F8, F9).
//!
//! A nation's names are every `(place, pattern, word)` combination its style allows, in a fixed
//! order, with every blocked one removed **first**. Club `k` of a nation takes valid name
//! `P(k)`, where `P` is a keyed permutation of the valid list: no two clubs of a nation share a
//! name while `k` is below the list's length, and no club needs to know any other.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use super::names::fold;
use super::pack::{NamingStyleContent, NationContent, OnlineContentPack};
use crate::stable_hash::stable_hash;

const PROTECTED_CLUBS: &str = include_str!("../../../data/protected_clubs.txt");
const PROTECTED_WORDS: &str = include_str!("../../../data/protected_words.txt");

/// Words a club name is made of that say nothing about which club it is: dropped before two names
/// are compared, so "Madrid CF" meets "Real Madrid" and "Hà Nội FC" meets "CLB Hà Nội".
const AFFIXES: &[&str] = &[
    "fc",
    "cf",
    "afc",
    "ac",
    "sc",
    "cd",
    "ud",
    "rc",
    "rcd",
    "sd",
    "ca",
    "cr",
    "se",
    "ec",
    "ad",
    "sv",
    "vfb",
    "vfl",
    "tsv",
    "fk",
    "nk",
    "hnk",
    "sk",
    "bk",
    "if",
    "ifk",
    "ff",
    "aik",
    "us",
    "as",
    "ss",
    "vv",
    "club",
    "clube",
    "calcio",
    "real",
    "united",
    "city",
    "town",
    "athletic",
    "atletico",
    "rovers",
    "wanderers",
    "albion",
    "county",
    "sporting",
    "deportivo",
    "racing",
    "union",
    "uniao",
    "olympique",
    "stade",
    "inter",
    "the",
    "de",
    "del",
    "di",
    "la",
    "le",
    "clb",
    "futebol",
    "esporte",
    "esportiva",
    "associacao",
    "atletica",
    "gremio",
    "sport",
    "football",
    "soccer",
    "1",
    "04",
    "05",
];

fn affixes() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| AFFIXES.iter().copied().collect())
}

/// What is left of a folded name once the common affixes are gone.
fn core_of(folded: &str) -> String {
    folded
        .split(' ')
        .filter(|word| !word.is_empty() && !affixes().contains(word))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The crate's protected clubs: folded names, and folded cores by nation.
struct ProtectedClubs {
    names: HashSet<String>,
    cores: HashMap<String, HashSet<String>>,
    words: Vec<String>,
}

fn protected_clubs() -> &'static ProtectedClubs {
    static SET: OnceLock<ProtectedClubs> = OnceLock::new();
    SET.get_or_init(|| {
        let mut names = HashSet::new();
        let mut cores: HashMap<String, HashSet<String>> = HashMap::new();
        for line in PROTECTED_CLUBS.lines().map(str::trim) {
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((nation, name)) = line.split_once('|') else {
                continue;
            };
            let folded = fold(name);
            let core = core_of(&folded);
            if !core.is_empty() {
                cores.entry(nation.to_string()).or_default().insert(core);
            }
            names.insert(folded);
        }
        let words = PROTECTED_WORDS
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(fold)
            .collect();
        ProtectedClubs {
            names,
            cores,
            words,
        }
    })
}

/// Whether `phrase` (folded) holds `word` (folded) as whole words.
fn contains_words(phrase: &str, word: &str) -> bool {
    format!(" {phrase} ").contains(&format!(" {word} "))
}

/// Whether a generated club or stadium name of `nation` is refused: a real club's name, a real
/// club's name of the same nation with other affixes, or a name holding a brand.
pub fn is_blocked_club_name(name: &str, nation: &str, pack: &OnlineContentPack) -> bool {
    let protected = protected_clubs();
    let folded = fold(name);
    let core = core_of(&folded);
    let extra = &pack.blocklist_extra;
    if protected.names.contains(&folded) || extra.clubs.iter().any(|(_, club)| fold(club) == folded)
    {
        return true;
    }
    let same_core = |club: &str| core_of(&fold(club)) == core;
    if !core.is_empty()
        && (protected
            .cores
            .get(nation)
            .is_some_and(|cores| cores.contains(&core))
            || extra
                .clubs
                .iter()
                .any(|(code, club)| code == nation && same_core(club)))
    {
        return true;
    }
    protected
        .words
        .iter()
        .any(|word| contains_words(&folded, word))
        || extra
            .words
            .iter()
            .any(|word| contains_words(&folded, &fold(word)))
}

/// A pattern filled in.
fn fill(pattern: &str, place: &str, word: &str) -> String {
    pattern.replace("{city}", place).replace("{word}", word)
}

/// Every name `style` makes for `nation`'s places, in a fixed order, as `(name, place)`.
fn combinations(nation: &NationContent, style: &NamingStyleContent) -> Vec<(String, String)> {
    let places: Vec<&String> = nation.cities.iter().chain(&nation.districts).collect();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for pattern in &style.patterns {
        let words: Vec<&str> = if pattern.contains("{word}") {
            style.words.iter().map(String::as_str).collect()
        } else {
            vec![""]
        };
        for place in &places {
            for word in &words {
                let name = fill(pattern, place, word);
                if seen.insert(fold(&name)) {
                    out.push((name, (*place).clone()));
                }
            }
        }
    }
    out
}

/// A nation's valid club names, blocked ones removed, in their fixed order.
///
/// A place two nations both list (Córdoba, Derry, Bangor) belongs to the one whose code sorts
/// first: names hold their place, so this is what keeps two nations from making the same name.
pub fn valid_club_names(nation_code: &str, pack: &OnlineContentPack) -> Vec<(String, String)> {
    let Some(nation) = pack.nations.get(nation_code) else {
        return Vec::new();
    };
    let Some(style) = pack.club_styles.get(&nation.club_style) else {
        return Vec::new();
    };
    let owned_elsewhere: HashSet<String> = pack
        .nations
        .iter()
        .take_while(|(code, _)| code.as_str() < nation_code)
        .flat_map(|(_, earlier)| earlier.cities.iter().chain(&earlier.districts))
        .map(|place| fold(place))
        .collect();
    combinations(nation, style)
        .into_iter()
        .filter(|(_, place)| !owned_elsewhere.contains(&fold(place)))
        .filter(|(name, _)| !is_blocked_club_name(name, nation_code, pack))
        .collect()
}

/// A bijection on `[0, size)`, keyed (E3-5q F9): a 4-round Feistel network on the smallest even
/// number of bits that covers `size`, walked until it lands inside the range.
pub fn keyed_permutation(index: u64, size: u64, key: u64) -> u64 {
    debug_assert!(index < size);
    let bits = (64 - size.saturating_sub(1).leading_zeros()).max(2);
    let half = bits.div_ceil(2);
    let mask = (1u64 << half) - 1;
    let round = |value: u64, number: u64| -> u64 {
        stable_hash(
            &value.to_le_bytes(),
            key ^ number.wrapping_mul(0x9e37_79b9_7f4a_7c15),
        ) & mask
    };
    let mut value = index;
    loop {
        let (mut left, mut right) = (value >> half & mask, value & mask);
        for number in 0..4 {
            let next = left ^ round(right, number);
            left = right;
            right = next;
        }
        value = left << half | right;
        if value < size {
            return value;
        }
    }
}

/// The key of a nation's permutation of names.
pub fn name_key(world_seed: u64, nation: &str, pack_version: &str) -> u64 {
    stable_hash(
        format!("club-names/{nation}/{pack_version}").as_bytes(),
        world_seed,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given every index of a range that is not a power of two,
    /// when it is permuted,
    /// then each index lands once, and neighbours do not land on neighbours in step.
    #[test]
    fn the_keyed_permutation_is_a_bijection_that_looks_random() {
        let size = 1_217;
        let mut seen = vec![false; size as usize];
        for index in 0..size {
            let at = keyed_permutation(index, size, 42);
            assert!(!seen[at as usize], "{index} collides");
            seen[at as usize] = true;
        }
        let steps: HashSet<u64> = (0..50)
            .map(|index| {
                keyed_permutation(index + 1, size, 42)
                    .wrapping_sub(keyed_permutation(index, size, 42))
            })
            .collect();
        assert!(steps.len() > 40, "consecutive clubs follow a stride");
    }

    /// Given the builtin pack,
    /// when names are checked,
    /// then real clubs are refused, exactly or with other affixes, and names with a brand too.
    #[test]
    fn real_clubs_and_brands_are_refused() {
        let pack = OnlineContentPack::builtin();
        assert!(is_blocked_club_name("Manchester United", "ENG", &pack));
        assert!(is_blocked_club_name("Manchester Rovers", "ENG", &pack));
        assert!(is_blocked_club_name("Madrid CF", "ES", &pack));
        assert!(is_blocked_club_name("CLB Hà Nội", "VN", &pack));
        assert!(is_blocked_club_name("Thép Xanh Hà Tĩnh", "VN", &pack));
        assert!(!is_blocked_club_name("Manchester Harriers", "ENG", &pack));
        assert!(!is_blocked_club_name("Rồng Lửa Hà Nội", "VN", &pack));
    }

    /// Given nations that list the same place (Córdoba in AR and ES, Derry in IE and NIR),
    /// when their valid names are listed,
    /// then no name is in both lists: the place belongs to one of them.
    #[test]
    fn two_nations_never_make_the_same_name() {
        let pack = OnlineContentPack::builtin();
        for (first, second) in [("AR", "ES"), ("IE", "NIR"), ("NIR", "WAL")] {
            let names = |code: &str| -> HashSet<String> {
                valid_club_names(code, &pack)
                    .iter()
                    .map(|(name, _)| fold(name))
                    .collect()
            };
            assert!(
                names(first).is_disjoint(&names(second)),
                "{first} and {second}"
            );
        }
    }

    /// Given the builtin pack,
    /// when a nation's valid names are listed,
    /// then none is blocked and none repeats.
    #[test]
    fn a_nations_valid_names_are_unique_and_allowed() {
        let pack = OnlineContentPack::builtin();
        let names = valid_club_names("VN", &pack);
        let folded: HashSet<String> = names.iter().map(|(name, _)| fold(name)).collect();
        assert_eq!(folded.len(), names.len());
        assert!(
            names
                .iter()
                .all(|(name, _)| !is_blocked_club_name(name, "VN", &pack))
        );
        assert!(names.len() > 2_000, "{}", names.len());
    }
}
