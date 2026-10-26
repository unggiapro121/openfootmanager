//! The online world, grown one club at a time (phase 3, E3-5q1).
//!
//! There is no national pyramid online: leagues of 14 are grouped by region and coach level, and
//! bots hold empty seats (ARCHITECTURE.md §2.4, §2.5). The server asks for club `ordinal` of a
//! region and gets it without knowing any other club, from a key of its own:
//! `(world seed, region, ordinal, pack version)` for who the club is, `…/gen<n>` for its squad,
//! so a squad can be drawn again (a newcomer's takeover) without touching the club's identity.
//! What a club is made of lives in a versioned [`OnlineContentPack`]; this module is the rules.

mod fold_table;
pub mod names;
pub mod naming;
pub mod pack;
pub mod schedule;
pub mod scout;
pub mod starter;
mod validate;

use std::collections::{BTreeMap, HashSet};

use domain::manager::Manager;
use domain::player::{Player, Position};
use domain::staff::{Staff, StaffRole};
use domain::team::Team;
use rand::{Rng, RngExt};
use serde::Serialize;

use self::names::{PersonName, draw_name, fold, is_protected_person};
use self::schedule::NationSchedule;
use self::starter::{SquadInputs, draw_squad};
use super::calibration::{FillerLevel, calibrate_generated_player};
use super::definitions::{NamePool, NamesDefinition, TeamColorsDef, TeamDef};
use super::generation::{
    generate_random_player_from_def, generate_random_staff_from_def,
    generate_random_unemployed_manager, nationality_distribution, senior_slot_for,
};
use crate::seed::{rng_for_seed, rng_from_key, uuid_from};

pub use pack::{BUILTIN_PACK, OnlineContentPack, REGIONS};
pub use scout::{ScoutCandidate, ScoutFocus, ScoutKey, ScoutRequest};
pub use validate::{PackIssue, predicted_name_shares, validate_pack};

/// Why a club, squad or name could not be generated. Each has a translation key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GenError {
    UnknownRegion(String),
    UnknownNation(String),
    /// A nation's valid club names are used up at `slot`.
    NameSpaceExhausted {
        nation: String,
        slot: u64,
        capacity: u64,
    },
    /// No squad within the starter bands after `attempts` fresh draws.
    SquadWillNotSettle {
        attempts: u32,
    },
    /// No allowed, unused name after every attempt of a person's name stream.
    NoFreeName {
        nation: String,
    },
}

impl GenError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownRegion(_) => "be.error.worldgen.unknownRegion",
            Self::UnknownNation(_) => "be.error.worldgen.unknownNation",
            Self::NameSpaceExhausted { .. } => "be.error.worldgen.clubNamesExhausted",
            Self::SquadWillNotSettle { .. } => "be.error.worldgen.squadWillNotSettle",
            Self::NoFreeName { .. } => "be.error.worldgen.noFreeName",
        }
    }
}

/// What a generated thing was made from: enough to make it again, or to check it (S-6 S6-12).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerationKey {
    pub region: String,
    pub ordinal: u64,
    pub generation: u32,
    pub pack_version: String,
    pub world_rules_version: String,
}

/// A club as the server stores it: the club, its squad and staff, the bot's coach, and the id
/// of the bot account that owns it.
#[derive(Debug, Clone)]
pub struct GeneratedClub {
    pub team: Team,
    pub players: Vec<Player>,
    pub staff: Vec<Staff>,
    /// The bot's head coach: its identity is the bot account's, its mastery the club's in a match.
    pub coach: Manager,
    pub bot_account_id: String,
    pub nation: String,
    /// The name slot used (`k` of the nation, or a spare slot the server passed).
    pub name_slot: u64,
    /// Squads drawn before one settled within the starter bands (1 = the first).
    pub attempts: u32,
    pub key: GenerationKey,
}

/// A club name and the place it is named after.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClubName {
    pub name: String,
    pub city: String,
    /// The folded name, which a server keeps unique (S-6 S6-11).
    pub folded: String,
}

/// Where a club's people come from (E3-5q §4.4).
pub(crate) struct NationalityDraw<'a> {
    local: String,
    others: Vec<(String, u16)>,
    global: &'a [String],
    local_share: f64,
    foreign_share: f64,
}

impl NationalityDraw<'_> {
    pub(crate) fn draw(&self, rng: &mut impl Rng) -> String {
        let roll: f64 = rng.random_range(0.0..1.0);
        if roll < self.local_share {
            return self.local.clone();
        }
        if roll < self.local_share + self.foreign_share && !self.others.is_empty() {
            let total: u32 = self
                .others
                .iter()
                .map(|(_, weight)| u32::from(*weight))
                .sum();
            let mut pick = rng.random_range(0..total.max(1));
            for (code, weight) in &self.others {
                if pick < u32::from(*weight) {
                    return code.clone();
                }
                pick -= u32::from(*weight);
            }
        }
        if self.global.is_empty() {
            return self.local.clone();
        }
        self.global[rng.random_range(0..self.global.len())].clone()
    }
}

/// Everything about a pack that every club needs, worked out once.
pub struct Generator<'a> {
    seed: u64,
    pack: &'a OnlineContentPack,
    /// The pack's pools in the shape the shared generators take (their names are replaced).
    names_def: NamesDefinition,
    schedules: BTreeMap<String, NationSchedule>,
    valid_names: BTreeMap<String, Vec<(String, String)>>,
    /// The world's nationality spread, kept to nations the pack has names for.
    global_nations: Vec<String>,
}

impl<'a> Generator<'a> {
    /// A generator for the world grown from `seed` with `pack`. Validate the pack first
    /// ([`validate_pack`]); a region without nations is an error here too.
    pub fn new(seed: u64, pack: &'a OnlineContentPack) -> Result<Self, GenError> {
        let mut schedules = BTreeMap::new();
        for (region, content) in &pack.regions {
            let schedule = NationSchedule::new(&content.nations)
                .ok_or_else(|| GenError::UnknownRegion(region.clone()))?;
            schedules.insert(region.clone(), schedule);
        }
        let valid_names = pack
            .nations
            .keys()
            .map(|code| (code.clone(), naming::valid_club_names(code, pack)))
            .collect();
        let names_def = NamesDefinition {
            version: 1,
            description: String::new(),
            pools: pack
                .names
                .iter()
                .map(|(code, pool)| {
                    let names =
                        |part: &[(String, u32)]| part.iter().map(|(n, _)| n.clone()).collect();
                    (
                        code.clone(),
                        NamePool {
                            first_names: names(&pool.given),
                            last_names: names(&pool.family),
                            ..NamePool::default()
                        },
                    )
                })
                .collect(),
        };
        let global_nations = nationality_distribution()
            .iter()
            .filter(|code| pack.names.contains_key(code.as_str()))
            .cloned()
            .collect();
        Ok(Self {
            seed,
            pack,
            names_def,
            schedules,
            valid_names,
            global_nations,
        })
    }

    pub fn pack(&self) -> &OnlineContentPack {
        self.pack
    }

    /// The nation of club `ordinal` of `region`, and the club's index among that nation's clubs.
    pub fn nation_of(&self, region: &str, ordinal: u64) -> Result<(String, u64), GenError> {
        let schedule = self
            .schedules
            .get(region)
            .ok_or_else(|| GenError::UnknownRegion(region.to_string()))?;
        let (nation, index) = schedule.nation_of(ordinal);
        Ok((nation.to_string(), index))
    }

    /// How many clubs of `nation` can be named.
    pub fn name_capacity(&self, nation: &str) -> u64 {
        self.valid_names
            .get(nation)
            .map_or(0, |names| names.len() as u64)
    }

    /// The club name in `slot` of `nation`'s permutation. Slot `k` is the nation's `k`-th club;
    /// a server that finds a name taken (a coach renamed his club to it) asks for a spare slot,
    /// counting down from `name_capacity − 1` (E3-5q §4.6).
    pub fn club_name(&self, nation: &str, slot: u64) -> Result<ClubName, GenError> {
        let names = self
            .valid_names
            .get(nation)
            .ok_or_else(|| GenError::UnknownNation(nation.to_string()))?;
        let capacity = names.len() as u64;
        if slot >= capacity {
            return Err(GenError::NameSpaceExhausted {
                nation: nation.to_string(),
                slot,
                capacity,
            });
        }
        let at = naming::keyed_permutation(
            slot,
            capacity,
            naming::name_key(self.seed, nation, &self.pack.version),
        );
        let (name, city) = &names[at as usize];
        Ok(ClubName {
            name: name.clone(),
            city: city.clone(),
            folded: fold(name),
        })
    }

    fn nationality(&self, region: &str, nation: &str) -> Result<NationalityDraw<'_>, GenError> {
        let content = self
            .pack
            .regions
            .get(region)
            .ok_or_else(|| GenError::UnknownRegion(region.to_string()))?;
        Ok(NationalityDraw {
            local: nation.to_string(),
            others: content
                .nations
                .iter()
                .filter(|(code, _)| code != nation)
                .cloned()
                .collect(),
            global: &self.global_nations,
            local_share: content.local_share,
            foreign_share: content.foreign_from_region_share,
        })
    }

    fn key(&self, region: &str, ordinal: u64, generation: u32) -> GenerationKey {
        GenerationKey {
            region: region.to_string(),
            ordinal,
            generation,
            pack_version: self.pack.version.clone(),
            world_rules_version: crate::WORLD_RULES_VERSION.to_string(),
        }
    }

    /// Club `ordinal` of `region`, with squad `generation` (0 when the club is first made),
    /// people born for `football_year`. `name_slot` overrides the club's own slot when the server
    /// found its name taken.
    pub fn club(
        &self,
        region: &str,
        ordinal: u64,
        generation: u32,
        football_year: u32,
        name_slot: Option<u64>,
    ) -> Result<GeneratedClub, GenError> {
        let (nation, index) = self.nation_of(region, ordinal)?;
        let nation_content = self
            .pack
            .nations
            .get(&nation)
            .ok_or_else(|| GenError::UnknownNation(nation.clone()))?;
        let slot = name_slot.unwrap_or(index);
        let club_name = self.club_name(&nation, slot)?;
        let mut rng = rng_for_seed(
            self.seed,
            &format!("club/{region}/{ordinal}"),
            &self.pack.version,
        );

        let starter = &self.pack.profile.starter;
        let (primary, secondary) = self
            .pack
            .kits
            .colors
            .get(rng.random_range(0..self.pack.kits.colors.len().max(1)))
            .cloned()
            .unwrap_or_else(|| ("#FFFFFF".into(), "#000000".into()));
        let kit_pattern = self
            .pack
            .kits
            .patterns
            .get(rng.random_range(0..self.pack.kits.patterns.len().max(1)))
            .cloned();
        let play_style = super::clubs::PLAY_STYLES
            [rng.random_range(0..super::clubs::PLAY_STYLES.len())]
        .to_string();
        let stadium_name = self.stadium_name(&nation, nation_content, &club_name.city, &mut rng);
        let def = TeamDef {
            id: String::new(),
            short_name: super::clubs::short_code(&club_name.name),
            name: club_name.name.clone(),
            city: club_name.city.clone(),
            country: nation.clone(),
            colors: TeamColorsDef { primary, secondary },
            play_style,
            stadium_name,
            reputation_range: Some([starter.reputation, starter.reputation]),
            finance_range: Some([0, 0]),
            logo: None,
            kit_pattern,
            founded_year: None,
            stadium_capacity: Some(starter.stadium_capacity),
        };
        let mut team = super::build_team(&def, &mut rng);
        // Money online lives in the ledger (S-10), never on the club.
        team.finance = 0;
        team.wage_budget = 0;
        team.transfer_budget = 0;

        let coach = self.coach(region, &nation, &team, football_year, &mut rng)?;
        team.manager_id = Some(coach.id.clone());
        let bot_account_id = uuid_from(&mut rng_for_seed(
            self.seed,
            &format!("bot/{region}/{ordinal}"),
            &self.pack.version,
        ));

        let (players, staff, attempts) =
            self.starter_squad(region, ordinal, generation, football_year, &mut team)?;
        Ok(GeneratedClub {
            team,
            players,
            staff,
            coach,
            bot_account_id,
            nation,
            name_slot: slot,
            attempts,
            key: self.key(region, ordinal, generation),
        })
    }

    /// A starter squad and staff for `team`, club `ordinal` of `region`, squad `generation`: the
    /// same frame and bands for every club (E3-5q §4.3). Sets the club's shape and roles for it.
    /// Returns the squad, the staff and how many draws it took.
    pub fn starter_squad(
        &self,
        region: &str,
        ordinal: u64,
        generation: u32,
        football_year: u32,
        team: &mut Team,
    ) -> Result<(Vec<Player>, Vec<Staff>, u32), GenError> {
        let nation = team.country.clone();
        let nationality = self.nationality(region, &nation)?;
        let starter = &self.pack.profile.starter;
        let inputs = SquadInputs {
            team_id: &team.id,
            football_year,
            profile: starter,
            names: &self.names_def,
        };
        let stream = |attempt: u32| {
            rng_for_seed(
                self.seed,
                &format!("club/{region}/{ordinal}/gen{generation}/{attempt}"),
                &self.pack.version,
            )
        };
        let attempts = starter.max_attempts.max(1);
        let mut found = None;
        for attempt in 0..attempts {
            if let Some(players) = draw_squad(&inputs, &nationality, &mut stream(attempt)) {
                found = Some((players, attempt + 1));
                break;
            }
        }
        let (mut players, used) = found.ok_or(GenError::SquadWillNotSettle { attempts })?;

        // The staff come from the squad's stream after the last draw, so a takeover renews them.
        let mut rng = stream(used + attempts);
        let mut staff = Vec::new();
        for role in &self.pack.profile.staff_roles {
            let Some(role) = staff_role(role) else {
                continue;
            };
            let nation = nationality.draw(&mut rng);
            staff.push(generate_random_staff_from_def(
                &team.id,
                role,
                &nation,
                football_year,
                &self.names_def,
                &mut rng,
            ));
        }

        self.name_people(&mut players, &mut staff)?;
        // An academy player's slot shares its shirt with a senior's; give him a free one.
        for at in 0..players.len() {
            if players[at].squad_role != domain::player::SquadRole::Youth {
                continue;
            }
            let others: Vec<u8> = players
                .iter()
                .enumerate()
                .filter(|(other, _)| *other != at)
                .filter_map(|(_, player)| player.jersey_number)
                .collect();
            players[at].jersey_number = super::jersey_among(others, players[at].jersey_number);
        }
        super::normalize_opening_contracts(&mut players, football_year as i32, &HashSet::new());
        let available: Vec<&Player> = players.iter().filter(|p| p.injury.is_none()).collect();
        team.formation =
            crate::ai_formation::opening_formation(&team.formation, &available, &team.play_style);
        crate::ai_roles::assign_squad_roles(team, players.iter());
        Ok((players, staff, used))
    }

    /// `count` unattached players of batch `batch`, from anywhere in the world the pack covers.
    pub fn free_agents(
        &self,
        batch: u64,
        count: u32,
        football_year: u32,
    ) -> Result<Vec<Player>, GenError> {
        let mut rng = rng_for_seed(self.seed, &format!("free/{batch}"), &self.pack.version);
        let level = FillerLevel::for_reputation(self.pack.profile.starter.reputation);
        let groups = [
            Position::Goalkeeper,
            Position::Defender,
            Position::Midfielder,
            Position::Forward,
        ];
        let mut players = Vec::with_capacity(count as usize);
        for index in 0..count {
            let region = self.draw_region(&mut rng);
            let (local, _) = self.nation_of(&region, rng.random_range(0..10_000))?;
            let nation = self.nationality(&region, &local)?.draw(&mut rng);
            let slot = senior_slot_for(&groups[index as usize % groups.len()]);
            let mut player = generate_random_player_from_def(
                "free",
                slot,
                &nation,
                football_year,
                None,
                &self.names_def,
                &mut rng,
            );
            // His own position before he is calibrated, so his overall is the one at it.
            crate::player_identity::upgrade_player_identity(&mut player, None);
            calibrate_generated_player(&mut player, level, football_year, &mut rng);
            players.push(super::as_free_agent(player));
        }
        self.name_people(&mut players, &mut [])?;
        Ok(players)
    }

    fn draw_region(&self, rng: &mut impl Rng) -> String {
        let shares: Vec<(&String, f64)> = self
            .pack
            .scale
            .region_share
            .iter()
            .filter(|(region, _)| self.schedules.contains_key(region.as_str()))
            .map(|(region, share)| (region, share.max(0.0)))
            .collect();
        let total: f64 = shares.iter().map(|(_, share)| share).sum();
        let mut pick = rng.random_range(0.0..total.max(f64::MIN_POSITIVE));
        for (region, share) in &shares {
            if pick < *share {
                return (*region).clone();
            }
            pick -= share;
        }
        shares
            .last()
            .map(|(region, _)| (*region).clone())
            .or_else(|| self.schedules.keys().next().cloned())
            .unwrap_or_default()
    }

    fn stadium_name(
        &self,
        nation: &str,
        content: &pack::NationContent,
        city: &str,
        rng: &mut impl Rng,
    ) -> String {
        naming::stadium_name(self.pack, nation, &content.stadium_style, city, rng)
    }

    fn coach(
        &self,
        region: &str,
        nation: &str,
        team: &Team,
        football_year: u32,
        rng: &mut impl Rng,
    ) -> Result<Manager, GenError> {
        let nationality = self.nationality(region, nation)?.draw(rng);
        let mut coach =
            generate_random_unemployed_manager(&nationality, &self.names_def, football_year, rng);
        let (name, _, _) = self.person_name(
            &coach.id,
            &coach.nationality,
            &mut HashSet::new(),
            &mut HashSet::new(),
        )?;
        coach.first_name = name.given_with_middle();
        coach.last_name = name.family;
        coach.team_id = Some(team.id.clone());
        crate::mastery_xp::roll_play_style_mastery(&mut coach, Some(team.play_style.clone()));
        Ok(coach)
    }

    /// Give every person of one club a name of their culture: never a protected person's, no two
    /// alike in the club, and no two shirts alike (E3-5q §4.5).
    fn name_people(&self, players: &mut [Player], staff: &mut [Staff]) -> Result<(), GenError> {
        let mut used_full = HashSet::new();
        let mut used_shirt = HashSet::new();
        for player in players.iter_mut() {
            let (_, full, shirt) = self.person_name(
                &player.id,
                &player.nationality,
                &mut used_full,
                &mut used_shirt,
            )?;
            player.full_name = full;
            player.match_name = shirt;
        }
        for member in staff.iter_mut() {
            let (name, _, _) = self.person_name(
                &member.id,
                &member.nationality,
                &mut used_full,
                &mut HashSet::new(),
            )?;
            member.first_name = name.given_with_middle();
            member.last_name = name.family;
        }
        Ok(())
    }

    /// A name for person `id` of `nationality`: `(parts, full name, shirt name)`. Drawn from the
    /// person's own name stream, attempt after attempt, until it is allowed and unused.
    fn person_name(
        &self,
        id: &str,
        nationality: &str,
        used_full: &mut HashSet<String>,
        used_shirt: &mut HashSet<String>,
    ) -> Result<(PersonName, String, String), GenError> {
        let pool = self
            .pack
            .names
            .get(nationality)
            .ok_or_else(|| GenError::NoFreeName {
                nation: nationality.to_string(),
            })?;
        let extra = &self.pack.blocklist_extra.people;
        for attempt in 0..32 {
            let mut rng = rng_from_key(&format!("online-name/{id}/{attempt}"));
            let name = draw_name(pool, &mut rng);
            let full = name.full(pool.order);
            let folded = fold(&full);
            if used_full.contains(&folded) || is_protected_person(&full, extra) {
                continue;
            }
            let Some(shirt) = name
                .shirt_forms(pool.shirt, pool.order)
                .into_iter()
                .find(|form| !used_shirt.contains(&fold(form)))
            else {
                continue;
            };
            used_full.insert(folded);
            used_shirt.insert(fold(&shirt));
            return Ok((name, full, shirt));
        }
        Err(GenError::NoFreeName {
            nation: nationality.to_string(),
        })
    }
}

fn staff_role(role: &str) -> Option<StaffRole> {
    match role {
        "AssistantManager" => Some(StaffRole::AssistantManager),
        "Coach" => Some(StaffRole::Coach),
        "Scout" => Some(StaffRole::Scout),
        "Physio" => Some(StaffRole::Physio),
        _ => None,
    }
}
