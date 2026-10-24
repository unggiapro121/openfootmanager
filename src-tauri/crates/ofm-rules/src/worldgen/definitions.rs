//! The inputs a world is grown from: name pools, the per-nation club seed and a club's
//! definition (phase 3, E3-5c). The game reads them from files a player may override
//! (`ofm_core::generator::DefinitionSources`); the shipped copies are compiled in here, so a
//! world can be generated with no file at all.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

use domain::team::{MatchRoles, PlayerRole, TacticsPhaseSettings};

/// The definition files the engine ships, compiled in.
///
/// These are the *same files* that are bundled beside the installed game — one
/// copy in the repository, delivered two ways. That is what makes drift
/// impossible: there is no second, hand-maintained Rust table to fall out of
/// step with the JSON, which is exactly what #454 was about.
pub const EMBEDDED_NAMES: &str = include_str!("../../data/default_names.json");
pub const EMBEDDED_NATIONS: &str = include_str!("../../data/default_nations.json");

/// The shipped name pools.
pub fn embedded_names() -> NamesDefinition {
    parse_embedded(EMBEDDED_NAMES, "default_names")
}

/// The shipped per-nation club seed.
pub fn embedded_nations() -> NationsDefinition {
    parse_embedded(EMBEDDED_NATIONS, "default_nations")
}

fn parse_embedded<T: serde::de::DeserializeOwned>(json: &str, stem: &str) -> T {
    // A panic is deliberate: the file is compiled in, so a failure here is a build-time mistake,
    // not a runtime condition. `the_embedded_definitions_parse` keeps that true.
    serde_json::from_str(json)
        .unwrap_or_else(|e| panic!("built-in {stem} definition must parse: {e}"))
}

/// Name pools definition file format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NamesDefinition {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub description: String,
    /// Keyed by ISO 3166-1 alpha-2 country code.
    pub pools: HashMap<String, NamePool>,
}

/// A nation's names. The two lists are all an old file holds, drawn evenly. Since E3-5q2 a pool
/// may also weigh each name (`*_weights`, same length as the list, else ignored), carry middle
/// names, flatten its weights (`flatten`, 0–1, as the online pack's), and say in which order a
/// full name is written and what a shirt reads (E3-5q F5, F11).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NamePool {
    pub first_names: Vec<String>,
    pub last_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub first_name_weights: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub last_name_weights: Vec<u32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub middle_names: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub middle_name_weights: Vec<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flatten: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<super::online::pack::NameOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shirt: Option<super::online::pack::ShirtName>,
}

/// Per-nation inputs to procedural club generation.
///
/// This is the seed the generator grows a world from — which nations exist,
/// what their cities are called, how deep their league pyramid runs, and how
/// strong they are. It is deliberately *not* a list of clubs: a curated club
/// list is hand-authored content and belongs in a `.ofm` package, where it
/// stacks and merges. Adding a nation here used to mean editing Rust and
/// recompiling.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NationsDefinition {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub description: String,
    /// Clubs generated per division. 20 unless a file says otherwise.
    #[serde(default = "default_clubs_per_division")]
    pub clubs_per_division: usize,
    /// Kit colour pairs drawn from at random.
    #[serde(default)]
    pub color_palette: Vec<ColorPairDef>,
    /// City names used for clubs in a country with no curated pool of its own.
    #[serde(default)]
    pub generic_cities: Vec<String>,
    pub nations: Vec<super::clubs::NationGen>,
}

fn default_clubs_per_division() -> usize {
    20
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ColorPairDef {
    pub primary: String,
    pub secondary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamDef {
    /// Stable id used to reference this club (e.g. from player or competition
    /// files). Empty for procedurally generated clubs, which get a UUID.
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(default, alias = "short_name")]
    pub short_name: String,
    pub city: String,
    /// ISO 3166-1 alpha-2 / football country code.
    pub country: String,
    pub colors: TeamColorsDef,
    #[serde(default = "default_play_style", alias = "play_style")]
    pub play_style: String,
    #[serde(default, alias = "stadium_name")]
    pub stadium_name: String,
    #[serde(default, alias = "reputation_range")]
    pub reputation_range: Option<[u32; 2]>,
    #[serde(default, alias = "finance_range")]
    pub finance_range: Option<[i64; 2]>,
    /// Optional path to a logo/crest image, relative to the package root.
    /// Populated with an absolute path after the package is extracted.
    #[serde(default)]
    pub logo: Option<String>,
    /// Kit jersey pattern (Solid, Stripes, Hoops, HalfAndHalf, Diagonal).
    #[serde(default, alias = "kit_pattern")]
    pub kit_pattern: Option<String>,
    /// Year the team was founded. If not provided, will be randomly generated.
    #[serde(default)]
    pub founded_year: Option<u32>,
    /// Seats in the home ground. Caps matchday attendance and so gate income;
    /// drawn between 10,000 and 80,000 when omitted, as before the field existed.
    #[serde(default, alias = "stadium_capacity")]
    pub stadium_capacity: Option<u32>,
    /// The tactics and default line-up the club opens with (`ofm_core::generator::team_tactics`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tactics: Option<TeamTacticsDef>,
}

/// A club's authored tactics and default line-up: `tactics` on a package team. What a world
/// opens with, not a standing order; anything left out is chosen as for a club with none.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TeamTacticsDef {
    /// One of the shapes the game offers. Absent: the club picks its own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formation: Option<String>,
    /// Slot-aligned with `formation`: entry `i` plays slot `i`, the same rule
    /// as a team's starting eleven everywhere else. Only used when it fills
    /// every slot of an authored formation; otherwise the game picks the side.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub starting_xi: Vec<String>,
    /// Player id → role. A `BTreeMap` so a save writes them in a stable order.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub player_roles: BTreeMap<String, PlayerRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_roles: Option<MatchRoles>,
    /// The phase settings. Absent: the play style's own blueprint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase: Option<TacticsPhaseSettings>,
}

fn default_play_style() -> String {
    "Balanced".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeamColorsDef {
    pub primary: String,
    pub secondary: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Given the definitions compiled into the crate,
    /// when they are parsed,
    /// then both parse and hold something to generate from.
    #[test]
    fn the_embedded_definitions_parse() {
        assert!(!embedded_names().pools.is_empty());
        assert!(!embedded_nations().nations.is_empty());
    }
}
