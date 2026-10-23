//! People's names for an online world: drawn by culture, folded for comparison, and kept off the
//! names of real famous people (E3-5q §4.5, F5, F6).

use std::collections::HashSet;
use std::sync::OnceLock;

use rand::{Rng, RngExt};

use super::fold_table::FOLD;
use super::pack::{NameOrder, OnlineNamePool, ShirtName};

const PROTECTED_PEOPLE: &str = include_str!("../../../data/protected_people.txt");

/// `text` lower-cased with diacritics folded to ASCII and everything but letters, digits and
/// spaces dropped: "Đặng Văn-Lâm" → "dang vanlam". Hyphens and apostrophes join, they do not split.
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        let lower = c.to_lowercase().next().unwrap_or(c);
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
        } else if lower.is_whitespace() {
            if !out.ends_with(' ') && !out.is_empty() {
                out.push(' ');
            }
        } else if let Ok(at) = FOLD.binary_search_by_key(&lower, |(from, _)| *from) {
            out.push_str(FOLD[at].1);
        } else if let Ok(at) = FOLD.binary_search_by_key(&c, |(from, _)| *from) {
            out.push_str(FOLD[at].1);
        }
        // Anything else (hyphen, apostrophe, dot) is dropped, joining its neighbours.
    }
    out.trim_end().to_string()
}

/// Every rotation of a name's words, folded and joined with no space: the forms a name takes
/// written in either order. "Son Heung-min" → {"sonheungmin", "heungminson"}.
pub fn rotations(name: &str) -> Vec<String> {
    let folded = fold(name);
    let words: Vec<&str> = folded.split(' ').filter(|word| !word.is_empty()).collect();
    (0..words.len().max(1))
        .map(|start| {
            words[start..]
                .iter()
                .chain(&words[..start])
                .copied()
                .collect::<String>()
        })
        .collect()
}

/// The crate's protected people, each in its forward form (see [`rotations`]).
fn protected_people() -> &'static HashSet<String> {
    static SET: OnceLock<HashSet<String>> = OnceLock::new();
    SET.get_or_init(|| {
        PROTECTED_PEOPLE
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .filter_map(|line| rotations(line).into_iter().next())
            .collect()
    })
}

/// Whether `full_name`, in any order of its words, is a protected person's name, from the crate's
/// list or from `extra`.
pub fn is_protected_person(full_name: &str, extra: &[String]) -> bool {
    let forms = rotations(full_name);
    let set = protected_people();
    forms.iter().any(|form| set.contains(form))
        || extra
            .iter()
            .filter_map(|name| rotations(name).into_iter().next())
            .any(|blocked| forms.contains(&blocked))
}

/// A drawn name, in the parts the domain types hold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonName {
    pub given: String,
    pub middle: Option<String>,
    pub family: String,
}

impl PersonName {
    /// The name as the culture writes it.
    pub fn full(&self, order: NameOrder) -> String {
        let given = self.given_with_middle();
        match order {
            NameOrder::GivenFamily => format!("{given} {}", self.family),
            NameOrder::FamilyGiven => format!("{} {given}", self.family),
        }
    }

    /// The middle name and the given name, as one ("Quang Hải").
    pub fn given_with_middle(&self) -> String {
        match &self.middle {
            Some(middle) => format!("{middle} {}", self.given),
            None => self.given.clone(),
        }
    }

    /// The shirt name, and the longer forms to fall back on when a squad mate already wears it.
    pub fn shirt_forms(&self, shirt: ShirtName, order: NameOrder) -> [String; 3] {
        let initial = |text: &str| {
            text.chars()
                .next()
                .map(|c| format!("{c}."))
                .unwrap_or_default()
        };
        match shirt {
            ShirtName::Family => [
                self.family.clone(),
                format!("{} {}", initial(&self.given), self.family),
                self.full(order),
            ],
            ShirtName::Given => [
                self.given.clone(),
                format!("{} {}", initial(&self.family), self.given),
                self.full(order),
            ],
            ShirtName::GivenWithMiddle => [
                self.given_with_middle(),
                format!("{} {}", initial(&self.family), self.given_with_middle()),
                self.full(order),
            ],
        }
    }
}

/// `weight^flatten` as an integer in thousandths. Rounded, so the draw that uses it is integer
/// arithmetic: a last-bit difference in `powf` between two machines' maths libraries cannot move
/// a name (it would have to land exactly on a half).
pub fn flattened_weight(weight: u32, flatten: f64) -> u64 {
    (f64::from(weight).powf(flatten) * 1000.0).round().max(1.0) as u64
}

/// One entry of `entries`, weighted by `weight^flatten`.
fn draw_weighted<'a>(entries: &'a [(String, u32)], flatten: f64, rng: &mut impl Rng) -> &'a str {
    let weights: Vec<u64> = entries
        .iter()
        .map(|(_, weight)| flattened_weight(*weight, flatten))
        .collect();
    let total: u64 = weights.iter().sum();
    let mut pick = rng.random_range(0..total.max(1));
    for ((name, _), weight) in entries.iter().zip(&weights) {
        if pick < *weight {
            return name;
        }
        pick -= weight;
    }
    entries.last().map_or("", |(name, _)| name.as_str())
}

/// A name from `pool`. The caller passes the person's own name stream.
pub fn draw_name(pool: &OnlineNamePool, rng: &mut impl Rng) -> PersonName {
    let family = draw_weighted(&pool.family, pool.flatten, rng).to_string();
    let middle = (!pool.middle.is_empty())
        .then(|| draw_weighted(&pool.middle, pool.flatten, rng).to_string());
    let given = draw_weighted(&pool.given, pool.flatten, rng).to_string();
    PersonName {
        given,
        middle,
        family,
    }
}

/// `1 / Σ p²` of one part of a pool: how many equally likely names it is worth.
fn effective_count(entries: &[(String, u32)], flatten: f64) -> f64 {
    let weights: Vec<f64> = entries
        .iter()
        .map(|(_, weight)| flattened_weight(*weight, flatten) as f64)
        .collect();
    let total: f64 = weights.iter().sum();
    if total <= 0.0 {
        return 0.0;
    }
    let simpson: f64 = weights.iter().map(|w| (w / total).powi(2)).sum();
    1.0 / simpson
}

/// How many equally likely full names `pool` is worth (inverse Simpson index of each part,
/// multiplied). Each of `n` people of the nation then shares a full name with someone with a
/// chance near `1 − e^(−n / effective_combinations)` (E3-5q §4.5).
pub fn effective_combinations(pool: &OnlineNamePool) -> f64 {
    let middle = if pool.middle.is_empty() {
        1.0
    } else {
        effective_count(&pool.middle, pool.flatten)
    };
    effective_count(&pool.given, pool.flatten)
        * effective_count(&pool.family, pool.flatten)
        * middle
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given names written with diacritics, hyphens and in either order,
    /// when they are folded,
    /// then the forms of one person meet.
    #[test]
    fn a_name_folds_to_the_same_forms_however_it_is_written() {
        assert_eq!(fold("Đặng Văn Lâm"), "dang van lam");
        assert_eq!(fold("Joško Gvardiol"), "josko gvardiol");
        assert_eq!(fold("N'Golo  Kanté"), "ngolo kante");
        let forward = rotations("Son Heung-min");
        assert!(forward.contains(&"heungminson".to_string()));
        assert!(rotations("Heung-min Son").contains(&forward[0]));
        assert_eq!(rotations("Son Heungmin")[0], forward[0]);
    }

    /// Given the crate's protected list,
    /// when names are checked,
    /// then a star is caught in any order and spelling, and an ordinary name is not.
    #[test]
    fn a_protected_person_is_caught_in_any_order() {
        assert!(is_protected_person("Bruno Fernandes", &[]));
        assert!(is_protected_person("Heung-min Son", &[]));
        assert!(is_protected_person("Nguyen Quang Hai", &[]));
        assert!(!is_protected_person("Bruno Fernandes Lima", &[]));
        assert!(!is_protected_person("Nguyễn Quang Hiếu", &[]));
        assert!(is_protected_person(
            "Ada Lovelace",
            &["Lovelace Ada".to_string()]
        ));
    }

    /// Given a pool with one dominant family name,
    /// when the weights are flattened,
    /// then the pool is worth more equally likely names.
    #[test]
    fn flattening_raises_the_effective_number_of_names() {
        let pool = |flatten: f64| OnlineNamePool {
            given: vec![("A".into(), 1), ("B".into(), 1)],
            family: vec![("X".into(), 81), ("Y".into(), 1), ("Z".into(), 1)],
            middle: vec![],
            flatten,
            order: NameOrder::GivenFamily,
            shirt: ShirtName::Family,
        };
        assert!(effective_combinations(&pool(0.5)) > effective_combinations(&pool(1.0)) * 1.3);
    }
}
