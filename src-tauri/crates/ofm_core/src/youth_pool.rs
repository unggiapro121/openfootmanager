//! The season's youth pool: the unattached youngsters of every nation, drawn
//! once when the season opens and shared by the whole world.
//!
//! AI clubs sign from it every Monday, each choosing with its own scout; the
//! player's scouts search what is left. Whoever is still unsigned when the
//! season ends goes with it. The youngsters live here rather than in
//! `game.players`, so nothing that lists free agents can reach them — the only
//! way to learn of one is a scout's report.

use crate::game::Game;
use crate::squad_floor::{MIN_PLAYERS_PER_GROUP, group_index};
use chrono::{Datelike, NaiveDate};
use domain::player::{Player, Position, SquadRole};
use rand::RngExt;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// One season's pool.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct YouthPool {
    /// The day the pool was drawn.
    pub generated_on: String,
    /// When the pool's season ends if the season's own end date is not known
    /// yet — the pool is drawn before the next season's fixtures are.
    pub ends_on: String,
    /// The youngsters still unsigned, by football nation.
    #[serde(default)]
    pub nations: BTreeMap<String, Vec<Player>>,
    /// The position groups each AI club still means to sign this season, in the
    /// order it fills them.
    #[serde(default)]
    pub demand: BTreeMap<String, Vec<Position>>,
}

/// How many youngsters a nation's pool holds for each one its AI clubs need:
/// the surplus is what the player competes with them for.
const SURPLUS: f64 = 1.5;

/// The ages a pool youngster can be.
const POOL_AGES: std::ops::RangeInclusive<u32> = 15..=21;

/// A pool's season length when the season's own end is not known.
const FALLBACK_SEASON_DAYS: i64 = 364;

/// The nation whose pool a club draws on: its football nation.
pub fn nation_of(team: &domain::team::Team) -> &str {
    crate::generator::team_local_nationality(team)
}

/// Draw the season's pool on `date`, replacing any pool there was.
///
/// Each AI club's demand is what the annual intake rule says its academy
/// lacks; each nation's pool holds [`SURPLUS`] times what its AI clubs need in
/// every position group, and never fewer than one, so the player's scouts
/// always have someone to find.
pub fn open_season(game: &mut Game, date: NaiveDate) {
    let date_text = date.format("%Y-%m-%d").to_string();
    let user_team = game.manager.team_id.clone();
    let demand: BTreeMap<String, Vec<Position>> = game
        .teams
        .iter()
        .filter(|team| Some(&team.id) != user_team.as_ref())
        .map(|team| {
            let academy = game.players.iter().filter(|player| {
                player.squad_role == SquadRole::Youth
                    && player.contract_club_id() == Some(team.id.as_str())
            });
            (
                team.id.clone(),
                crate::youth_intake::plan_for(academy).groups,
            )
        })
        .collect();

    // The first club of each nation, by id, is the one the generator draws for.
    let mut templates: BTreeMap<String, usize> = BTreeMap::new();
    let mut need: BTreeMap<String, [usize; 4]> = BTreeMap::new();
    let mut by_id: Vec<usize> = (0..game.teams.len()).collect();
    by_id.sort_by(|a, b| game.teams[*a].id.cmp(&game.teams[*b].id));
    for index in by_id {
        let team = &game.teams[index];
        let nation = nation_of(team).to_string();
        templates.entry(nation.clone()).or_insert(index);
        let counts = need.entry(nation).or_insert([0; 4]);
        for group in demand.get(&team.id).into_iter().flatten() {
            counts[group_index(group)] += 1;
        }
    }

    let nations = templates
        .iter()
        .map(|(nation, &template)| {
            let mut rng = game.rng_for(&format!("youth-pool/{nation}"), &date_text);
            let team = &game.teams[template];
            let mut players = Vec::new();
            for (group_slot, (group, _)) in MIN_PLAYERS_PER_GROUP.iter().enumerate() {
                let wanted = (need[nation][group_slot] as f64 * SURPLUS).ceil() as usize;
                for _ in 0..wanted.max(1) {
                    let age = rng.random_range(POOL_AGES);
                    let mut player = crate::generator::generate_youth_pool_member(
                        team,
                        group,
                        nation,
                        age,
                        date.year() as u32,
                        &mut rng,
                    );
                    // Named by nation, day and draw rather than a random id, so a
                    // replayed season signs the same youngsters under the same ids.
                    player.id = format!("youth-pool-{nation}-{date_text}-{}", players.len());
                    players.push(player);
                }
            }
            (nation.clone(), players)
        })
        .collect();

    let ends_on = game
        .season_context
        .season_end
        .as_deref()
        .and_then(|end| NaiveDate::parse_from_str(end, "%Y-%m-%d").ok())
        .filter(|end| *end > date)
        .unwrap_or(date + chrono::Duration::days(FALLBACK_SEASON_DAYS));
    game.youth_pool = Some(YouthPool {
        generated_on: date_text,
        ends_on: ends_on.format("%Y-%m-%d").to_string(),
        nations,
        demand,
    });
}

/// Close the season's pool and open the next one, on the season's end `date`:
/// whoever is still unsigned leaves the game.
pub fn roll_over(game: &mut Game, date: NaiveDate) {
    game.youth_pool = None;
    open_season(game, date);
}

/// Draw a pool now if the career has none yet.
pub fn ensure_pool(game: &mut Game) {
    if game.youth_pool.is_none() {
        let today = game.clock.current_date.date_naive();
        open_season(game, today);
    }
}

/// The Mondays from `today` to `end`, `today` included, and never fewer than one.
fn mondays_left(today: NaiveDate, end: NaiveDate) -> u32 {
    if end < today {
        return 1;
    }
    ((end - today).num_days() / 7 + 1) as u32
}

/// The day the pool's season ends: the season's own end when it lies ahead,
/// the pool's fallback otherwise.
fn season_end(game: &Game, pool: &YouthPool, today: NaiveDate) -> NaiveDate {
    let parse = |text: &str| NaiveDate::parse_from_str(text, "%Y-%m-%d").ok();
    game.season_context
        .season_end
        .as_deref()
        .and_then(parse)
        .filter(|end| *end >= today)
        .or_else(|| parse(&pool.ends_on))
        .unwrap_or(today)
}

/// The judging ability, judging potential and scouting facility a club chooses
/// with: its best scout by judging ability, or nobody's eye at all.
fn club_eye(game: &Game, team_index: usize) -> (u8, u8, u8) {
    let team = &game.teams[team_index];
    let (ability, potential) = game
        .staff
        .iter()
        .filter(|staff| {
            staff.role == domain::staff::StaffRole::Scout
                && staff.team_id.as_deref() == Some(team.id.as_str())
        })
        .max_by_key(|staff| staff.attributes.judging_ability)
        .map(|staff| {
            (
                staff.attributes.judging_ability,
                staff.attributes.judging_potential,
            )
        })
        .unwrap_or((0, 0));
    (ability, potential, team.facilities.scouting)
}

/// The youngster of `nation`'s pool the club at `team_index` would sign for the
/// first of its `wanted` groups that the pool still has: its scout looks at a
/// few at random and picks the best on what he sees.
fn choose(
    game: &Game,
    team_index: usize,
    nation: &str,
    wanted: &[Position],
    rng: &mut impl rand::Rng,
) -> Option<(String, Position)> {
    use rand::seq::SliceRandom;
    let (ability, potential, facility) = club_eye(game, team_index);
    let viewed = crate::scouting::youth_candidates_viewed(
        crate::game::YouthScoutingObjective::Balanced,
        ability,
        facility,
    );
    let pool = game.youth_pool.as_ref()?.nations.get(nation)?;
    for group in wanted {
        let mut candidates: Vec<&Player> = pool
            .iter()
            .filter(|player| group_index(&player.position) == group_index(group))
            .collect();
        if candidates.is_empty() {
            continue;
        }
        candidates.shuffle(rng);
        candidates.truncate(viewed);
        let best = candidates
            .into_iter()
            .map(|player| {
                let estimate = crate::scouting::estimate_prospect(player, ability, potential, rng);
                let score = crate::scouting::rank_by_objective(
                    crate::scouting::believed(estimate.ovr_low, estimate.ovr_high),
                    crate::scouting::believed(estimate.potential_low, estimate.potential_high),
                    crate::game::YouthScoutingObjective::Balanced,
                );
                (score, player.id.clone())
            })
            .max_by_key(|(score, _)| *score)?;
        return Some((best.1, group.clone()));
    }
    None
}

/// The week's AI signings from the pool, on Mondays: each AI club with demand
/// left signs one youngster with chance `demand left / Mondays left`, so it
/// signs at a steady pace and is sure to try on the season's last Monday.
pub fn process_ai_signings(game: &mut Game) {
    use rand::seq::SliceRandom;
    if game.clock.current_date.weekday() != chrono::Weekday::Mon {
        return;
    }
    ensure_pool(game);
    let today = game.clock.current_date.date_naive();
    let today_text = today.format("%Y-%m-%d").to_string();
    let Some(pool) = game.youth_pool.as_ref() else {
        return;
    };
    let weeks = mondays_left(today, season_end(game, pool, today));
    let user_team = game.manager.team_id.clone();
    let mut clubs: Vec<String> = pool
        .demand
        .iter()
        .filter(|(club, groups)| !groups.is_empty() && Some(*club) != user_team.as_ref())
        .map(|(club, _)| club.clone())
        .collect();
    let mut rng = game.rng_for("youth-pool-ai", &today_text);
    clubs.shuffle(&mut rng);

    for club in clubs {
        let wanted = game.youth_pool.as_ref().map_or_else(Vec::new, |pool| {
            pool.demand.get(&club).cloned().unwrap_or_default()
        });
        let chance = (wanted.len() as f64 / f64::from(weeks)).min(1.0);
        if !rng.random_bool(chance) {
            continue;
        }
        let Some(team_index) = game.teams.iter().position(|team| team.id == club) else {
            continue;
        };
        let nation = nation_of(&game.teams[team_index]).to_string();
        let Some((prospect_id, group)) = choose(game, team_index, &nation, &wanted, &mut rng)
        else {
            continue;
        };
        let Some(prospect) = take_from(game, &nation, &prospect_id) else {
            continue;
        };
        if !crate::youth_intake::sign_into_academy(game, team_index, prospect.clone(), today) {
            put_back(game, &nation, prospect);
            continue;
        }
        if let Some(groups) = game
            .youth_pool
            .as_mut()
            .and_then(|pool| pool.demand.get_mut(&club))
            && let Some(slot) = groups.iter().position(|wanted| *wanted == group)
        {
            groups.remove(slot);
        }
        let club_name = game.teams[team_index].name.clone();
        crate::youth_watchlist::signed_by_club(game, &prospect_id, &club_name);
    }
}

/// Where a youngster a scout once reported has got to.
pub enum Whereabouts<'a> {
    /// Still in the season's pool.
    Pool(&'a Player),
    /// Signed by a club, named here.
    Club(String),
    /// Gone from the game: the season ended without anyone signing him.
    Gone,
}

pub(crate) const ERR_PROSPECT_JOINED_CLUB: &str = "be.error.scouting.prospectJoinedClub";
pub(crate) const ERR_PROSPECT_OFF_MARKET: &str = "be.error.scouting.prospectOffMarket";

/// Where the youngster `prospect_id` is now.
pub fn whereabouts<'a>(game: &'a Game, prospect_id: &str) -> Whereabouts<'a> {
    if let Some(player) = game
        .youth_pool
        .iter()
        .flat_map(|pool| pool.nations.values().flatten())
        .find(|player| player.id == prospect_id)
    {
        return Whereabouts::Pool(player);
    }
    game.players
        .iter()
        .find(|player| player.id == prospect_id)
        .and_then(|player| player.team_id.as_deref())
        .and_then(|club| game.teams.iter().find(|team| team.id == club))
        .map_or(Whereabouts::Gone, |team| {
            Whereabouts::Club(team.name.clone())
        })
}

/// The youngster `prospect_id` if he is still in the pool, or the reason he
/// cannot be had: the club he joined, or that he left the market.
pub(crate) fn locate<'a>(game: &'a Game, prospect_id: &str) -> Result<&'a Player, String> {
    match whereabouts(game, prospect_id) {
        Whereabouts::Pool(player) => Ok(player),
        Whereabouts::Club(team) => Err(format!(
            "{ERR_PROSPECT_JOINED_CLUB}?team={}",
            query_value(&team)
        )),
        Whereabouts::Gone => Err(ERR_PROSPECT_OFF_MARKET.to_string()),
    }
}

/// `value` made safe inside an error key's query string, which the UI reads
/// with `URLSearchParams`: a club named "Brighton & Hove" must not split it.
fn query_value(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '%' => "%25".to_string(),
            '&' => "%26".to_string(),
            '+' => "%2B".to_string(),
            '=' => "%3D".to_string(),
            '#' => "%23".to_string(),
            other => other.to_string(),
        })
        .collect()
}

/// Take the youngster `prospect_id` out of the pool, wherever he is in it.
pub(crate) fn take(game: &mut Game, prospect_id: &str) -> Option<Player> {
    let nation = game
        .youth_pool
        .as_ref()?
        .nations
        .iter()
        .find_map(|(nation, players)| {
            players
                .iter()
                .any(|player| player.id == prospect_id)
                .then(|| nation.clone())
        })?;
    take_from(game, &nation, prospect_id)
}

/// Take a youngster out of `nation`'s pool.
fn take_from(game: &mut Game, nation: &str, prospect_id: &str) -> Option<Player> {
    let players = game.youth_pool.as_mut()?.nations.get_mut(nation)?;
    let index = players.iter().position(|player| player.id == prospect_id)?;
    Some(players.remove(index))
}

/// Return a youngster no club could sign to `nation`'s pool.
fn put_back(game: &mut Game, nation: &str, prospect: Player) {
    if let Some(pool) = game.youth_pool.as_mut() {
        pool.nations
            .entry(nation.to_string())
            .or_default()
            .push(prospect);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::test_support::uniform_attributes;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::staff::{Staff, StaffAttributes, StaffRole};
    use domain::team::Team;

    /// A Monday.
    fn monday() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 6).unwrap()
    }

    fn team(id: &str, nation: &str) -> Team {
        let mut team = Team::new(
            id.to_string(),
            format!("{id} FC"),
            id.to_uppercase(),
            nation.to_string(),
            "City".to_string(),
            "Ground".to_string(),
            20_000,
        );
        team.football_nation = nation.to_string();
        team.finance = 50_000_000;
        team.wage_budget = 5_000_000;
        team
    }

    fn youngster(id: &str, team_id: &str, position: Position) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2009-03-01".to_string(),
            "ENG".to_string(),
            position,
            uniform_attributes(50),
        );
        player.team_id = Some(team_id.to_string());
        player.squad_role = SquadRole::Youth;
        player
    }

    fn scout(id: &str, team_id: &str, rating: u8) -> Staff {
        let mut scout = Staff::new(
            id.to_string(),
            "Scout".to_string(),
            id.to_string(),
            "1980-01-01".to_string(),
            StaffRole::Scout,
            StaffAttributes {
                coaching: 20,
                judging_ability: rating,
                judging_potential: rating,
                physiotherapy: 20,
            },
        );
        scout.team_id = Some(team_id.to_string());
        scout
    }

    /// The player's club `user` and AI clubs `a1`, `a2` in England, `b1` in
    /// Spain. `a1` lacks only a keeper; the rest have empty academies.
    fn world() -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2026, 7, 6, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "mgr".to_string(),
            "Test".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("user".to_string());
        let players = vec![
            youngster("a1-d1", "a1", Position::Defender),
            youngster("a1-d2", "a1", Position::Defender),
            youngster("a1-m1", "a1", Position::Midfielder),
            youngster("a1-m2", "a1", Position::Midfielder),
            youngster("a1-f1", "a1", Position::Forward),
        ];
        let mut game = Game::new(
            clock,
            manager,
            vec![
                team("user", "England"),
                team("a1", "England"),
                team("a2", "England"),
                team("b1", "Spain"),
            ],
            players,
            vec![],
            vec![],
        );
        game.seed = 7;
        game
    }

    fn pool(game: &Game) -> &YouthPool {
        game.youth_pool.as_ref().expect("a pool")
    }

    fn per_group(players: &[Player]) -> [usize; 4] {
        let mut counts = [0; 4];
        for player in players {
            counts[group_index(&player.position)] += 1;
        }
        counts
    }

    // -- drawing the pool ------------------------------------------------------

    #[test]
    fn each_nation_with_a_club_gets_a_pool() {
        let mut game = world();
        open_season(&mut game, monday());

        let nation_of = |id: &str| {
            let team = game.teams.iter().find(|team| team.id == id).unwrap();
            crate::generator::team_local_nationality(team).to_string()
        };
        let nations: Vec<&String> = pool(&game).nations.keys().collect();
        assert_eq!(nations.len(), 2);
        assert!(pool(&game).nations.contains_key(&nation_of("a1")));
        assert!(pool(&game).nations.contains_key(&nation_of("b1")));
    }

    #[test]
    fn a_pool_holds_half_as_many_again_as_its_ai_clubs_need() {
        let mut game = world();
        open_season(&mut game, monday());

        // a1 needs a keeper (1); a2 and b1 have empty academies and take the
        // most a season allows: a keeper, then the thinnest groups.
        let a2 = &pool(&game).demand["a2"];
        assert_eq!(a2.len(), 3);
        assert_eq!(pool(&game).demand["a1"], vec![Position::Goalkeeper]);
        let mut england = [0usize; 4];
        for club in ["a1", "a2"] {
            for group in &pool(&game).demand[club] {
                england[group_index(group)] += 1;
            }
        }
        let expected = england.map(|need| ((need as f64 * SURPLUS).ceil() as usize).max(1));
        let england_key = crate::generator::team_local_nationality(&game.teams[1]).to_string();
        assert_eq!(per_group(&pool(&game).nations[&england_key]), expected);
    }

    #[test]
    fn the_players_club_adds_nothing_to_demand() {
        let mut game = world();
        open_season(&mut game, monday());

        assert!(!pool(&game).demand.contains_key("user"));
    }

    #[test]
    fn pool_youngsters_are_unattached_and_outside_the_world() {
        let mut game = world();
        let before = game.players.len();
        open_season(&mut game, monday());

        assert_eq!(game.players.len(), before);
        for player in pool(&game).nations.values().flatten() {
            assert_eq!(player.team_id, None);
            assert_eq!(player.squad_role, SquadRole::Youth);
            let born: i32 = player.date_of_birth[..4].parse().unwrap();
            let age = 2026 - born;
            assert!((14..=21).contains(&age), "{age}");
        }
    }

    #[test]
    fn a_replayed_season_opening_draws_the_same_pool() {
        let mut first = world();
        let mut second = world();
        open_season(&mut first, monday());
        open_season(&mut second, monday());

        let ratings = |game: &Game| {
            pool(game)
                .nations
                .values()
                .flatten()
                .map(|player| {
                    (
                        player.id.clone(),
                        player.ovr,
                        player.potential,
                        player.full_name.clone(),
                    )
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(ratings(&first), ratings(&second));
    }

    #[test]
    fn a_career_without_a_pool_draws_one() {
        let mut game = world();
        ensure_pool(&mut game);
        let ids = |game: &Game| {
            pool(game)
                .nations
                .values()
                .flatten()
                .map(|player| player.id.clone())
                .collect::<Vec<_>>()
        };
        let drawn = ids(&game);
        ensure_pool(&mut game);

        assert!(!drawn.is_empty());
        assert_eq!(ids(&game), drawn);
    }

    // -- AI signings -----------------------------------------------------------

    #[test]
    fn no_one_signs_on_other_days() {
        let mut game = world();
        open_season(&mut game, monday());
        game.clock.advance_days(1);
        let before = game.players.len();

        process_ai_signings(&mut game);

        assert_eq!(game.players.len(), before);
    }

    #[test]
    fn on_the_seasons_last_monday_every_club_signs_what_it_needs() {
        let mut game = world();
        open_season(&mut game, monday());
        // The season ends on this very Monday: one week left, so p = 1.
        game.youth_pool.as_mut().unwrap().ends_on = "2026-07-06".to_string();

        for _ in 0..3 {
            process_ai_signings(&mut game);
        }

        assert!(pool(&game).demand.values().all(Vec::is_empty));
        let a1_new: Vec<&Player> = game
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some("a1"))
            .filter(|player| player.position == Position::Goalkeeper)
            .collect();
        assert_eq!(a1_new.len(), 1);
        assert_eq!(a1_new[0].squad_role, SquadRole::Youth);
    }

    #[test]
    fn a_club_signs_from_its_own_nation_and_the_youngster_leaves_the_pool() {
        let mut game = world();
        open_season(&mut game, monday());
        game.youth_pool.as_mut().unwrap().ends_on = "2026-07-06".to_string();
        let spain = crate::generator::team_local_nationality(&game.teams[3]).to_string();
        let spanish: Vec<String> = pool(&game).nations[&spain]
            .iter()
            .map(|player| player.id.clone())
            .collect();

        process_ai_signings(&mut game);

        let signed: Vec<&Player> = game
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some("b1"))
            .collect();
        assert_eq!(signed.len(), 1);
        assert!(spanish.contains(&signed[0].id));
        assert!(
            !pool(&game).nations[&spain]
                .iter()
                .any(|player| player.id == signed[0].id)
        );
    }

    #[test]
    fn early_in_the_season_clubs_sign_at_a_steady_pace() {
        let mut game = world();
        open_season(&mut game, monday());
        // Fifty Mondays to go: a club needing three signs each week with p = 3/50.
        game.youth_pool.as_mut().unwrap().ends_on = "2027-06-14".to_string();
        let before = game.players.len();

        process_ai_signings(&mut game);

        assert!(game.players.len() - before <= 2);
    }

    #[test]
    fn a_club_the_board_cannot_pay_signs_no_one_and_keeps_its_demand() {
        let mut game = world();
        open_season(&mut game, monday());
        game.youth_pool.as_mut().unwrap().ends_on = "2026-07-06".to_string();
        let b1 = game.teams.iter_mut().find(|team| team.id == "b1").unwrap();
        b1.wage_budget = 0;
        b1.finance = -10_000_000;
        let demand = pool(&game).demand["b1"].clone();

        process_ai_signings(&mut game);

        assert!(
            !game
                .players
                .iter()
                .any(|p| p.team_id.as_deref() == Some("b1"))
        );
        assert_eq!(pool(&game).demand["b1"], demand);
    }

    #[test]
    fn a_club_with_a_good_scout_signs_better_youngsters() {
        let mean_potential = |rating: Option<u8>| {
            let mut total = 0u64;
            let mut count = 0u64;
            for seed in 0..60 {
                let mut game = world();
                game.seed = seed;
                if let Some(rating) = rating {
                    game.staff.push(scout("s", "a2", rating));
                    game.teams
                        .iter_mut()
                        .find(|t| t.id == "a2")
                        .unwrap()
                        .facilities
                        .scouting = 3;
                }
                open_season(&mut game, monday());
                // Only a2 signs, so no rival takes from its pool.
                let demand = game.youth_pool.as_mut().unwrap();
                demand.demand.retain(|club, _| club == "a2");
                demand.ends_on = "2026-07-06".to_string();
                process_ai_signings(&mut game);
                for player in game
                    .players
                    .iter()
                    .filter(|p| p.team_id.as_deref() == Some("a2"))
                {
                    total += u64::from(player.potential);
                    count += 1;
                }
            }
            total as f64 / count as f64
        };

        assert!(mean_potential(Some(95)) > mean_potential(None) + 1.0);
    }

    // -- the season's end ------------------------------------------------------

    #[test]
    fn at_the_seasons_end_only_the_players_club_takes_an_intake() {
        let mut game = world();
        let season_end = NaiveDate::from_ymd_opt(2027, 5, 30).unwrap();
        let before: Vec<String> = game.players.iter().map(|p| p.id.clone()).collect();

        crate::end_of_season::apply_season_end_squad_turnover(&mut game, season_end, 2026);

        let joined = |club: &str| {
            game.players
                .iter()
                .filter(|p| p.team_id.as_deref() == Some(club) && !before.contains(&p.id))
                .count()
        };
        assert!(joined("user") > 0);
        for club in ["a1", "a2", "b1"] {
            assert_eq!(joined(club), 0, "{club}");
        }
        assert_eq!(pool(&game).generated_on, "2027-05-30");
    }

    #[test]
    fn rolling_over_replaces_the_pool() {
        let mut game = world();
        open_season(&mut game, monday());
        let old_ids: Vec<String> = pool(&game)
            .nations
            .values()
            .flatten()
            .map(|player| player.id.clone())
            .collect();
        let season_end = NaiveDate::from_ymd_opt(2027, 5, 30).unwrap();

        roll_over(&mut game, season_end);

        assert_eq!(pool(&game).generated_on, "2027-05-30");
        assert!(
            pool(&game)
                .nations
                .values()
                .flatten()
                .all(|player| !old_ids.contains(&player.id))
        );
    }
}
