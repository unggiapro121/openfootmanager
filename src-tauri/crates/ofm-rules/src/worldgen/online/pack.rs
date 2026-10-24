//! The content an online world is grown from, as one versioned document (E3-5q F1).
//!
//! Every map is a `BTreeMap`, so a pack parsed and serialised again gives the same bytes whatever
//! order or spacing it was sent in: the server hashes that form (S-6 §3.5).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// The shipped online content, compiled in so a world can be grown with no upload (W5).
pub const BUILTIN_PACK: &str = include_str!("../../../data/online/builtin-2.json");

/// The only format this crate reads.
pub const PACK_FORMAT_VERSION: u32 = 1;

/// The four regions an online coach plays in (`domain::coach::CoachRegion`), by name.
pub const REGIONS: [&str; 4] = ["AsiaSoutheast", "AsiaEast", "Europe", "Americas"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineContentPack {
    pub format_version: u32,
    pub id: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    /// Name pools by nation code.
    pub names: BTreeMap<String, OnlineNamePool>,
    pub nations: BTreeMap<String, NationContent>,
    pub club_styles: BTreeMap<String, NamingStyleContent>,
    pub stadium_styles: BTreeMap<String, NamingStyleContent>,
    /// By region name (`REGIONS`).
    pub regions: BTreeMap<String, RegionContent>,
    pub kits: KitContent,
    pub profile: OnlineProfile,
    pub scale: Scale,
    pub limits: Limits,
    #[serde(default)]
    pub blocklist_extra: BlocklistExtra,
}

/// A culture's names. Each entry is `(name, weight)`; draws use `weight^flatten`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineNamePool {
    pub given: Vec<(String, u32)>,
    pub family: Vec<(String, u32)>,
    #[serde(default)]
    pub middle: Vec<(String, u32)>,
    /// 0 < α ≤ 1: how much the weights are flattened (1 keeps them, 0.5 takes the square root).
    pub flatten: f64,
    pub order: NameOrder,
    pub shirt: ShirtName,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NameOrder {
    /// "Bruno Fernandes".
    GivenFamily,
    /// "Nguyễn Quang Hải".
    FamilyGiven,
}

/// What is printed on the shirt (`match_name`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ShirtName {
    Family,
    Given,
    /// The middle and the given name: "Quang Hải".
    GivenWithMiddle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NationContent {
    pub cities: Vec<String>,
    /// Districts or quarters, used as further places where a nation has few cities.
    #[serde(default)]
    pub districts: Vec<String>,
    pub club_style: String,
    pub stadium_style: String,
}

/// Patterns hold `{city}` and may hold `{word}`, filled from `words`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamingStyleContent {
    pub patterns: Vec<String>,
    #[serde(default)]
    pub words: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionContent {
    /// `(nation code, integer weight)`, in the order clubs are dealt (`schedule`).
    pub nations: Vec<(String, u16)>,
    /// Share of a club's people from its own nation.
    pub local_share: f64,
    /// Share from another nation of the same region; the rest come from anywhere in the pack.
    pub foreign_from_region_share: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitContent {
    pub colors: Vec<(String, String)>,
    pub patterns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineProfile {
    pub starter: StarterProfile,
    pub staff_roles: Vec<String>,
    pub free_agents_per_club: u32,
    pub football_base_year: u32,
}

/// The squad every new online club starts with (E3-5q §4.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarterProfile {
    /// Average OVR of the best 18 players.
    pub strength: Band,
    /// Average OVR of the strongest XI by position (1-4-4-2).
    pub first_eleven: Band,
    /// OVR of the best goalkeeper.
    pub goalkeeper: Band,
    /// The squad's frame: every club gets the same rows (stratified by age and potential).
    pub template: Vec<TemplateRow>,
    pub reputation: u32,
    pub stadium_capacity: u32,
    /// How far a player's target OVR may wander from his row's (both ways), for variety.
    pub ovr_jitter: f64,
    /// Fresh draws allowed before a squad that will not settle is an error.
    pub max_attempts: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Band {
    pub target: f64,
    pub tolerance: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateRow {
    /// `Goalkeeper`, `Defender`, `Midfielder` or `Forward`.
    pub group: String,
    pub ages: (u32, u32),
    /// OVR relative to `strength.target`.
    pub ovr_offset: f64,
    pub potential: (u8, u8),
    /// A youth-academy player rather than a senior.
    #[serde(default)]
    pub academy: bool,
}

/// The world the pack must be able to fill: capacities are checked at this size (F14).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scale {
    pub clubs: u32,
    pub region_share: BTreeMap<String, f64>,
    /// Players, staff and the coach of one club.
    pub people_per_club: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    /// Largest predicted share of a nation's people sharing a full name with someone, at `scale`.
    pub max_world_name_share: f64,
    /// Valid club names a nation must have per club it is expected to hold at `scale`.
    pub club_name_capacity_factor: f64,
}

/// Additions to the crate's blocklists. A pack can only add: it cannot lift a crate entry.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlocklistExtra {
    #[serde(default)]
    pub people: Vec<String>,
    /// `(nation code, club name)`.
    #[serde(default)]
    pub clubs: Vec<(String, String)>,
    #[serde(default)]
    pub words: Vec<String>,
}

impl OnlineContentPack {
    /// Parse a pack sent as JSON. Shape only: [`super::validate_pack`] checks the content.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// The canonical bytes of the pack: what its hash is taken over.
    pub fn canonical_json(&self) -> Vec<u8> {
        // A pack is plain data (strings, numbers, vectors, ordered maps), which cannot fail to
        // serialise; an empty result would only hash to a value no real pack has.
        serde_json::to_vec(self).unwrap_or_default()
    }

    /// The shipped pack, parsed once for the process: what the desktop's random world names its
    /// clubs and stadiums from (E3-5q F11).
    pub fn builtin_shared() -> &'static Self {
        static PACK: std::sync::OnceLock<OnlineContentPack> = std::sync::OnceLock::new();
        PACK.get_or_init(Self::builtin)
    }

    /// The shipped pack.
    pub fn builtin() -> Self {
        // A panic is deliberate: the pack is compiled in, so a failure here is a build-time
        // mistake. `the_builtin_pack_is_valid` keeps that true.
        Self::from_json(BUILTIN_PACK)
            .unwrap_or_else(|error| panic!("the builtin online pack must parse: {error}"))
    }
}
