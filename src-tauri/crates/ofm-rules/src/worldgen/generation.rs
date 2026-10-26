//! A generated person: a random player, staff member or manager drawn from the name pools and the
//! nation catalog (phase 3, E3-5c). A person written in a world package is built by
//! `ofm_core::generator`, from the same helpers.

use domain::player::{Player, PlayerAttributes, Position};
use domain::staff::{Staff, StaffAttributes, StaffRole};
use domain::team::PlayStyle;
use rand::{Rng, RngExt};

use super::definitions::{NamePool, NamesDefinition};
use super::physique::{BodyLinks, Physique, correlated_jitter, sample_physique};
use crate::nations;
use crate::player_rating::refresh_player_derived;

// ---------------------------------------------------------------------------
// Helper functions for world generation
// ---------------------------------------------------------------------------

/// Pick a nationality: 60% the club's own country, 40% from the wider draw.
///
/// When the club's country resolves to no known nation the local weight has
/// nothing to apply to, so the whole draw comes from `available_codes`. That is
/// the #453 fix: an unrecognised country used to mean England, specifically and
/// silently, for 60% of the squad.
pub fn pick_nationality_from_def(
    team_country: &str,
    available_codes: &[String],
    rng: &mut impl Rng,
) -> String {
    /// Share of a squad drawn from the club's own country.
    const LOCAL_SHARE_PERCENT: u32 = 60;

    // The catalog first, then the world's own list. A package may declare
    // countries the catalog has never heard of — that is the point of authoring
    // one — and for a club in such a country the id *is* the nationality. Only a
    // country neither the catalog nor this world recognises is unresolvable.
    let local = resolve_nationality_code(team_country)
        .or_else(|| declared_code(team_country, available_codes));

    // Nothing to draw from: the club's own country is the only answer available,
    // and when that is unknown too there is genuinely none to give.
    if available_codes.is_empty() {
        return canonicalize_generated_nationality(local.as_deref().unwrap_or_default());
    }

    // An unresolvable country skips the local roll entirely rather than losing
    // it — the whole draw comes from the wider pool.
    let selected = match local {
        Some(code) if rng.random_range(0..100) < LOCAL_SHARE_PERCENT => code,
        _ => available_codes[rng.random_range(0..available_codes.len())].clone(),
    };

    canonicalize_generated_nationality(&selected)
}

/// Match a club's country against the nationalities this world actually draws
/// from, for countries the shipped catalog does not contain.
///
/// `available_codes` is the world's own nationality list, so a package country
/// reaches here only if [`super::build_world_data_from_package`] put it there —
/// which it does for every country the package declares. Comparing against that
/// list rather than accepting any unknown string keeps an outright typo
/// unresolvable, which is what #453 was about.
fn declared_code(team_country: &str, available_codes: &[String]) -> Option<String> {
    let trimmed = team_country.trim();
    if trimmed.is_empty() {
        return None;
    }
    available_codes
        .iter()
        .find(|code| code.eq_ignore_ascii_case(trimmed))
        .cloned()
}

pub fn canonicalize_generated_nationality(value: &str) -> String {
    match value.trim().to_ascii_uppercase().as_str() {
        // Freshly generated football identities should never persist the ambiguous GB code.
        "GB" => "ENG".to_string(),
        other => other.to_string(),
    }
}

/// Mixed into a person's id for the stream their name is drawn from.
const NAME_SALT: u64 = 0x4e41_4d45_0000_0001;

/// The stream a generated person's name is drawn from, keyed by their id (E3-5q F13).
///
/// A name has its own stream so the name pools and the blocklists can change without moving any
/// attribute drawn after the name: a new pool renames people, it never re-rolls them. The id is
/// drawn first from the person's own stream, so this one is as deterministic as the rest.
pub fn name_rng(person_id: &str) -> rand_chacha::ChaCha12Rng {
    crate::seed::rng_from_key(&format!("{NAME_SALT:x}/{person_id}"))
}

/// Pick a name from the NamesDefinition for a given nationality code: `(given name with any
/// middle name, family name)`.
pub fn pick_name_from_def(
    nationality: &str,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> (String, String) {
    let name = pick_person_name(nationality, names_def, rng);
    (name.given_with_middle(), name.family)
}

/// A person's name and how it is written: `(name, order, shirt rule)`.
pub struct DrawnName {
    pub name: crate::worldgen::online::names::PersonName,
    pub order: crate::worldgen::online::pack::NameOrder,
    pub shirt: crate::worldgen::online::pack::ShirtName,
}

impl DrawnName {
    pub fn given_with_middle(&self) -> String {
        self.name.given_with_middle()
    }

    /// The full name in the culture's order.
    pub fn full(&self) -> String {
        self.name.full(self.order)
    }

    /// What the shirt reads.
    pub fn shirt_name(&self) -> String {
        let [first, ..] = self.name.shirt_forms(self.shirt, self.order);
        first
    }
}

/// A name for one person from the pool of `nationality` (or one borrowed), drawn from `rng` — the
/// person's own name stream (F13) — and drawn again while it is a protected person's (F6).
pub fn pick_drawn_name(
    nationality: &str,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> DrawnName {
    use crate::worldgen::online::names::is_protected_person;
    let mut drawn = draw_from_def(nationality, names_def, rng);
    for _ in 0..32 {
        if !is_protected_person(&drawn.full(), &[]) {
            break;
        }
        drawn = draw_from_def(nationality, names_def, rng);
    }
    drawn
}

fn pick_person_name(
    nationality: &str,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> crate::worldgen::online::names::PersonName {
    pick_drawn_name(nationality, names_def, rng).name
}

fn draw_from_def(nationality: &str, names_def: &NamesDefinition, rng: &mut impl Rng) -> DrawnName {
    let candidate_codes = match nationality {
        "ENG" | "SCO" | "WAL" | "NIR" => vec![nationality, "GB"],
        _ => vec![nationality],
    };

    for candidate in candidate_codes {
        if let Some(pool) = names_def.pools.get(candidate)
            && !pool.first_names.is_empty()
            && !pool.last_names.is_empty()
        {
            return draw_name(pool, rng);
        }
    }

    match fallback_pool(nationality, names_def, rng) {
        Some(pool) => draw_name(pool, rng),
        None => DrawnName {
            name: crate::worldgen::online::names::PersonName {
                given: "Player".to_string(),
                middle: None,
                family: "Unknown".to_string(),
            },
            order: crate::worldgen::online::pack::NameOrder::GivenFamily,
            shirt: crate::worldgen::online::pack::ShirtName::Family,
        },
    }
}

/// One entry of `names`: evenly when the pool weighs nothing (an old file, drawn as it always
/// was), else by `weight^flatten` as the online pack draws.
fn draw_one(names: &[String], weights: &[u32], flatten: f64, rng: &mut impl Rng) -> String {
    if weights.len() != names.len() {
        return names[rng.random_range(0..names.len())].clone();
    }
    let flattened: Vec<u64> = weights
        .iter()
        .map(|weight| crate::worldgen::online::names::flattened_weight(*weight, flatten))
        .collect();
    let total: u64 = flattened.iter().sum();
    let mut pick = rng.random_range(0..total.max(1));
    for (name, weight) in names.iter().zip(&flattened) {
        if pick < *weight {
            return name.clone();
        }
        pick -= weight;
    }
    names[names.len() - 1].clone()
}

/// A name from `pool`. Callers must have checked it is usable. Family name first, then the
/// middle name, then the given name, as the online pack draws.
fn draw_name(pool: &NamePool, rng: &mut impl Rng) -> DrawnName {
    let flatten = pool.flatten.unwrap_or(1.0).clamp(0.01, 1.0);
    let weighted = !pool.first_name_weights.is_empty() || !pool.last_name_weights.is_empty();
    let (family, middle, given) = if weighted {
        let family = draw_one(&pool.last_names, &pool.last_name_weights, flatten, rng);
        let middle = (!pool.middle_names.is_empty())
            .then(|| draw_one(&pool.middle_names, &pool.middle_name_weights, flatten, rng));
        let given = draw_one(&pool.first_names, &pool.first_name_weights, flatten, rng);
        (family, middle, given)
    } else {
        // An old file: given then family, evenly, as before E3-5q2.
        let given = pool.first_names[rng.random_range(0..pool.first_names.len())].clone();
        let family = pool.last_names[rng.random_range(0..pool.last_names.len())].clone();
        (family, None, given)
    };
    DrawnName {
        name: crate::worldgen::online::names::PersonName {
            given,
            middle,
            family,
        },
        order: pool
            .order
            .unwrap_or(crate::worldgen::online::pack::NameOrder::GivenFamily),
        shirt: pool
            .shirt
            .unwrap_or(crate::worldgen::online::pack::ShirtName::Family),
    }
}

/// The pool to borrow from when a nationality has none of its own — the common
/// case, since only 17 pools ship against ~210 selectable nations.
///
/// Prefers a pool from the same confederation, then any usable pool. This used to
/// take `pools.keys().min()`, the lexicographically smallest key, which for the
/// shipped set is always `AR`: a Pole, a Nigerian and a Japanese player were
/// all named Ezequiel, deterministically.
///
/// Both sides of the region comparison must resolve to a *declared* region.
/// `region_for_code` answers `europe` for anything it does not recognise, so
/// matching on it would file every unknown key — a package keying its pools
/// `BRA`/`ESP`/`JPN`, say — as European, then hand a Pole a Japanese name
/// while a Brazilian matched none of them. An unknown code on either side falls
/// straight through to "any usable pool" instead, which is merely arbitrary
/// rather than confidently wrong.
///
/// Candidates are sorted before the draw because `pools` is a `HashMap` whose
/// iteration order is randomized per process.
fn fallback_pool<'a>(
    nationality: &str,
    names_def: &'a NamesDefinition,
    rng: &mut impl Rng,
) -> Option<&'a NamePool> {
    let usable = |pool: &NamePool| !pool.first_names.is_empty() && !pool.last_names.is_empty();
    let region_of = |code: &str| nations::nation_by_code(code).map(|nation| nation.region_id);

    let mut candidates: Vec<(&String, &NamePool)> = Vec::new();
    if let Some(region) = region_of(nationality) {
        candidates = names_def
            .pools
            .iter()
            .filter(|(code, pool)| usable(pool) && region_of(code) == Some(region))
            .collect();
    }
    if candidates.is_empty() {
        candidates = names_def
            .pools
            .iter()
            .filter(|(_, pool)| usable(pool))
            .collect();
    }
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|left, right| left.0.cmp(right.0));

    Some(candidates[rng.random_range(0..candidates.len())].1)
}

/// Resolve a club's declared country to a nationality code, or `None` when it
/// names no nation the game knows.
///
/// Replaces `country_to_iso`, which matched 17 country names by hand and
/// answered `"ENG"` for everything else — so `"country": "Japan"` filled 60% of
/// every Japanese club with English players, with nothing in the log or the UI
/// to say so. Its length heuristic was a second wrong answer: any 2–3 character
/// string was passed through as though it were a code.
///
/// `None` is the important part. An unresolvable country must stay explicitly
/// unknown so the caller can draw from the whole distribution, rather than
/// being handed a real, specific, wrong nationality.
pub fn resolve_nationality_code(country: &str) -> Option<String> {
    let trimmed = country.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Football identities first: this is what maps "England"/"english"/"eng" —
    // and the UK home nations generally — onto the codes the game uses.
    let normalized = domain::identity::normalize_football_nation_code(trimmed);
    if nations::nation_by_code(&normalized).is_some() {
        return Some(normalized);
    }
    // `GB` is a real football identity but never a generated nationality; the
    // caller canonicalises it to ENG.
    if normalized == "GB" {
        return Some(normalized);
    }

    // Then the catalog's own display names, which is what makes "Japan",
    // "Nigeria" and the other 190-odd nations resolve at all.
    nations::nation_by_name(trimmed).map(|nation| nation.code.to_string())
}

/// Every nationality a generated player can have, repeated in proportion to how
/// often it should come up.
///
/// #452: this used to be `names_def.pools.keys()` — the 17 name-pool keys. A
/// lookup table was doing the job of a population model, so a world contained
/// at most ~16 nationalities (14 of them European) no matter how many countries
/// it had, and no amount of catalog work could change that.
///
/// Weight has two factors, because a nation's standing has two parts and the
/// catalog only records one of them.
///
/// *Rank within region* comes from [`nations::NATION_CATALOG`], already
/// documented as "strongest footballing traditions first within each region" —
/// a signal the codebase maintains anyway.
///
/// *Region depth* has to be declared, and [`REGION_WEIGHT`] declares it. Rank
/// alone is a **rank among unequal fields**: it makes the top of every region
/// equal, so Costa Rica draws as often as Brazil and France, New Zealand
/// outranks Spain, and a world ends up with more Central American players than
/// South American ones. Multiplying restores the comparison the catalog cannot
/// express, and keeps the ordering rank already gets right inside a region.
///
/// [`nations::ADDITIONAL_NATIONS`] form a flat low-weight tail: reachable, but
/// rare, and deliberately not region-scaled — they are outside the World Cup
/// pool, which is the only claim being made about them.
///
/// Deliberately *not* `NationGen.strength`: that exists for only the 16
/// generation nations and is already spoken for by club reputation, so using it
/// here would privilege exactly the nations this issue is about and couple two
/// unrelated models.
///
/// Expanded into a plain `Vec` so callers keep drawing with a uniform index —
/// the weighting lives here, once, instead of at every draw site. Built once:
/// it derives purely from `&'static` catalogs, and the order must be stable or
/// seeded generation stops reproducing.
pub fn nationality_distribution() -> &'static Vec<String> {
    static DISTRIBUTION: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    DISTRIBUTION.get_or_init(|| {
        /// Weight of the strongest nation in a region. Ranks below it step down
        /// by one, so a region's top handful dominate its share without
        /// shutting the rest out.
        const TOP_WEIGHT: usize = 12;
        /// Floor for a World Cup nation, and the flat weight of the tail. Two
        /// tiers rather than one: Europe alone has 26 catalog nations, so a
        /// single floor of 1 made everything past rank 11 exactly as likely as
        /// a merely-selectable nation — Poland would have drawn as often as
        /// Andorra. A qualifying nation should always outrank a non-entrant.
        const CATALOG_FLOOR: usize = 2;
        const TAIL_WEIGHT: usize = 1;

        let mut pool = Vec::new();
        let mut seen_in_region: std::collections::HashMap<&str, usize> =
            std::collections::HashMap::new();

        for nation in nations::NATION_CATALOG {
            let rank = seen_in_region.entry(nation.region_id).or_insert(0);
            let within_region = TOP_WEIGHT.saturating_sub(*rank).max(CATALOG_FLOOR);
            let weight = within_region * region_weight(nation.region_id);
            *rank += 1;
            for _ in 0..weight {
                pool.push(nation.code.to_string());
            }
        }
        for nation in nations::ADDITIONAL_NATIONS {
            for _ in 0..TAIL_WEIGHT {
                pool.push(nation.code.to_string());
            }
        }
        pool
    })
}

/// The catalog distribution, plus the countries a world declares for itself.
///
/// A package country is absent from both catalogs by definition, so the static
/// pool cannot contain it and a club in one used to draw its whole squad from
/// elsewhere. Declared countries are appended at [`DECLARED_WEIGHT`] — heavy
/// enough that they actually appear in neighbouring squads, light enough that
/// declaring a handful does not drown out the rest of the world.
///
/// A declared id that *is* already a catalog code (a package covering real
/// nations, the common case) is skipped rather than added twice: it is already
/// in the pool at its proper weight, and appending would quietly promote it.
pub fn nationality_distribution_including<'a>(
    declared: impl Iterator<Item = &'a str>,
) -> Vec<String> {
    /// Pool entries per declared country. Matches a mid-table catalog nation:
    /// present and drawable, not dominant.
    const DECLARED_WEIGHT: usize = 12;

    let mut pool = nationality_distribution().clone();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for id in declared {
        let code = canonicalize_generated_nationality(id);
        if code.is_empty() || nations::nation_by_code(&code).is_some() || !seen.insert(code.clone())
        {
            continue;
        }
        for _ in 0..DECLARED_WEIGHT {
            pool.push(code.clone());
        }
    }
    pool
}

/// How much of the world's football a region accounts for, as a multiplier on
/// rank within it.
///
/// Hand-authored on purpose: no existing field carries it. `NationDef` records
/// a code, a name and a region, and the catalog's ordering is explicitly
/// *within* each region — so there is nothing to derive a cross-region
/// comparison from, and inventing one from list length would say only that
/// Africa has many federations, not that it supplies many players.
///
/// The numbers are deliberately coarse. They are a first approximation of where
/// professional players come from, not a ranking of national teams, and they
/// should be tuned against generated worlds rather than argued about in the
/// abstract.
fn region_weight(region_id: &str) -> usize {
    match region_id {
        "europe" => 6,
        "south-america" => 5,
        "africa" => 3,
        "asia" => 2,
        "north-america" | "central-america" => 2,
        "oceania" => 1,
        // `region_for_code` defaults unknown codes to europe, so an unrecognised
        // region here means the catalog gained one this table has not been told
        // about. Weight it as a modest region rather than silently as Europe.
        _ => 2,
    }
}

pub fn play_style_from_str(s: &str) -> PlayStyle {
    match s {
        "Attacking" => PlayStyle::Attacking,
        "Defensive" => PlayStyle::Defensive,
        "Possession" => PlayStyle::Possession,
        "Counter" => PlayStyle::Counter,
        "HighPress" => PlayStyle::HighPress,
        _ => PlayStyle::Balanced,
    }
}

/// Number of slots in a generated squad. The slot layout is `GK 0-1`, `DEF 2-8`,
/// `MID 9-15`, `FWD 16-21` — see [`generate_random_player_from_def`]. This is the
/// single source of truth for squad size; anything that walks or wraps slots
/// should use it rather than repeating the literal.
pub const SQUAD_SLOTS: usize = 22;

/// The squad floor lives in `squad_floor`; trimming generated players off an
/// authored squad must never take a group below it — a club with no goalkeeper
/// is unplayable.
pub use crate::squad::MIN_PLAYERS_PER_GROUP;

/// Squad slots reserved as youth-aged, one per position group in
/// `[GK, DEF, MID, FWD]` order. Scouted youth recruits target these slots so they
/// generate at a consistent academy age, and senior generation must avoid them.
/// This is the single source of truth shared by the youth-recruit targeting,
/// youth-age generation, and national-team senior remap logic.
pub const YOUTH_RESERVED_SLOTS: [usize; 4] = [1, 8, 15, 21];

/// Candidate youth slots for a (group) position target. A specific group yields
/// its single reserved slot; `None` (or any other position) yields all of them.
pub fn youth_slots_for_target(group: Option<Position>) -> &'static [usize] {
    match group {
        Some(Position::Goalkeeper) => &YOUTH_RESERVED_SLOTS[0..1],
        Some(Position::Defender) => &YOUTH_RESERVED_SLOTS[1..2],
        Some(Position::Midfielder) => &YOUTH_RESERVED_SLOTS[2..3],
        Some(Position::Forward) => &YOUTH_RESERVED_SLOTS[3..4],
        _ => &YOUTH_RESERVED_SLOTS,
    }
}

/// Whether a squad slot is reserved for a youth-aged player.
pub fn is_youth_reserved_slot(slot: usize) -> bool {
    YOUTH_RESERVED_SLOTS.contains(&slot)
}

/// The position group a generated squad slot holds: GK 0-1, DEF 2-8, MID 9-15,
/// FWD 16-21.
pub fn position_for_slot(index: usize) -> Position {
    if index < 2 {
        Position::Goalkeeper
    } else if index < 9 {
        Position::Defender
    } else if index < 16 {
        Position::Midfielder
    } else {
        Position::Forward
    }
}

/// The first squad slot that generates a senior player of this group at a position drawn from
/// the real mix (a flexible slot), for callers that want "a defender" and nothing more.
pub fn senior_slot_for(group: &Position) -> usize {
    (0..SQUAD_SLOTS)
        .find(|slot| {
            position_for_slot(*slot) == *group
                && !is_youth_reserved_slot(*slot)
                && is_flexible_slot(*slot)
        })
        .or_else(|| {
            (0..SQUAD_SLOTS)
                .find(|slot| position_for_slot(*slot) == *group && !is_youth_reserved_slot(*slot))
        })
        .unwrap_or(0)
}

/// Senior slots whose detailed position is drawn from the real mix of their group rather than
/// fixed: a squad needs its centre-backs, full-backs, holding and wide midfielders and
/// strikers, and varies from there.
const FLEXIBLE_SLOTS: [usize; 7] = [6, 7, 12, 13, 14, 19, 20];

pub fn is_flexible_slot(slot: usize) -> bool {
    FLEXIBLE_SLOTS.contains(&slot)
}

/// Either flank, drawn.
fn side(left: Position, right: Position, rng: &mut impl Rng) -> Position {
    if rng.random_range(0..2) == 0 {
        left
    } else {
        right
    }
}

/// The detailed position a squad slot generates, or `None` for a youth-reserved slot, whose
/// player has only his group until his position settles. The fixed slots give a squad its
/// spine (two centre-backs and a full-back each side, a holding, a central and a wide
/// midfielder, two strikers and a winger); the flexible ones draw from the shares real squads
/// have — defenders 54% centre-backs, midfielders 21% holding, 31% central, 17% attacking,
/// 31% wide, forwards 76% strikers.
pub fn detailed_position_for_slot(index: usize, rng: &mut impl Rng) -> Option<Position> {
    if is_youth_reserved_slot(index) {
        return None;
    }
    let draw = rng.random_range(0..100u32);
    Some(match index {
        0 => Position::Goalkeeper,
        2 | 3 => Position::CenterBack,
        4 => Position::LeftBack,
        5 => Position::RightBack,
        6 | 7 => {
            if draw < 54 {
                Position::CenterBack
            } else {
                side(Position::LeftBack, Position::RightBack, rng)
            }
        }
        9 => Position::DefensiveMidfielder,
        10 => Position::CentralMidfielder,
        11 => side(Position::LeftMidfielder, Position::RightMidfielder, rng),
        12..=14 => match draw {
            0..=20 => Position::DefensiveMidfielder,
            21..=51 => Position::CentralMidfielder,
            52..=68 => Position::AttackingMidfielder,
            _ => side(Position::LeftMidfielder, Position::RightMidfielder, rng),
        },
        16 | 17 => Position::Striker,
        18 => side(Position::LeftWinger, Position::RightWinger, rng),
        19 | 20 => {
            if draw < 76 {
                Position::Striker
            } else {
                side(Position::LeftWinger, Position::RightWinger, rng)
            }
        }
        _ => return None,
    })
}

/// Remap a youth-reserved slot to the adjacent senior slot (same position group)
/// so the player generates at a senior age; non-reserved slots pass through.
pub fn senior_slot(slot: usize) -> usize {
    if is_youth_reserved_slot(slot) {
        slot - 1
    } else {
        slot
    }
}

/// A generated player for squad slot `index`. `age` fixes his age; `None`
/// draws it from the slot: 17–21 for a youth-reserved slot, otherwise 18–35
/// spread as real senior squads are (see `calibration::draw_senior_age`).
///
/// The attributes are a raw profile on a senior scale. Every caller outside the
/// academy brings the player to his real level with
/// `calibration::calibrate_generated_player`; the academy's own recruits are
/// grown into their age by `youth::grow_into_age` instead.
pub fn generate_random_player_from_def(
    team_id: &str,
    index: usize,
    nationality: &str,
    opening_year: u32,
    age: Option<u32>,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> Player {
    let p_id = crate::seed::uuid_from(rng);
    let drawn = pick_drawn_name(nationality, names_def, &mut name_rng(&p_id));
    let full_name = drawn.full();
    let match_name = drawn.shirt_name();

    let position = position_for_slot(index);

    let nationality = nationality.to_string();

    // Reserve one slot per position group (GK + back line + midfield + attack) as
    // youth-aged so scouted youth recruits land at a consistent age across positions
    // and clubs can open with real academy prospects instead of an empty youth squad.
    let age = age.unwrap_or_else(|| {
        if is_youth_reserved_slot(index) {
            rng.random_range(17..22)
        } else {
            super::calibration::draw_senior_age(rng)
        }
    });
    let birth_year = opening_year.saturating_sub(age);
    let birth_month = rng.random_range(1..13);
    let birth_day = rng.random_range(1..29);
    let dob = format!("{:04}-{:02}-{:02}", birth_year, birth_month, birth_day);

    // The body comes first: the attributes it shapes are drawn to follow it. A squad player has
    // his detailed position from the start; a young one has only his group, which his position
    // settles into as he develops (see `player_identity`).
    let detailed = detailed_position_for_slot(index, rng);
    let draw_position = detailed.clone().unwrap_or_else(|| position.clone());
    let body = sample_physique(&draw_position, None, None, rng);
    let attributes = super::attribute_shape::draw_attributes(&draw_position, &body, rng);

    let current_year: u32 = opening_year;
    let contract_years = if age <= 21 {
        rng.random_range(3..6)
    } else if age <= 27 {
        rng.random_range(2..5)
    } else if age <= 31 {
        rng.random_range(2..4)
    } else if rng.random_range(0..100) < 40 {
        1
    } else {
        2
    };
    let contract_end = format!("{}-06-30", opening_year.saturating_add(contract_years));

    let mut player = Player::new(
        p_id,
        match_name,
        full_name,
        dob,
        nationality,
        position,
        attributes,
    );
    player.team_id = Some(team_id.to_string());
    player.height_cm = body.height_cm;
    player.weight_kg = body.weight_kg;
    player.stage_contract_end(Some(contract_end));
    player.condition = rng.random_range(75..100);
    player.morale = rng.random_range(40..76);

    if let Some(detailed) = detailed {
        player.natural_position = detailed;
        crate::player_identity::settle_secondary_identity(&mut player);
    }

    // Set position-weighted OVR, potential, and traits (Wonderkid included if applicable)
    let player_age = current_year.saturating_sub(birth_year);
    // Pre-generate a potential so Wonderkid trait is assigned correctly on first refresh
    let temp_ovr = {
        use crate::player_rating::natural_ovr;
        natural_ovr(&player).round() as u8
    };
    // From the generation's own stream, so a seeded world or season pool replays.
    player.potential = crate::player_rating::generate_potential_from(temp_ovr, player_age, rng);
    refresh_player_derived(&mut player, current_year);
    // A habit, drawn once from the player's id (see `assigned_traits`).
    crate::assigned_traits::assign_traits(&mut player, current_year);
    // Priced once rating and potential are settled, since both drive the price.
    // No club yet: the career's opening reprices him at the club he plays for.
    player.market_value = generated_market_value(&player, opening_year);
    player.stage_wage(crate::valuation::market_wage(&player, None));

    player.jersey_number = jersey_number_for_slot(index);

    player
}

fn jersey_number_for_slot(index: usize) -> Option<u8> {
    let n: u8 = match index {
        0 => 1,
        1 => 13,
        2 => 2,
        3 => 5,
        4 => 6,
        5 => 3,
        6 => 4,
        7 => 12,
        8 => 22,
        9 => 8,
        10 => 7,
        11 => 10,
        12 => 14,
        13 => 11,
        14 => 16,
        15 => 23,
        16 => 9,
        17 => 17,
        18 => 18,
        19 => 19,
        20 => 20,
        21 => 24,
        _ => return None,
    };
    Some(n)
}

pub fn generate_random_staff_from_def(
    team_id: &str,
    role: StaffRole,
    nationality: &str,
    opening_year: u32,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> Staff {
    let id = crate::seed::uuid_from(rng);
    let (first_name, last_name) = pick_name_from_def(nationality, names_def, &mut name_rng(&id));
    let age = rng.random_range(30..60);
    let birth_year = opening_year.saturating_sub(age);
    let dob = format!(
        "{:04}-{:02}-{:02}",
        birth_year,
        rng.random_range(1..13),
        rng.random_range(1..29)
    );

    let attributes = match &role {
        StaffRole::AssistantManager => StaffAttributes {
            coaching: rng.random_range(50..90),
            judging_ability: rng.random_range(50..85),
            judging_potential: rng.random_range(40..80),
            physiotherapy: rng.random_range(20..50),
        },
        StaffRole::Coach => StaffAttributes {
            coaching: rng.random_range(55..95),
            judging_ability: rng.random_range(40..75),
            judging_potential: rng.random_range(30..70),
            physiotherapy: rng.random_range(20..45),
        },
        StaffRole::Scout => StaffAttributes {
            coaching: rng.random_range(20..50),
            judging_ability: rng.random_range(60..95),
            judging_potential: rng.random_range(55..95),
            physiotherapy: rng.random_range(10..30),
        },
        StaffRole::Physio => StaffAttributes {
            coaching: rng.random_range(10..40),
            judging_ability: rng.random_range(20..50),
            judging_potential: rng.random_range(15..45),
            physiotherapy: rng.random_range(60..95),
        },
    };

    let mut s = Staff::new(id, first_name, last_name, dob, role, attributes);
    s.nationality = nationality.to_string();
    s.team_id = Some(team_id.to_string());
    s
}

pub fn generate_random_staff_unattached_from_def(
    role: StaffRole,
    nationality: &str,
    opening_year: u32,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> Staff {
    let id = crate::seed::uuid_from(rng);
    let (first_name, last_name) = pick_name_from_def(nationality, names_def, &mut name_rng(&id));
    let age = rng.random_range(28..55);
    let birth_year = opening_year.saturating_sub(age);
    let dob = format!(
        "{:04}-{:02}-{:02}",
        birth_year,
        rng.random_range(1..13),
        rng.random_range(1..29)
    );

    let attributes = StaffAttributes {
        coaching: rng.random_range(30..80),
        judging_ability: rng.random_range(30..80),
        judging_potential: rng.random_range(25..75),
        physiotherapy: rng.random_range(25..75),
    };

    let mut s = Staff::new(id, first_name, last_name, dob, role, attributes);
    s.nationality = nationality.to_string();
    s
}

// ---------------------------------------------------------------------------
// Attributes around a target overall
// ---------------------------------------------------------------------------

fn jitter(base: i32, spread: i32, lo: u8, hi: u8, rng: &mut impl Rng) -> u8 {
    (base + rng.random_range(-spread..=spread)).clamp(lo as i32, hi as i32) as u8
}

/// Build a realistic attribute spread centred on a target `overall`, shaped by
/// position so a goalkeeper's keeping attributes and a defender's defending sit
/// high. Used when a hand-authored player gives an `overall` rather than a full
/// `attributes` block; the resulting position-weighted OVR lands near `overall`.
/// The attributes a body shapes follow `body`, as they do for a random player.
pub fn attributes_for_overall(
    overall: u8,
    position: &Position,
    body: &Physique,
    rng: &mut impl Rng,
) -> PlayerAttributes {
    let base = overall as i32;
    let group = position.to_group_position();
    let is_gk = matches!(group, Position::Goalkeeper);
    let is_def = matches!(group, Position::Defender);
    let is_fwd = matches!(group, Position::Forward);
    let links = BodyLinks::for_position(position);
    let (z_height, z_weight) = (body.z_height, body.z_weight);

    let mut attributes = PlayerAttributes {
        pace: correlated_jitter(base, 8, (30, 97), z_height, links.pace, rng),
        stamina: jitter(base, 8, 30, 97, rng),
        strength: correlated_jitter(base, 8, (30, 97), z_weight, links.strength, rng),
        agility: correlated_jitter(base, 8, (30, 97), z_height, links.agility, rng),
        passing: jitter(base, 8, 30, 97, rng),
        // See the random generator: a defender's shooting sits ~25 under his level.
        shooting: if is_gk {
            rng.random_range(20..50)
        } else if is_def {
            jitter(base - 25, 8, 20, 80, rng)
        } else {
            jitter(base, 8, 30, 97, rng)
        },
        tackling: if is_gk || is_fwd {
            jitter(base - 15, 8, 20, 80, rng)
        } else {
            jitter(base, 8, 30, 97, rng)
        },
        dribbling: if is_gk {
            rng.random_range(20..50)
        } else {
            jitter(base, 8, 30, 97, rng)
        },
        defending: if is_gk {
            rng.random_range(25..55)
        } else if is_def {
            jitter(base + 3, 6, 40, 97, rng)
        } else {
            jitter(base, 8, 30, 97, rng)
        },
        positioning: jitter(base, 8, 30, 97, rng),
        vision: jitter(base, 8, 30, 97, rng),
        decisions: jitter(base, 8, 30, 97, rng),
        composure: jitter(base, 8, 30, 97, rng),
        aggression: jitter(base - 10, 10, 30, 90, rng),
        teamwork: jitter(base, 8, 40, 97, rng),
        leadership: jitter(base - 10, 12, 25, 90, rng),
        handling: if is_gk {
            jitter(base, 8, 40, 97, rng)
        } else {
            rng.random_range(10..35)
        },
        reflexes: if is_gk {
            jitter(base, 8, 40, 97, rng)
        } else {
            rng.random_range(20..50)
        },
        aerial: if is_gk {
            correlated_jitter(base, 8, (40, 97), z_height, links.aerial, rng)
        } else if is_def {
            correlated_jitter(base, 8, (40, 95), z_height, links.aerial, rng)
        } else {
            correlated_jitter(base - 10, 10, (30, 80), z_height, links.aerial, rng)
        },
        // Split out of the blends above, below.
        long_passing: 0,
        crossing: 0,
        curve: 0,
        free_kick: 0,
        long_shots: 0,
        first_touch: 0,
        heading: 0,
    };
    crate::attribute_split::split_legacy_attributes(&mut attributes, position);
    attributes
}

/// A generated player's value on the day his world opens, before he is at a
/// club: the career's opening reprices him there.
/// Price a generated player again after his ratings were changed: market value
/// and the wage that follows it, as at generation.
pub fn reprice_generated_player(player: &mut Player, opening_year: u32) {
    player.market_value = generated_market_value(player, opening_year);
    player.stage_wage(crate::valuation::market_wage(player, None));
}

pub fn generated_market_value(player: &Player, opening_year: u32) -> u64 {
    // On 1 July of the opening year; 30 when the date of birth cannot be read, as on the calendar.
    let age = i32::try_from(opening_year)
        .ok()
        .and_then(|year| crate::age::age_on_day(&player.date_of_birth, year, 7, 1))
        .unwrap_or(30);
    crate::valuation::market_value_at_age(player, None, age)
}

/// Generate a random unemployed manager (no team) using the provided name pool.
/// Used to top up the unemployed manager market when below the seasonal floor.
pub fn generate_random_unemployed_manager(
    nationality: &str,
    names_def: &NamesDefinition,
    current_year: u32,
    rng: &mut impl Rng,
) -> domain::manager::Manager {
    let id = crate::seed::uuid_from(rng);
    let (first_name, last_name) = pick_name_from_def(nationality, names_def, &mut name_rng(&id));
    let age: u32 = rng.random_range(35..65);
    let birth_year = current_year.saturating_sub(age);
    let dob = format!(
        "{:04}-{:02}-{:02}",
        birth_year,
        rng.random_range(1u32..13u32),
        rng.random_range(1u32..29u32)
    );
    let reputation = rng.random_range(200u32..=700u32);

    let mut mgr =
        domain::manager::Manager::new(id, first_name, last_name, dob, nationality.to_string());
    mgr.reputation = reputation;
    mgr.satisfaction = 50;
    mgr.fan_approval = 50;
    mgr
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names_with(code: &str, pool: NamePool) -> NamesDefinition {
        NamesDefinition {
            version: 1,
            description: String::new(),
            pools: std::collections::HashMap::from([(code.to_string(), pool)]),
        }
    }

    /// Given a pool in the old format (two unweighted lists),
    /// when names are drawn,
    /// then each is the given name then the family name, both from the lists, in that order.
    #[test]
    fn an_old_pool_still_names_people_given_name_first() {
        let names = names_with(
            "TR",
            NamePool {
                first_names: vec!["Emre".into()],
                last_names: vec!["Yilmaz".into()],
                ..NamePool::default()
            },
        );
        let drawn = pick_drawn_name("TR", &names, &mut name_rng("p-1"));
        assert_eq!(
            (drawn.full(), drawn.shirt_name()),
            ("Emre Yilmaz".to_string(), "Yilmaz".to_string())
        );
    }

    /// Given a Vietnamese pool with middle names, written family name first, shirt the middle and
    /// given names,
    /// when a name is drawn,
    /// then the full name reads family, middle, given and the shirt reads middle and given.
    #[test]
    fn a_pool_with_an_order_writes_the_name_its_way() {
        let names = names_with(
            "VN",
            NamePool {
                first_names: vec!["Hải".into()],
                last_names: vec!["Lò".into()],
                first_name_weights: vec![1],
                last_name_weights: vec![1],
                middle_names: vec!["Đức".into()],
                middle_name_weights: vec![1],
                flatten: Some(0.5),
                order: Some(crate::worldgen::online::pack::NameOrder::FamilyGiven),
                shirt: Some(crate::worldgen::online::pack::ShirtName::GivenWithMiddle),
            },
        );
        let drawn = pick_drawn_name("VN", &names, &mut name_rng("p-2"));
        assert_eq!(drawn.full(), "Lò Đức Hải");
        assert_eq!(drawn.shirt_name(), "Đức Hải");
        assert_eq!(
            pick_name_from_def("VN", &names, &mut name_rng("p-2")),
            ("Đức Hải".to_string(), "Lò".to_string())
        );
    }

    /// Given a pool whose only names make a protected person's name, and one other family name,
    /// when names are drawn for many people,
    /// then none is the protected person's.
    #[test]
    fn a_protected_name_is_drawn_again() {
        let names = names_with(
            "PT",
            NamePool {
                first_names: vec!["Bruno".into()],
                last_names: vec!["Fernandes".into(), "Prova".into()],
                ..NamePool::default()
            },
        );
        for person in 0..200 {
            let drawn = pick_drawn_name("PT", &names, &mut name_rng(&format!("p-{person}")));
            assert_eq!(drawn.full(), "Bruno Prova");
        }
    }

    /// #453: `country_to_iso` recognised 17 country names and answered `"ENG"`
    /// for everything else, so a package with `"country": "Japan"` filled 60% of
    /// every Japanese club with English players — silently.
    #[test]
    fn a_country_name_outside_the_old_hardcoded_list_resolves_to_its_own_code() {
        for (name, expected) in [
            ("Japan", "JP"),
            ("Nigeria", "NG"),
            ("Poland", "PL"),
            ("Mexico", "MX"),
            ("Serbia", "RS"),
        ] {
            assert_eq!(
                resolve_nationality_code(name).as_deref(),
                Some(expected),
                "{name} should resolve to {expected}"
            );
        }
    }

    #[test]
    fn the_country_names_the_old_list_did_know_still_resolve() {
        for (name, expected) in [
            ("England", "ENG"),
            ("Scotland", "SCO"),
            ("Republic of Ireland", "IE"),
            ("Brazil", "BR"),
            ("Sweden", "SE"),
        ] {
            assert_eq!(resolve_nationality_code(name).as_deref(), Some(expected));
        }
    }

    #[test]
    fn a_code_resolves_to_itself() {
        for code in ["JP", "BR", "ENG", "NIR", "GW"] {
            assert_eq!(resolve_nationality_code(code).as_deref(), Some(code));
        }
    }

    /// A package may declare its own country with a slug id (`scaffold` emits
    /// one for any country outside the catalog). That is unresolvable — and the
    /// answer must be "unknown", not a real, specific, wrong nationality.
    #[test]
    fn an_unresolvable_country_is_unknown_rather_than_england() {
        for unknown in ["atlantis", "Fictland", "", "   "] {
            assert_eq!(
                resolve_nationality_code(unknown),
                None,
                "{unknown:?} must not resolve to a real nation"
            );
        }
    }

    /// The length heuristic passed any 2–3 character string straight through as
    /// though it were a code — a different wrong answer for a different input.
    ///
    /// This is about the *catalog* resolver alone: `zz` names no real nation, so
    /// on its own it is unresolvable. It is emphatically not a statement that a
    /// two-letter id can never be a nationality — a package declaring `ZZ` makes
    /// it one, which `a_package_declared_country_supplies_its_own_clubs` covers.
    #[test]
    fn a_short_string_that_is_not_a_nation_code_is_not_treated_as_one() {
        assert_eq!(resolve_nationality_code("zz"), None);
        assert_eq!(resolve_nationality_code("xyz"), None);
    }

    #[test]
    fn an_unresolvable_club_country_never_produces_an_english_squad() {
        let mut rng = crate::seed::rng_from_u64(14);
        let pool = nationality_distribution();

        let drawn: Vec<String> = (0..400)
            .map(|_| pick_nationality_from_def("atlantis", pool, &mut rng))
            .collect();
        let english = drawn.iter().filter(|code| *code == "ENG").count();

        // With the old code every one of these was ENG. Drawn from the whole
        // distribution, England is one nation among 211 — a handful is fine, a
        // majority is the bug.
        assert!(
            english < drawn.len() / 4,
            "{english}/{} drawn as English for an unresolvable country",
            drawn.len()
        );
    }

    /// A package declares its own country, and its clubs must be staffed with
    /// people from it. This is the whole point of authoring a package, and the
    /// catalog cannot help: `ZZ` is in neither list, so drawing from the static
    /// distribution alone leaves a Zedlandian club with no Zedlandians at all.
    #[test]
    fn a_package_declared_country_supplies_its_own_clubs() {
        let mut rng = crate::seed::rng_from_u64(21);
        let pool = nationality_distribution_including(["ZZ"].into_iter());

        assert!(
            pool.iter().any(|code| code == "ZZ"),
            "a declared country must be drawable"
        );

        let drawn: Vec<String> = (0..400)
            .map(|_| pick_nationality_from_def("ZZ", &pool, &mut rng))
            .collect();
        let local = drawn.iter().filter(|code| *code == "ZZ").count();

        // The local share is 60%; allow generous slack for the draw. The bug
        // being guarded is zero, not a few points either way.
        assert!(
            local > drawn.len() / 3,
            "{local}/{} drawn from the club's own declared country",
            drawn.len()
        );
    }

    /// A declared id that is already a catalog code must not be appended a
    /// second time — it is in the pool at its proper weight already, and
    /// stacking would quietly promote whichever real nations a package happens
    /// to name.
    #[test]
    fn declaring_a_country_the_catalog_already_has_does_not_promote_it() {
        let baseline = nationality_distribution()
            .iter()
            .filter(|c| *c == "BR")
            .count();
        let pool = nationality_distribution_including(["BR", "br"].into_iter());
        let after = pool.iter().filter(|c| *c == "BR").count();

        assert_eq!(after, baseline, "Brazil must keep its catalog weight");
    }

    /// #452: the draw used to be over the 17 name-pool keys, so a world could
    /// only ever contain ~16 nationalities however many countries it held.
    #[test]
    fn the_nationality_distribution_spans_the_whole_catalog() {
        let pool = nationality_distribution();
        let distinct: std::collections::HashSet<&String> = pool.iter().collect();

        assert!(
            distinct.len() > 200,
            "the draw should span the catalog, got {} nationalities",
            distinct.len()
        );
        for code in ["JP", "NG", "PL", "MX", "RS"] {
            assert!(
                distinct.contains(&code.to_string()),
                "{code} should be drawable"
            );
        }
    }

    /// Weighted, not uniform — the issue is explicit that "uniform across all
    /// nations would be as wrong as today's behaviour, just differently".
    #[test]
    fn stronger_footballing_nations_are_drawn_more_often() {
        let pool = nationality_distribution();
        let count = |code: &str| pool.iter().filter(|entry| *entry == code).count();

        // Top of its region beats a lower-ranked neighbour, which beats a
        // merely-selectable nation.
        assert!(
            count("FR") > count("PL"),
            "FR {} vs PL {}",
            count("FR"),
            count("PL")
        );
        assert!(
            count("PL") > count("AD"),
            "PL {} vs AD {}",
            count("PL"),
            count("AD")
        );
        assert!(
            count("BR") > count("BO"),
            "BR {} vs BO {}",
            count("BR"),
            count("BO")
        );
    }

    /// Rank is only meaningful inside a region, so the assertions above cannot
    /// see the failure that matters most: with no region factor, the top of
    /// every region weighs the same and Costa Rica draws as often as Brazil.
    #[test]
    fn a_regions_depth_counts_not_just_rank_within_it() {
        let pool = nationality_distribution();
        let count = |code: &str| pool.iter().filter(|entry| *entry == code).count();

        // Each pair is top-of-region against top-of-region, so rank alone ties
        // them and only the region factor can separate them.
        assert!(
            count("BR") > count("CR"),
            "BR {} vs CR {}",
            count("BR"),
            count("CR")
        );
        assert!(
            count("FR") > count("CR"),
            "FR {} vs CR {}",
            count("FR"),
            count("CR")
        );
        assert!(
            count("BR") > count("NZ"),
            "BR {} vs NZ {}",
            count("BR"),
            count("NZ")
        );

        // And a mid-table European outranks the best of a shallow region.
        assert!(
            count("IT") > count("NZ"),
            "IT {} vs NZ {}",
            count("IT"),
            count("NZ")
        );

        // South America must out-supply Central America overall, which was
        // inverted while rank was the only factor.
        let region_share = |region: &str| {
            pool.iter()
                .filter(|code| nations::region_for_code(code) == region)
                .count()
        };
        assert!(
            region_share("south-america") > region_share("central-america"),
            "south-america {} vs central-america {}",
            region_share("south-america"),
            region_share("central-america")
        );
    }

    /// The pool is indexed with the RNG, so its order has to be stable or the
    /// same seed stops producing the same world.
    ///
    /// Built from scratch rather than compared against the memoised copy:
    /// `nationality_distribution()` returns the same `&'static` reference every
    /// time, so asserting it equals itself passes even if the builder iterated
    /// a `HashMap` and produced a different order on every run.
    #[test]
    fn the_distribution_is_stable_across_builds() {
        let build = || {
            let mut pool = Vec::new();
            let mut seen_in_region: std::collections::HashMap<&str, usize> =
                std::collections::HashMap::new();
            for nation in nations::NATION_CATALOG {
                let rank = seen_in_region.entry(nation.region_id).or_insert(0);
                let weight = 12usize.saturating_sub(*rank).max(2) * region_weight(nation.region_id);
                *rank += 1;
                for _ in 0..weight {
                    pool.push(nation.code.to_string());
                }
            }
            for nation in nations::ADDITIONAL_NATIONS {
                pool.push(nation.code.to_string());
            }
            pool
        };

        assert_eq!(build(), build(), "two independent builds must agree");
        assert_eq!(
            &build(),
            nationality_distribution(),
            "and must agree with the memoised pool"
        );
    }
}
