//! The world a seed grows (phase 3, E3-5c): clubs from the nation catalog, their squads, staff
//! and finances at the opening, and the free agents between clubs. Pure: the same generator state,
//! config and name pools give the same world, ids included, so the online server grows the world
//! the game would. Reading definition files, packages and the clock stays in
//! `ofm_core::generator`.

pub mod calibration;
pub mod clubs;
pub mod definitions;
pub mod generation;
pub mod physique;
pub mod youth;

use domain::player::{Player, Position};
use domain::staff::{Staff, StaffRole};
use domain::team::{Team, TeamColors};
use rand::RngExt;
use std::collections::HashSet;

use crate::stable_hash::stable_hash;
use crate::youth::YOUTH_ACADEMY_MAX_AGE as OPENING_YOUTH_MAX_AGE;
use definitions::{NamesDefinition, TeamDef};
use generation::*;

/// Weeks of committed wages a club must be able to cover after the weekly unit lock.
pub const MIN_OPENING_RUNWAY_WEEKS: i64 = 16;

/// The shirt number a player takes among `occupied` numbers: his own when it
/// is free, else the lowest free one in `1..=99`, or `None` when all are taken.
/// The rule `ofm_core::roster::resolve_jersey_for` applies to a game, for callers — the world
/// generator — that have the squad in hand before there is one.
pub fn jersey_among(occupied: impl IntoIterator<Item = u8>, current: Option<u8>) -> Option<u8> {
    let occupied: std::collections::HashSet<u8> = occupied.into_iter().collect();
    match current {
        Some(current) if !occupied.contains(&current) => Some(current),
        _ => (1u8..=99).find(|number| !occupied.contains(number)),
    }
}

pub const MAX_OPENING_EXPIRING_CONTRACTS: usize = 2;

pub const DEFAULT_TEAM_REPUTATION_RANGE: [u32; 2] = [300, 900];

pub const OPENING_YOUTH_ACADEMY_SIZE: usize = 3;

/// Players a generated club opens with: its squad slots and an academy keeper.
pub const GENERATED_CLUB_PLAYERS: usize = SQUAD_SLOTS + 1;

/// Unattached players a generated world opens with, per club, by position
/// group. Real football always has players between clubs; a club short of
/// players signs from them rather than having one made for it (see
/// `squad_floor`). Keepers included, because no club's academy produces a
/// senior keeper quickly and every club needs a second one.
pub const OPENING_FREE_AGENTS_PER_CLUB: [(Position, usize); 4] = [
    (Position::Goalkeeper, 1),
    (Position::Defender, 1),
    (Position::Midfielder, 1),
    (Position::Forward, 1),
];

pub fn standard_available_staff_roles() -> [StaffRole; 12] {
    [
        StaffRole::Coach,
        StaffRole::Scout,
        StaffRole::Physio,
        StaffRole::Coach,
        StaffRole::AssistantManager,
        StaffRole::Scout,
        StaffRole::Physio,
        StaffRole::Coach,
        StaffRole::Coach,
        StaffRole::Physio,
        StaffRole::Scout,
        StaffRole::AssistantManager,
    ]
}

pub fn target_wage_usage_percent(reputation: u32) -> i64 {
    if reputation >= 750 {
        95
    } else if reputation >= 550 {
        94
    } else {
        93
    }
}

pub fn normalized_wage_budget(weekly_wage_bill: i64, reputation: u32) -> i64 {
    let weekly_wage_bill = weekly_wage_bill.max(0);
    let usage_target = target_wage_usage_percent(reputation);
    ((weekly_wage_bill * 100) + usage_target - 1) / usage_target
}

/// Keep a newly generated squad from opening with a wave of contracts that all
/// run out the first summer.
///
/// "The first summer" is the one after `opening_year`, derived rather than written
/// down. This compared against a literal `2027-06-30`, which is right for exactly
/// one opening year: for a 1962 or a 2031 world nothing matched, so the cap did
/// nothing and however many short deals generation rolled were kept.
///
/// `authored_ids` are exempt: neither moved nor counted. The cap is there to tame a
/// *generated* squad, and a package author who writes four contracts ending the
/// first summer has said so. Only a player whose contract the author wrote belongs
/// here; one written with no contract fields is given one by generation and is capped. It has to be told who they are, because
/// `build_package_club` runs this again after swapping authored players in.
pub fn normalize_opening_contracts(
    players: &mut [Player],
    opening_year: i32,
    authored_ids: &HashSet<String>,
) {
    let first_summer = format!("{}-06-30", opening_year + 1);
    let second_summer = format!("{}-06-30", opening_year + 2);

    let mut expiring_indices: Vec<usize> = players
        .iter()
        .enumerate()
        .filter(|(_, player)| !authored_ids.contains(&player.id))
        .filter(|(_, player)| player.contract_end() == Some(first_summer.as_str()))
        .map(|(index, _)| index)
        .collect();

    expiring_indices.sort_by_key(|index| players[*index].date_of_birth.clone());

    for index in expiring_indices
        .into_iter()
        .skip(MAX_OPENING_EXPIRING_CONTRACTS)
    {
        players[index].stage_contract_end(Some(second_summer.clone()));
    }
}

/// Earliest year a world may open in.
///
/// `baseYear` is author-supplied with no lower bound, and birth years are
/// derived by subtracting an age from the opening year, so an absurdly small
/// value underflows. Mirrors the career floor in `commands/game.rs`.
pub const MIN_OPENING_YEAR: u32 = 1900;

/// Latest year a world may open in.
///
/// `baseYear` is an unbounded `i32` in the manifest, and the year is formatted
/// straight into contract and birth dates. A wild value does not crash, but it
/// produces dates no parser accepts, which then degrade silently into
/// unparseable ages — better to pin the era into a range dates can represent.
///
/// Removable once either half of that stops being true: `baseYear` validated at
/// manifest load, so an out-of-range era is refused with a message instead of
/// silently clamped here; or dates carried as a real year type rather than a
/// four-character prefix, so the formatting has no range to fall out of.
pub const MAX_OPENING_YEAR: u32 = 2999;

/// Age on 1 July of `opening_year`, by month and day (not day-of-year, which is off by one
/// for birthdays after 28 February across a leap boundary). `None` for an unparseable date.
pub fn opening_player_age(date_of_birth: &str, opening_year: i32) -> Option<i32> {
    // On 1 July of the opening year, by the one age rule (`ofm_rules::age`).
    crate::age::age_on_day(date_of_birth, opening_year, 7, 1)
}

pub fn is_opening_youth_candidate(player: &Player, opening_year: i32) -> bool {
    use domain::player::Position;

    player.position != Position::Goalkeeper
        && opening_player_age(&player.date_of_birth, opening_year)
            .is_some_and(|age| age <= OPENING_YOUTH_MAX_AGE)
}

pub fn sort_opening_youth_indices(players: &[Player], indices: &mut [usize]) {
    indices.sort_by(|left, right| {
        players[*right]
            .date_of_birth
            .cmp(&players[*left].date_of_birth)
            .then_with(|| players[*left].ovr.cmp(&players[*right].ovr))
    });
}

pub fn apply_opening_youth_assignments(
    players: &mut [Player],
    candidate_indices: Vec<usize>,
) -> usize {
    use domain::player::SquadRole;

    let mut assigned = 0;

    for index in candidate_indices
        .into_iter()
        .take(OPENING_YOUTH_ACADEMY_SIZE)
    {
        if players[index].squad_role != SquadRole::Youth {
            players[index].squad_role = SquadRole::Youth;
            assigned += 1;
        }
    }

    assigned
}

/// Move the club's youngest generated prospects into its academy.
///
/// `authored_ids` are never candidates. A package author decides who is a
/// prospect by writing `youth: true`; a player they left in the senior squad is
/// a first-teamer, and demoting him would undo the authored squad that
/// `trim_backfill_players` exists to keep (#349). Generated backfill still
/// seeds the academy, so a club authored entirely of seniors keeps one.
pub fn seed_opening_youth_academy(
    players: &mut [Player],
    opening_year: i32,
    authored_ids: &HashSet<String>,
) {
    let mut eligible_indices: Vec<usize> = players
        .iter()
        .enumerate()
        .filter(|(_, player)| !authored_ids.contains(&player.id))
        .filter(|(_, player)| is_opening_youth_candidate(player, opening_year))
        .map(|(index, _)| index)
        .collect();

    sort_opening_youth_indices(players, &mut eligible_indices);
    apply_opening_youth_assignments(players, eligible_indices);
}

/// Generate a senior free-agent player for a national squad. `squad_slot`
/// follows the standard squad layout (GK 0-1, DEF 2-8, MID 9-15, FWD 16-21)
/// and drives the position; the player belongs to no club and holds no
/// contract, so clubs may sign them afterwards.
///
/// `pool_ovrs` are the OVRs of the nation's players already in the world. The
/// player is drawn at the level of their lower half when there are enough of
/// them, and at the nation's ranking tier otherwise, so filling a minnow's pool
/// does not hand it, or the clubs that sign from it, a squad of regulars.
pub fn generate_national_team_player(
    nationality: &str,
    squad_slot: usize,
    opening_year: u32,
    pool_ovrs: &[u8],
    rng: &mut impl rand::Rng,
) -> Player {
    let names_def = definitions::embedded_names();
    let nationality = generation::canonicalize_generated_nationality(nationality);
    // Avoid the youth-reserved slots so the player generates at a senior age.
    let slot = senior_slot(squad_slot % SQUAD_SLOTS);
    let mut player = generate_random_player_from_def(
        "national-pool",
        slot,
        &nationality,
        opening_year,
        None,
        &names_def,
        rng,
    );
    calibration::calibrate_generated_player(
        &mut player,
        calibration::FillerLevel::for_nation(&nationality, pool_ovrs),
        opening_year,
        rng,
    );
    as_free_agent(player)
}

/// A generated player belonging to nobody: no club, no contract, no wage, not
/// on any list.
pub fn as_free_agent(mut player: Player) -> Player {
    player.team_id = None;
    // Both dates, not just the end: this player is generated from a club
    // template and then unattached, so leaving a start behind would describe an
    // agreement with no employer and no expiry.
    player.stage_contract_start(None);
    player.stage_contract_end(None);
    player.stage_wage(0);
    player.transfer_listed = false;
    player.loan_listed = false;
    player
}

/// `authored_contract_ids` are the authored players whose contract the author
/// wrote, so the contract cap leaves them alone; `authored_squad_ids` are every
/// authored player, none of whom the opening academy may take. They differ: an
/// author who writes a squad but no contracts still wrote who is a first-teamer.
pub fn normalize_generated_team(
    team: &mut Team,
    players: &mut [Player],
    opening_year: i32,
    authored_contract_ids: &HashSet<String>,
    authored_squad_ids: &HashSet<String>,
) {
    seed_opening_youth_academy(players, opening_year, authored_squad_ids);
    normalize_opening_contracts(players, opening_year, authored_contract_ids);
    // Last, and here rather than in `build_club`: the package path calls this
    // again after swapping generated players for authored ones, and a role —
    // or a shape (GĐ5 P5.1) — belongs to the squad that finished rather than
    // the one that was built. The player's own club gets one too, as the shape
    // it opens in; from then on the player chooses.
    let available: Vec<&Player> = players
        .iter()
        .filter(|player| player.injury.is_none())
        .collect();
    team.formation =
        crate::ai_formation::opening_formation(&team.formation, &available, &team.play_style);
    crate::ai_roles::assign_squad_roles(team, players.iter());

    let weekly_wage_bill: i64 = players.iter().map(|player| player.wage() as i64).sum();

    team.wage_budget = normalized_wage_budget(weekly_wage_bill, team.reputation);
    floor_opening_cash(team, weekly_wage_bill);
}

pub fn floor_opening_cash(team: &mut Team, weekly_wage_bill: i64) {
    team.finance = team.finance.max(
        weekly_wage_bill
            .max(0)
            .saturating_mul(MIN_OPENING_RUNWAY_WEEKS),
    );
}

/// The country a club's *people* should be drawn from.
///
/// `country` is where the club is; `football_nation` is the identity it plays
/// under, and the two differ (a Welsh club in the English pyramid). Anyone
/// generated for the club follows the football identity when it is set.
///
/// Named without `staff` because players use it too — the youth intake drew
/// straight from `team.country` and quietly disagreed with every other path.
pub fn team_local_nationality(team: &Team) -> &str {
    if team.football_nation.is_empty() {
        team.country.as_str()
    } else {
        team.football_nation.as_str()
    }
}

pub fn create_staff_generator_context() -> (definitions::NamesDefinition, Vec<String>) {
    let names_def = definitions::embedded_names();
    (names_def, generation::nationality_distribution().clone())
}

/// A manager for a club that has none, invented rather than taken from its staff.
///
/// Clubs used to get their manager by copying the identity of their assistant
/// manager, which left one person holding two jobs and — where that assistant
/// was hand-authored — put a package author's work in a role they never wrote.
/// A club without a manager now gets a new person, and its staff are left alone.
///
/// The context is cached because this is called one club at a time, unlike the
/// bulk staff generators below which build it once and loop.
///
/// `manager_id` is what the caller is about to give the manager, and seeds them.
/// It is per-appointment rather than per-club, so a club that goes through two
/// managers gets two different people rather than the same person twice.
pub fn generated_manager_for(
    team: &Team,
    manager_id: &str,
    opening_year: u32,
) -> domain::manager::Manager {
    static CONTEXT: std::sync::OnceLock<(definitions::NamesDefinition, Vec<String>)> =
        std::sync::OnceLock::new();
    let (names_def, country_codes) = CONTEXT.get_or_init(create_staff_generator_context);

    // A private, seeded RNG rather than `rand::rng()`. Two reasons, and the
    // second is the one that bites: drawing from the thread RNG here would shift
    // the stream for everything that follows on the same thread — including the
    // matches `generate_past_world_history` simulates — so seeding a manager
    // would silently change the world's history. Keying on the appointment also
    // makes the same world produce the same managers twice running.
    let mut rng = crate::seed::rng_from_u64(stable_hash(manager_id.as_bytes(), 0));

    let nationality =
        pick_nationality_from_def(team_local_nationality(team), country_codes, &mut rng);
    generate_random_unemployed_manager(&nationality, names_def, opening_year, &mut rng)
}

pub fn generate_standard_available_staff_for_teams(
    teams: &[Team],
    opening_year: u32,
    rng: &mut impl rand::Rng,
) -> Vec<Staff> {
    let (names_def, country_codes) = create_staff_generator_context();
    let fallback_seed = teams
        .first()
        .map(team_local_nationality)
        .unwrap_or("England");

    standard_available_staff_roles()
        .into_iter()
        .map(|role| {
            let nationality = if country_codes.is_empty() {
                generation::canonicalize_generated_nationality(fallback_seed)
            } else {
                let seed_country = teams
                    .get(rng.random_range(0..teams.len().max(1)))
                    .map(team_local_nationality)
                    .unwrap_or(fallback_seed);
                pick_nationality_from_def(seed_country, &country_codes, rng)
            };
            generate_random_staff_unattached_from_def(
                role,
                &nationality,
                opening_year,
                &names_def,
                rng,
            )
        })
        .collect()
}

pub fn available_staff_count(staff: &[Staff]) -> usize {
    staff
        .iter()
        .filter(|staff_member| staff_member.team_id.is_none())
        .count()
}

pub fn replace_available_staff_market(
    staff: &mut Vec<Staff>,
    teams: &[Team],
    opening_year: u32,
    rng: &mut impl rand::Rng,
) {
    staff.retain(|staff_member| staff_member.team_id.is_some());
    staff.extend(generate_standard_available_staff_for_teams(
        teams,
        opening_year,
        rng,
    ));
}

pub fn replenish_available_staff_market(
    staff: &mut Vec<Staff>,
    teams: &[Team],
    opening_year: u32,
    rng: &mut impl rand::Rng,
) -> bool {
    if available_staff_count(staff) > 0 {
        return false;
    }

    replace_available_staff_market(staff, teams, opening_year, rng);
    true
}

/// Build a club (without players) from a definition. Uses the definition's
/// stable `id` when set (world packages); otherwise a fresh UUID.
pub fn build_team(tdef: &TeamDef, rng: &mut impl rand::Rng) -> domain::team::Team {
    let team_id = if tdef.id.is_empty() {
        crate::seed::uuid_from(rng)
    } else {
        tdef.id.clone()
    };
    let short_name = if tdef.short_name.is_empty() {
        tdef.name
            .split_whitespace()
            .filter_map(|w| w.chars().next())
            .collect::<String>()
            .to_uppercase()
            .chars()
            .take(3)
            .collect()
    } else {
        tdef.short_name.clone()
    };
    let stadium = if tdef.stadium_name.is_empty() {
        format!("{} Arena", tdef.city)
    } else {
        tdef.stadium_name.clone()
    };

    let rep_range = tdef
        .reputation_range
        .unwrap_or(DEFAULT_TEAM_REPUTATION_RANGE);
    let fin_range = tdef.finance_range.unwrap_or([500_000, 10_000_000]);

    let mut team = domain::team::Team::new(
        team_id,
        tdef.name.clone(),
        short_name,
        tdef.country.clone(),
        tdef.city.clone(),
        stadium,
        tdef.stadium_capacity
            .unwrap_or_else(|| rng.random_range(10000..80000)),
    );
    // Inclusive *and* ordered, because `rand` panics on any empty range and that
    // panic is uniquely expensive here: `build_team` runs inside `start_new_game`,
    // an async Tauri command, so unwinding leaves the IPC call unanswered and the
    // player watches a spinner forever with no error (#441).
    //
    // Inclusive fixes `[640, 640]`, a club pinned to one value, and makes the
    // authored upper bound reachable. Ordering the bounds is what makes the panic
    // unreachable rather than merely unlikely: package validation does reject
    // `min > max`, but `build_team` also serves the procedural generator and
    // `default_teams` definition files, which nothing validates. Two comparisons
    // are a cheap price for a failure mode with no diagnostic.
    let (fin_lo, fin_hi) = (
        fin_range[0].min(fin_range[1]),
        fin_range[0].max(fin_range[1]),
    );
    let (rep_lo, rep_hi) = (
        rep_range[0].min(rep_range[1]),
        rep_range[0].max(rep_range[1]),
    );
    team.finance = rng.random_range(fin_lo..=fin_hi);
    team.reputation = rng.random_range(rep_lo..=rep_hi);
    team.wage_budget = (team.finance as f64 * 0.06) as i64;
    team.transfer_budget = (team.finance as f64 * 0.15) as i64;
    team.founded_year = tdef.founded_year.unwrap_or(rng.random_range(1880..1960));
    team.colors = TeamColors {
        primary: tdef.colors.primary.clone(),
        secondary: tdef.colors.secondary.clone(),
    };
    team.play_style = play_style_from_str(&tdef.play_style);
    // A club's tactics are its style expressed in the nine dials the engine
    // actually reads. Set here rather than left at the neutral default, which is
    // where every club in every save had been sitting: see `ai_tactics`.
    team.tactics_phase = crate::ai_tactics::blueprint_for(&team.play_style);
    team.media.logo = tdef.logo.clone();
    if let Some(ref pattern_str) = tdef.kit_pattern
        && let Ok(pattern) = pattern_str.parse()
    {
        team.kit_pattern = pattern;
    }
    team
}

/// Build a club with a full generated squad (22 players) and staff, normalised
/// to a sensible opening wage budget. Shared by the random world and world
/// packages.
pub fn build_club(
    tdef: &TeamDef,
    country_codes: &[String],
    opening_year: u32,
    names_def: &NamesDefinition,
    rng: &mut impl rand::Rng,
) -> (domain::team::Team, Vec<Player>, Vec<Staff>) {
    let mut team = build_team(tdef, rng);
    let team_id = team.id.clone();
    let level = calibration::FillerLevel::for_reputation(team.reputation);

    let mut team_players = Vec::with_capacity(GENERATED_CLUB_PLAYERS);
    for slot in 0..SQUAD_SLOTS {
        let nationality = pick_nationality_from_def(&tdef.country, country_codes, rng);
        let mut player = generate_random_player_from_def(
            &team_id,
            slot,
            &nationality,
            opening_year,
            None,
            names_def,
            rng,
        );
        calibration::calibrate_generated_player(&mut player, level, opening_year, rng);
        if rng.random_range(0..100) < 12 {
            player.transfer_listed = true;
        } else if rng.random_range(0..100) < 8 {
            player.loan_listed = true;
        }
        team_players.push(player);
    }

    let mut team_staff = Vec::with_capacity(4);
    for role in [
        StaffRole::AssistantManager,
        StaffRole::Coach,
        StaffRole::Scout,
        StaffRole::Physio,
    ] {
        let nationality = pick_nationality_from_def(&tdef.country, country_codes, rng);
        team_staff.push(generate_random_staff_from_def(
            &team_id,
            role,
            &nationality,
            opening_year,
            names_def,
            rng,
        ));
    }

    // An academy keeper on top of the two senior ones. The opening academy
    // never takes a keeper from the senior squad — that would leave the club
    // below the squad floor — so without this one a club's academy could never
    // replace a keeper. Added before the club is normalised, so its wage
    // budget is set with him in the squad.
    let nationality = pick_nationality_from_def(&tdef.country, country_codes, rng);
    let youth_keeper_slot = youth_slots_for_target(Some(Position::Goalkeeper))[0];
    let mut academy_keeper = generate_random_player_from_def(
        &team_id,
        youth_keeper_slot,
        &nationality,
        opening_year,
        None,
        names_def,
        rng,
    );
    calibration::calibrate_generated_player(&mut academy_keeper, level, opening_year, rng);
    academy_keeper.squad_role = domain::player::SquadRole::Youth;
    academy_keeper.jersey_number = jersey_among(
        team_players
            .iter()
            .filter_map(|player| player.jersey_number),
        None,
    );
    team_players.push(academy_keeper);

    // A generated club has no authored players; `build_package_club` names them.
    normalize_generated_team(
        &mut team,
        &mut team_players,
        opening_year as i32,
        &HashSet::new(),
        &HashSet::new(),
    );
    (team, team_players, team_staff)
}

/// The free agents a generated world opens with: [`OPENING_FREE_AGENTS_PER_CLUB`]
/// for each club, senior-aged, drawn from `rng` so a seeded world opens with the
/// same pool. Each is drawn at the level of a club picked from
/// `club_reputations`, so the pool is spread across the world's levels, from the
/// lower half of each, as players between clubs are.
pub fn generate_opening_free_agents(
    club_reputations: &[u32],
    country_codes: &[String],
    opening_year: u32,
    names_def: &NamesDefinition,
    rng: &mut impl rand::Rng,
) -> Vec<Player> {
    let mut free_agents = Vec::new();
    for (group, per_club) in OPENING_FREE_AGENTS_PER_CLUB {
        for _ in 0..club_reputations.len() * per_club {
            let nationality = &country_codes[rng.random_range(0..country_codes.len())];
            let mut player = generate_random_player_from_def(
                "",
                senior_slot_for(&group),
                nationality,
                opening_year,
                None,
                names_def,
                rng,
            );
            let reputation = club_reputations[rng.random_range(0..club_reputations.len())];
            calibration::calibrate_generated_player(
                &mut player,
                calibration::FillerLevel::for_reputation(reputation),
                opening_year,
                rng,
            );
            let mut agent = as_free_agent(player);
            agent.jersey_number = None;
            free_agents.push(agent);
        }
    }
    free_agents
}

/// Core world generation from an explicit rng and config.
/// Generate a world: its clubs, their squads and staff, the opening free agents and the free
/// staff market, all drawn from `rng`. The same generator state, config and name pools give the
/// same world, ids included.
pub fn generate_world(
    mut rng: impl rand::Rng,
    config: &clubs::WorldGenConfig,
    names_def: &NamesDefinition,
) -> (Vec<domain::team::Team>, Vec<Player>, Vec<Staff>) {
    let opening_year = config
        .opening_year
        .clamp(MIN_OPENING_YEAR, MAX_OPENING_YEAR);
    let mut teams_out = Vec::new();
    let mut players = Vec::new();
    let mut staff = Vec::new();

    // Clubs are always generated from `config`, which is itself built from the
    // nations definition. A curated club list is hand-authored content and
    // belongs in a `.ofm` package: as a definition file it *replaced*
    // procedural generation outright, so shipping one would silently cut a
    // ~440-club world down to whatever the file happened to hold.
    let team_defs: Vec<TeamDef> = clubs::generate_club_defs(config, &mut rng);

    let country_codes = generation::nationality_distribution();

    for tdef in &team_defs {
        let (team, team_players, team_staff) =
            build_club(tdef, country_codes, opening_year, names_def, &mut rng);
        players.extend(team_players);
        staff.extend(team_staff);
        teams_out.push(team);
    }

    let club_reputations: Vec<u32> = teams_out.iter().map(|team| team.reputation).collect();
    players.extend(generate_opening_free_agents(
        &club_reputations,
        country_codes,
        opening_year,
        names_def,
        &mut rng,
    ));

    // Generate free-agent staff
    for role in standard_available_staff_roles() {
        let nat = &country_codes[rng.random_range(0..country_codes.len())];
        let s =
            generate_random_staff_unattached_from_def(role, nat, opening_year, names_def, &mut rng);
        staff.push(s);
    }

    (teams_out, players, staff)
}
