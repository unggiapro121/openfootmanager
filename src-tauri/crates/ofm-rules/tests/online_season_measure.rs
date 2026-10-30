//! E3-7: online seasons played the way the server will play them (S-7 §3.6–§3.8), measured to
//! choose the season ruleset's development multiplier (Q5) and to check that a match a day with
//! a session a day does not wear squads down. E5-1 adds seasons with recovery blocks and a person's
//! own sessions (E5-1-tech-spec.md §4, §5), measured by kind of club to choose the hours a block
//! gives. Run by hand:
//! `cargo test --release -p ofm-rules --test online_season_measure -- --ignored --nocapture`.
//!
//! A day without blocks: every player's injury counts down a day; every club plans and trains
//! (`train_online_day`, the day's session and its recovery, with no taper); then, from day 2, each
//! league plays its round. With blocks the day follows E5-1 §4: the 04:00 job, a person's session
//! at 12:00, the kick-off at its league's slot, each recovering by the blocks passed since the
//! last. At the end of a season: aging, online retirement, and the season into the career. Squads
//! are not topped up, so the third season is played by smaller squads than the first. E5-4b adds
//! extra sessions pressed at 12:00 and condition drinks (E5-4-tech-spec.md §4, module `extra`).

use std::collections::{BTreeMap, HashMap};

use domain::manager::PlayStyleMastery;
use domain::player::Player;
use domain::staff::Staff;
use domain::team::{Team, TrainingFocus, TrainingIntensity, TrainingSchedule};
use engine::MatchConfig;
use engine::ai::AiProfile;
use ofm_rules::match_session::{Controller, MatchSeed, MatchSession, MatchSetup};
use ofm_rules::match_summary::MatchSummary;
use ofm_rules::recovery::{RecoveryBlocks, recovery_mults, rest_blocks, session_allowed};
use ofm_rules::squad::{
    FixtureLoad, SideSelection, build_side, coach_mastery_from, management_quality_from_rating,
    selection_seed,
};
use ofm_rules::training::{
    SessionKind, TrainingDay, online_session, session_rng, team_training_plan, train_online_day,
};
use ofm_rules::worldgen::online::{Generator, OnlineContentPack};
use ofm_rules::{age, aging, ai_training, match_form, player_wear, playing_time, season};
use ofm_rules::{season_stats, seed};

// A directory of its own, so cargo does not take it for a test target of its own.
#[path = "online_season_measure/extra.rs"]
mod extra;

const SEED: u64 = 0x0E37;
/// The seeds of the E5-1 measurement (§5.2): E3-7's and two more.
const SEEDS: [u64; 3] = [SEED, 0x0E51_0001, 0x0E51_0002];
const CLUBS: u64 = 56;
const LEAGUE: usize = 14;
const DAYS: u32 = 28;
const SEASONS: u32 = 3;
const FIRST_YEAR: u32 = 2026;
/// Day 0 is a Saturday.
const START_WEEKDAY: u32 = 5;
/// A season's minutes: 26 matches of 90.
const SEASON_MINUTES: u32 = 26 * 90;
const MINUTES_A_DAY: i64 = 24 * 60;
/// A day of the season begins at 04:00 in its region.
const DAY_TURN: i64 = 4 * 60;
/// When a person presses for his session (E5-1 §5.1).
const SESSION_AT: i64 = 12 * 60;
/// Each league's kick-off, by league: the proposed ruleset's four slots.
const KICKOFF_AT: [i64; 4] = [18 * 60, 19 * 60, 20 * 60, 21 * 60];

/// Who runs a club's training (E5-1 §5.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    /// The AI's plan, on its schedule (`plan_session`).
    Bot,
    /// A person's saved plan as a new club has it, sessions on its schedule.
    Auto,
    /// The strongest saved plan the automatic sessions can run: Intense, High.
    AutoMax,
    /// A person pressing a High session every day the cap allows.
    ManualHigh,
    /// A person pressing by his eleven's condition: High when fresh, Medium when tiring, none when
    /// tired.
    ManualSmart,
    /// A person with the automatic sessions off who never presses.
    Off,
    /// E5-4b: a person pressing extra sessions for one star, who drinks the free bottles.
    ExtraFree,
    /// E5-4b: a person pressing extra sessions for every player who can still grow; the free
    /// bottles go to the star.
    ExtraFreeAll,
    /// E5-4b: a person pressing for three stars and buying every bottle the daily cap allows them.
    ExtraMax3,
    /// E5-4b: a person pressing for everyone and buying every bottle the daily cap allows each.
    ExtraMaxAll,
}

impl Kind {
    /// Whether the club's saved plan runs its sessions on its own (E5-1 `Auto`, and every kind of
    /// E5-4b that presses on top of it).
    fn automatic(self) -> bool {
        matches!(
            self,
            Kind::Auto
                | Kind::AutoMax
                | Kind::ExtraFree
                | Kind::ExtraFreeAll
                | Kind::ExtraMax3
                | Kind::ExtraMaxAll
        )
    }
}

/// The kind of each place of a league, before the season's turn (§5.1: 6 bots, 2, 2, 2, 1, 1).
const PLACES: [Kind; LEAGUE] = [
    Kind::Bot,
    Kind::Bot,
    Kind::Bot,
    Kind::Bot,
    Kind::Bot,
    Kind::Bot,
    Kind::Auto,
    Kind::Auto,
    Kind::AutoMax,
    Kind::AutoMax,
    Kind::ManualHigh,
    Kind::ManualHigh,
    Kind::ManualSmart,
    Kind::Off,
];

/// How an online day gives back condition.
#[derive(Clone, Copy)]
enum Recovery {
    /// The day's session and this many rest days more, at 04:00 (`train_online_day`).
    Legacy { rest_days: u32 },
    /// E5-1: by blocks of the online day, sessions by kind of club.
    Blocks(RecoveryBlocks),
}

/// One way to play online seasons: the development multiplier, the online recovery, the injury
/// scale (S-7 Qs7-11), the kinds of club of a league (all bots without) and how they turn, how many
/// seasons, the world's seed, and the extra sessions of E5-4b (none without).
/// `rest_days: 0, injury_scale: 1` is the game's own day.
#[derive(Clone, Copy)]
struct Variant {
    multiplier: f64,
    recovery: Recovery,
    /// Injuries out for this many times fewer days (`assign_online_match_injury`).
    injury_scale: u32,
    places: Option<&'static [Kind; LEAGUE]>,
    /// The places' first turn: club `i` of a league starts at place `(i + shift) % 14`.
    shift: usize,
    /// Whether the places turn one step a season (E5-1) or a club keeps its kind (E54-14).
    rotate: bool,
    seasons: u32,
    seed: u64,
    extra: Option<extra::ExtraRun>,
}

impl Variant {
    /// E5-1's world: the places turning from the first, `SEASONS` seasons, no extra sessions.
    fn e51(
        multiplier: f64,
        recovery: Recovery,
        injury_scale: u32,
        places: Option<&'static [Kind; LEAGUE]>,
        seed: u64,
    ) -> Self {
        Self {
            multiplier,
            recovery,
            injury_scale,
            places,
            shift: 0,
            rotate: true,
            seasons: SEASONS,
            seed,
            extra: None,
        }
    }
}

struct Club {
    team: Team,
    players: Vec<Player>,
    staff: Vec<Staff>,
    mastery: PlayStyleMastery,
    rating: u8,
    kind: Kind,
    /// The days of this season that held a session.
    held: Vec<u32>,
    /// When the stored condition was true, in minutes from 04:00 of the first season's day 0.
    condition_at: i64,
    /// E5-4b: the club's stars and bottles.
    extra: extra::ClubExtra,
}

#[derive(Default)]
struct Measure {
    /// Per round: the sum of the eleven's mean condition at kick-off, and the sides counted.
    kickoff: BTreeMap<u32, (f64, u32)>,
    starters: u32,
    starters_below_60: u32,
    injuries: u32,
    injury_days: u32,
    /// Age band → (sum of OVR change over a season, players) for regular starters.
    growth: BTreeMap<&'static str, (f64, u32)>,
    /// Age band → (sum of OVR change, players) for everyone.
    growth_all: BTreeMap<&'static str, (f64, u32)>,
    retired_by_age: BTreeMap<i32, u32>,
    veterans_by_age: BTreeMap<i32, u32>,
    smallest_squad: usize,
    club_seasons: u32,
    /// Sum over club-seasons of the change in the mean OVR of the eighteen best.
    top18_change: f64,
    points: u32,
    goal_difference: i32,
    matches: u32,
    /// E5-4b's numbers; empty in every other measurement.
    extra: extra::ExtraMeasure,
}

impl Measure {
    /// A measure before any club is counted: no squad seen yet, so none the smallest.
    fn starting() -> Self {
        Self {
            smallest_squad: usize::MAX,
            ..Self::default()
        }
    }

    fn kickoff_mean(&self) -> f64 {
        let (sum, n) = self
            .kickoff
            .values()
            .fold((0.0, 0), |(s, n), (sum, count)| (s + sum, n + count));
        sum / f64::from(n.max(1))
    }

    fn below_60_percent(&self) -> f64 {
        100.0 * f64::from(self.starters_below_60) / f64::from(self.starters.max(1))
    }

    fn injuries_per_club_season(&self) -> f64 {
        f64::from(self.injuries) / f64::from(self.club_seasons.max(1))
    }

    /// OVR change a season of everyone 19 or younger at the start. Not only regular starters:
    /// a kind of club has a handful of those, too few to judge (E5-1 §5.4, A4).
    fn young_growth(&self) -> f64 {
        self.growth_all
            .get("≤19")
            .map_or(0.0, |(sum, n)| sum / f64::from((*n).max(1)))
    }

    fn top18(&self) -> f64 {
        self.top18_change / f64::from(self.club_seasons.max(1))
    }

    fn points_per_match(&self) -> f64 {
        f64::from(self.points) / f64::from(self.matches.max(1))
    }
}

type Measures = BTreeMap<Kind, Measure>;

fn world(v: Variant) -> Vec<Club> {
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(v.seed, &pack).expect("a generator");
    (0..CLUBS)
        .map(|ordinal| {
            let club = generator
                .club("AsiaSoutheast", ordinal, 0, FIRST_YEAR, None)
                .expect("a club");
            Club {
                rating: club.coach.rating(),
                mastery: club.coach.play_style_mastery,
                team: club.team,
                players: club.players,
                staff: club.staff,
                kind: Kind::Bot,
                held: Vec::new(),
                condition_at: 0,
                extra: extra::ClubExtra::default(),
            }
        })
        .collect()
}

/// Each club's kind for `season_number`: its place in its league turned one step a season, so no
/// kind keeps the same generated clubs (§5.1). All bots unless the variant mixes them.
fn assign_kinds(clubs: &mut [Club], season_number: u32, v: Variant) {
    for (index, club) in clubs.iter_mut().enumerate() {
        club.held.clear();
        club.kind = v.places.map_or(Kind::Bot, |places| {
            let turned = if v.rotate { season_number - 1 } else { 0 };
            places[(index % LEAGUE + v.shift + turned as usize) % LEAGUE]
        });
        let (schedule, intensity) = match club.kind {
            Kind::Bot => continue,
            Kind::AutoMax => (TrainingSchedule::Intense, TrainingIntensity::High),
            Kind::Auto
            | Kind::ManualHigh
            | Kind::ManualSmart
            | Kind::Off
            | Kind::ExtraFree
            | Kind::ExtraFreeAll
            | Kind::ExtraMax3
            | Kind::ExtraMaxAll => (TrainingSchedule::Balanced, TrainingIntensity::Medium),
        };
        // Every person trains the same work, so kinds differ only in how many sessions, how hard
        // and when.
        club.team.training_focus = TrainingFocus::Technical;
        club.team.training_schedule = schedule;
        club.team.training_intensity = intensity;
    }
}

fn band(age: i32) -> &'static str {
    match age {
        ..=19 => "≤19",
        20..=22 => "20–22",
        23..=26 => "23–26",
        27..=30 => "27–30",
        _ => "31+",
    }
}

fn training_day(football_year: u32, day: u32, multiplier: f64) -> TrainingDay {
    let (year, date) = season::season_football_date(football_year, day, DAYS);
    TrainingDay {
        weekday_num: season::season_weekday(START_WEEKDAY, day),
        year,
        date,
        development_multiplier: multiplier,
        keeper_drill: None,
    }
}

fn plan_for_bot(club: &mut Club, weekday: u32) {
    let available: Vec<&Player> = club.players.iter().filter(|p| p.injury.is_none()).collect();
    ai_training::plan_session(&mut club.team, &available, weekday);
}

fn train(club: &mut Club, season_number: u32, day: u32, football_year: u32, v: Variant) {
    let Recovery::Legacy { rest_days } = v.recovery else {
        return;
    };
    let training_day = training_day(football_year, day, v.multiplier);
    for player in &mut club.players {
        player_wear::recover_injury(player, 1);
    }
    if club.kind == Kind::Bot {
        plan_for_bot(club, training_day.weekday_num);
    }
    let staff: Vec<&Staff> = club.staff.iter().collect();
    let plan = team_training_plan(&club.team, &staff, None);
    let key = season::day_key(season_number, day);
    for player in &mut club.players {
        let mut rng = session_rng(v.seed, &player.id, &key);
        train_online_day(player, &plan, &training_day, rest_days, &mut rng);
    }
}

/// Every player of `club` rested by the blocks passed from his stored condition's time to `at`,
/// which becomes it (E5-1 §4, "chốt tới t").
fn rest_to(club: &mut Club, at: i64, blocks_of: &RecoveryBlocks, date: &str) {
    let block = MINUTES_A_DAY / i64::from(blocks_of.per_day);
    let passed = at.div_euclid(block) - club.condition_at.div_euclid(block);
    club.condition_at = at;
    let Ok(blocks) = u32::try_from(passed) else {
        return;
    };
    if blocks == 0 {
        return;
    }
    let staff: Vec<&Staff> = club.staff.iter().collect();
    let recovery = recovery_mults(&team_training_plan(&club.team, &staff, None));
    for player in &mut club.players {
        let age = age::age_on(&player.date_of_birth, date).map_or(25, |a| a.max(0) as u32);
        player.condition = rest_blocks(player, player.condition, age, recovery, blocks, blocks_of);
    }
}

/// The 04:00 job of day `day` with blocks (E5-1 §4): count injuries down, then a bot's session of
/// today or a person's of yesterday, then rest to 04:00. The session runs on the condition the
/// day before left and the night's blocks come after it, as the legacy day trained before it
/// rested (E51-11): tired starters still fall under the fatigue guard and recover instead.
fn morning(club: &mut Club, at: i64, season_number: u32, day: u32, football_year: u32, v: Variant) {
    let Recovery::Blocks(blocks_of) = v.recovery else {
        return;
    };
    let today = training_day(football_year, day, v.multiplier);
    for player in &mut club.players {
        player_wear::recover_injury(player, 1);
    }
    if club.kind == Kind::Bot {
        plan_for_bot(club, today.weekday_num);
        if club
            .team
            .training_schedule
            .is_training_day(today.weekday_num)
        {
            club.held.push(day);
        }
        session(
            club,
            SessionKind::Scheduled,
            season_number,
            day,
            &today,
            v.seed,
        );
    } else {
        catch_up(club, season_number, day, football_year, v);
    }
    rest_to(club, at, &blocks_of, &today.date);
}

/// A person's session of the day before `day`, if that day held none: his automatic one when the
/// cap allows, a rest day otherwise. Day 0 has no day before; the season's last day is caught up
/// by the season's close (E51-12).
fn catch_up(club: &mut Club, season_number: u32, day: u32, football_year: u32, v: Variant) {
    let Some(yesterday) = day.checked_sub(1) else {
        return;
    };
    if club.held.contains(&yesterday) {
        return;
    }
    let past = training_day(football_year, yesterday, v.multiplier);
    let automatic = club.kind.automatic();
    let kind = if automatic && session_allowed(&club.held, yesterday) {
        if club
            .team
            .training_schedule
            .is_training_day(past.weekday_num)
        {
            club.held.push(yesterday);
        }
        SessionKind::Scheduled
    } else {
        SessionKind::Rest
    };
    session(club, kind, season_number, yesterday, &past, v.seed);
}

fn session(
    club: &mut Club,
    kind: SessionKind,
    season_number: u32,
    day: u32,
    on: &TrainingDay,
    seed: u64,
) {
    let staff: Vec<&Staff> = club.staff.iter().collect();
    let plan = team_training_plan(&club.team, &staff, None);
    let key = season::day_key(season_number, day);
    for player in &mut club.players {
        let mut rng = session_rng(seed, &player.id, &key);
        online_session(player, &plan, on, kind, &mut rng);
    }
}

/// A person's own session at 12:00 of day `day`, if his kind presses and the cap allows.
fn press(club: &mut Club, at: i64, season_number: u32, day: u32, football_year: u32, v: Variant) {
    let Recovery::Blocks(blocks_of) = v.recovery else {
        return;
    };
    if !matches!(club.kind, Kind::ManualHigh | Kind::ManualSmart) {
        return;
    }
    if !session_allowed(&club.held, day) {
        return;
    }
    let today = training_day(football_year, day, v.multiplier);
    rest_to(club, at, &blocks_of, &today.date);
    let intensity = if club.kind == Kind::ManualHigh {
        TrainingIntensity::High
    } else {
        let available: Vec<&Player> = club.players.iter().filter(|p| p.injury.is_none()).collect();
        let eleven = ai_training::likely_starters_condition(&available, &club.team.formation);
        if eleven >= 80.0 {
            TrainingIntensity::High
        } else if eleven >= 60.0 {
            TrainingIntensity::Medium
        } else {
            return;
        }
    };
    club.team.training_intensity = intensity;
    club.held.push(day);
    session(
        club,
        SessionKind::Manual,
        season_number,
        day,
        &today,
        v.seed,
    );
}

fn side(club: &Club, key: &str) -> (engine::TeamData, Vec<engine::PlayerData>) {
    let available: Vec<&Player> = club.players.iter().filter(|p| p.injury.is_none()).collect();
    let injured: Vec<&Player> = club.players.iter().filter(|p| p.injury.is_some()).collect();
    build_side(&SideSelection {
        team_id: &club.team.id,
        team: Some(&club.team),
        available: &available,
        injured: &injured,
        is_user_team: false,
        head_coach: coach_mastery_from(&club.mastery),
        management_quality: management_quality_from_rating(club.rating),
        selection_seed: selection_seed(&club.team.id, key),
        load: FixtureLoad::Normal,
    })
}

fn kickoff_condition(club: &Club, eleven: &engine::TeamData, round: u32, measure: &mut Measure) {
    let by_id: HashMap<&str, u8> = club
        .players
        .iter()
        .map(|p| (p.id.as_str(), p.condition))
        .collect();
    let conditions: Vec<u8> = eleven
        .players
        .iter()
        .filter_map(|p| by_id.get(p.id.as_str()).copied())
        .collect();
    let mean = conditions.iter().map(|c| f64::from(*c)).sum::<f64>() / conditions.len() as f64;
    let entry = measure.kickoff.entry(round).or_default();
    entry.0 += mean;
    entry.1 += 1;
    measure.starters += conditions.len() as u32;
    measure.starters_below_60 += conditions.iter().filter(|c| **c < 60).count() as u32;
}

fn settle(
    club: &mut Club,
    summary: &MatchSummary,
    (scored, conceded): (u8, u8),
    fixture: &str,
    v: Variant,
    measure: &mut Measure,
) {
    let medical = club.team.facilities.medical;
    let mut wear = seed::rng_for_seed(
        v.seed,
        &format!("post-match/wear/{}", club.team.id),
        fixture,
    );
    for player in &mut club.players {
        let stats = summary.player_stats.get(&player.id);
        let (minutes, rating) = stats.map_or((0, 0.0), |s| (s.minutes_played, s.rating));
        playing_time::record_club_match(player, minutes);
        match_form::record_rated_match(player, rating);
        player_wear::apply_match_wear(player, minutes, &mut wear);
        if let Some(stats) = stats {
            season_stats::record_match(player, stats, conceded);
        }
        if summary.injured.contains(&player.id) {
            let mut rng =
                seed::rng_for_seed(v.seed, &format!("post-match/injury/{}", player.id), fixture);
            if let Some(injury) =
                player_wear::assign_online_match_injury(player, medical, v.injury_scale, &mut rng)
            {
                measure.injuries += 1;
                measure.injury_days += injury.days_remaining;
            }
        }
    }
    measure.matches += 1;
    measure.points += match scored.cmp(&conceded) {
        std::cmp::Ordering::Greater => 3,
        std::cmp::Ordering::Equal => 1,
        std::cmp::Ordering::Less => 0,
    };
    measure.goal_difference += i32::from(scored) - i32::from(conceded);
}

/// The fixture `fixture` of round `round` between clubs `home` and `away`, kicking off at `at`
/// (minutes from the first day's 04:00; with blocks, both squads are rested up to it first).
fn play(
    clubs: &mut [Club],
    (home, away): (usize, usize),
    (fixture, round, at, date): (&str, u32, i64, &str),
    v: Variant,
    m: &mut Measures,
) {
    if let Recovery::Blocks(blocks_of) = v.recovery {
        rest_to(&mut clubs[home], at, &blocks_of, date);
        rest_to(&mut clubs[away], at, &blocks_of, date);
    }
    let (mut home_side, mut home_bench) = side(&clubs[home], fixture);
    let (mut away_side, mut away_bench) = side(&clubs[away], fixture);
    let (home_kind, away_kind) = (clubs[home].kind, clubs[away].kind);
    if v.extra.is_some() {
        extra::field_stars(&clubs[home], &mut home_side, &mut home_bench);
        extra::field_stars(&clubs[away], &mut away_side, &mut away_bench);
        extra::kickoff(&clubs[home], &home_side, kind_measure(m, home_kind));
        extra::kickoff(&clubs[away], &away_side, kind_measure(m, away_kind));
    }
    kickoff_condition(&clubs[home], &home_side, round, kind_measure(m, home_kind));
    kickoff_condition(&clubs[away], &away_side, round, kind_measure(m, away_kind));
    let mut match_seed = [0u8; 32];
    match_seed[..8].copy_from_slice(
        &ofm_rules::stable_hash::stable_hash(fixture.as_bytes(), v.seed).to_le_bytes(),
    );
    let setup = MatchSetup {
        home: home_side,
        away: away_side,
        home_bench,
        away_bench,
        config: MatchConfig::default(),
        allows_extra_time: false,
        seed: MatchSeed(match_seed),
        ai_home: AiProfile::default(),
        ai_away: AiProfile::default(),
        injury_window_steps: None,
        licence_home: None,
        licence_away: None,
    };
    let mut session = MatchSession::new(setup, Controller::Ai, Controller::Ai);
    while !session.is_finished() {
        session.step();
    }
    let summary = MatchSummary::from_report(&session.into_report());
    let (home_goals, away_goals) = (summary.home_goals, summary.away_goals);
    settle(
        &mut clubs[home],
        &summary,
        (home_goals, away_goals),
        fixture,
        v,
        kind_measure(m, home_kind),
    );
    settle(
        &mut clubs[away],
        &summary,
        (away_goals, home_goals),
        fixture,
        v,
        kind_measure(m, away_kind),
    );
}

fn kind_measure(m: &mut Measures, kind: Kind) -> &mut Measure {
    m.entry(kind).or_insert_with(Measure::starting)
}

/// The mean OVR of a club's eighteen best.
fn top18(players: &[Player]) -> f64 {
    let mut ovr: Vec<u8> = players.iter().map(|p| p.ovr).collect();
    ovr.sort_unstable_by(|a, b| b.cmp(a));
    let best = &ovr[..ovr.len().min(18)];
    best.iter().map(|o| f64::from(*o)).sum::<f64>() / best.len().max(1) as f64
}

fn close_season(
    clubs: &mut [Club],
    season_number: u32,
    football_year: u32,
    start: &HashMap<String, (u8, i32)>,
    start_top18: &[f64],
    m: &mut Measures,
) {
    let (_, last_day) = season::season_football_date(football_year, DAYS - 1, DAYS);
    for (club, top18_at_start) in clubs.iter_mut().zip(start_top18) {
        let measure = kind_measure(m, club.kind);
        measure.club_seasons += 1;
        measure.top18_change += top18(&club.players) - top18_at_start;
        for player in &mut club.players {
            if let Some((ovr, start_age)) = start.get(&player.id) {
                let change = f64::from(player.ovr) - f64::from(*ovr);
                let all = measure.growth_all.entry(band(*start_age)).or_default();
                all.0 += change;
                all.1 += 1;
                if player.stats.minutes_played * 2 >= SEASON_MINUTES {
                    let regular = measure.growth.entry(band(*start_age)).or_default();
                    regular.0 += change;
                    regular.1 += 1;
                }
            }
            let age = age::age_on(&player.date_of_birth, &last_day).unwrap_or(30);
            season_stats::archive_season(player, season_number, &club.team.id, &club.team.name);
            aging::apply_attribute_curve(player, age, football_year);
            if age >= 33 {
                *measure.veterans_by_age.entry(age).or_default() += 1;
            }
            if aging::should_retire_online(player, age, football_year) {
                *measure.retired_by_age.entry(age).or_default() += 1;
                player.retired = true;
            }
            season_stats::reset_season(player);
        }
        club.players.retain(|p| !p.retired);
        club.team
            .starting_xi_ids
            .retain(|id| club.players.iter().any(|p| &p.id == id));
        measure.smallest_squad = measure.smallest_squad.min(club.players.len());
    }
}

fn run(v: Variant) -> Measures {
    let mut clubs = world(v);
    let mut measures = Measures::new();
    let pairings = season::round_robin_pairings(14, 2);
    for season_number in 1..=v.seasons {
        assign_kinds(&mut clubs, season_number, v);
        let football_year = FIRST_YEAR + season_number - 1;
        let (_, first_day) = season::season_football_date(football_year, 0, DAYS);
        let start: HashMap<String, (u8, i32)> = clubs
            .iter()
            .flat_map(|c| c.players.iter())
            .map(|p| {
                (
                    p.id.clone(),
                    (
                        p.ovr,
                        age::age_on(&p.date_of_birth, &first_day).unwrap_or(30),
                    ),
                )
            })
            .collect();
        let start_top18: Vec<f64> = clubs.iter().map(|c| top18(&c.players)).collect();
        if let Some(extra_run) = v.extra {
            extra::open_season(
                &mut clubs,
                (season_number, football_year),
                v,
                extra_run,
                &mut measures,
            );
        }
        for day in 0..DAYS {
            let day_start = i64::from((season_number - 1) * DAYS + day) * MINUTES_A_DAY;
            for club in &mut clubs {
                train(club, season_number, day, football_year, v);
                if v.extra.is_some() {
                    extra::choose_focus(club);
                }
                morning(club, day_start, season_number, day, football_year, v);
                let at = day_start + SESSION_AT - DAY_TURN;
                press(club, at, season_number, day, football_year, v);
                if let Some(extra_run) = v.extra {
                    extra::morning(club, day);
                    let measure = kind_measure(&mut measures, club.kind);
                    extra::press(
                        club,
                        at,
                        (season_number, day, football_year),
                        v,
                        extra_run,
                        measure,
                    );
                }
            }
            if v.extra.is_some() {
                for club in &mut clubs {
                    extra::track_stars(club, day);
                }
            }
            if day < 2 {
                continue;
            }
            let round = day - 1;
            let (_, date) = season::season_football_date(football_year, day, DAYS);
            for (league, slot) in KICKOFF_AT.iter().enumerate() {
                let kickoff = day_start + slot - DAY_TURN;
                for (home, away) in &pairings[(round - 1) as usize] {
                    let fixture = format!("s{season_number}/l{league}/r{round}/{home}-{away}");
                    play(
                        &mut clubs,
                        (league * LEAGUE + home, league * LEAGUE + away),
                        (&fixture, round, kickoff, &date),
                        v,
                        &mut measures,
                    );
                }
            }
        }
        if matches!(v.recovery, Recovery::Blocks(_)) {
            for club in clubs.iter_mut().filter(|c| c.kind != Kind::Bot) {
                catch_up(club, season_number, DAYS, football_year, v);
            }
        }
        if v.extra.is_some() {
            extra::close_season(&clubs, season_number, &start_top18, &mut measures);
        }
        close_season(
            &mut clubs,
            season_number,
            football_year,
            &start,
            &start_top18,
            &mut measures,
        );
    }
    measures
}

fn describe(v: Variant) -> String {
    match v.recovery {
        Recovery::Legacy { rest_days } => format!("+{rest_days} rest days a day"),
        Recovery::Blocks(b) => format!("{} blocks of {} h", b.per_day, b.hours),
    }
}

fn report(v: Variant, m: &Measure, kind: Option<Kind>) {
    let who = kind.map_or(String::new(), |k| format!(", {k:?}"));
    println!(
        "\n== {}×, {}, injuries ÷{} ({SEASONS} seasons, {CLUBS} clubs, seed {:#x}{who}) ==",
        v.multiplier,
        describe(v),
        v.injury_scale,
        v.seed
    );
    let line = |rows: &BTreeMap<&'static str, (f64, u32)>| {
        ["≤19", "20–22", "23–26", "27–30", "31+"]
            .iter()
            .map(|b| {
                rows.get(b).map_or(format!("{b}: –"), |(s, n)| {
                    format!("{b}: {:+.2} (n={n})", s / f64::from(*n))
                })
            })
            .collect::<Vec<_>>()
            .join(" · ")
    };
    println!(
        "OVR change a season, regular starters (≥ half the minutes): {}",
        line(&m.growth)
    );
    println!(
        "OVR change a season, everyone:                             {}",
        line(&m.growth_all)
    );
    let rounds: Vec<String> = m
        .kickoff
        .iter()
        .filter(|(round, _)| [1, 5, 10, 15, 20, 26].contains(*round))
        .map(|(round, (sum, n))| format!("r{round} {:.1}", sum / f64::from(*n)))
        .collect();
    println!(
        "XI mean condition at kick-off by round: {}",
        rounds.join(" · ")
    );
    println!(
        "starters below 60 at kick-off: {:.2}%",
        m.below_60_percent()
    );
    println!(
        "injuries per club a season: {:.2}, mean length {:.1} days",
        m.injuries_per_club_season(),
        f64::from(m.injury_days) / f64::from(m.injuries.max(1))
    );
    let retirements: Vec<String> = m
        .veterans_by_age
        .iter()
        .map(|(age, n)| {
            let retired = m.retired_by_age.get(age).copied().unwrap_or(0);
            format!("{age}: {retired}/{n}")
        })
        .collect();
    println!(
        "retired / veterans by age at season end: {}",
        retirements.join(" · ")
    );
    println!("smallest squad after a season end: {}", m.smallest_squad);
    if kind.is_some() {
        println!(
            "top18 change a season: {:+.2} · points a match {:.3} · goal difference a match {:+.3}",
            m.top18(),
            m.points_per_match(),
            f64::from(m.goal_difference) / f64::from(m.matches.max(1))
        );
    }
}

/// Given 56 generated clubs in four leagues,
/// when three online seasons are played by the game's own day and by the online day at several
/// development multipliers,
/// then growth by age, condition at kick-off, injuries and retirements are printed.
#[test]
#[ignore = "a measurement, run by hand"]
#[expect(
    clippy::disallowed_methods,
    reason = "a measurement times itself with the wall clock; it is not a rule and feeds no world"
)]
fn measure_online_seasons() {
    // The rules as they stand, at four multipliers; then candidate online wear at 10×.
    let today = Variant::e51(10.0, Recovery::Legacy { rest_days: 0 }, 1, None, SEED);
    let online = |multiplier| {
        Variant::e51(
            multiplier,
            Recovery::Legacy { rest_days: 2 },
            13,
            None,
            SEED,
        )
    };
    let variants = [
        today,
        online(10.0),
        online(12.0),
        online(14.0),
        online(16.0),
        online(18.0),
    ];
    for v in variants {
        let started = std::time::Instant::now();
        let measures = run(v);
        report(v, &measures[&Kind::Bot], None);
        println!("took {:.1} s", started.elapsed().as_secs_f64());
    }
}

/// One number of a kind, averaged over the seeds' runs, and its spread.
fn over_seeds(runs: &[Measures], kind: Kind, read: impl Fn(&Measure) -> f64) -> Vec<f64> {
    runs.iter().map(|m| read(&m[&kind])).collect()
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len().max(1) as f64
}

fn spread(values: &[f64]) -> f64 {
    let centre = mean(values);
    let n = values.len();
    if n < 2 {
        return 0.0;
    }
    (values.iter().map(|x| (x - centre).powi(2)).sum::<f64>() / (n - 1) as f64).sqrt()
}

/// A1–A4 of E5-1 §5.4 for `kind`: blocks against the legacy day, both averaged over the seeds.
fn criteria_a1_a4(legacy: &[Measures], blocks: &[Measures], kind: Kind) -> bool {
    let delta = |read: &dyn Fn(&Measure) -> f64| {
        mean(&over_seeds(blocks, kind, read)) - mean(&over_seeds(legacy, kind, read))
    };
    let injuries = {
        let base = mean(&over_seeds(legacy, kind, Measure::injuries_per_club_season));
        delta(&Measure::injuries_per_club_season) / base.max(f64::EPSILON)
    };
    let checks = [
        ("A1 XI condition", delta(&Measure::kickoff_mean), 2.0),
        (
            "A2 starters < 60 (pp)",
            delta(&Measure::below_60_percent),
            3.0,
        ),
        ("A3 injuries (share)", injuries, 0.10),
        ("A4 ≤19 growth", delta(&Measure::young_growth), 0.3),
    ];
    let mut all = true;
    for (name, value, limit) in checks {
        let ok = value.abs() <= limit;
        all &= ok;
        println!(
            "  {kind:?} {name}: {value:+.3} (limit ±{limit}) {}",
            verdict(ok)
        );
    }
    all
}

/// A5 of E5-1 §5.4: a person's own sessions grow his squad no more than `AutoMax` does. Points
/// are printed, not judged: within a season a fresh squad wins more than a growing one, under any
/// plan, so they measure the cost of training, not what pressing buys (E51-13).
fn criterion_a5(blocks: &[Measures], kind: Kind) -> bool {
    let gap = |read: fn(&Measure) -> f64| -> Vec<f64> {
        over_seeds(blocks, kind, read)
            .iter()
            .zip(over_seeds(blocks, Kind::AutoMax, read))
            .map(|(manual, automatic)| manual - automatic)
            .collect()
    };
    let top18 = gap(Measure::top18);
    let points = gap(Measure::points_per_match);
    // Weaker than AutoMax is always fine; stronger only within the seeds' own spread, and never
    // by more than 0.2 OVR of the eighteen best.
    let top18_ok = mean(&top18) <= 0.0 || (mean(&top18) <= spread(&top18) && mean(&top18) <= 0.2);
    println!(
        "  A5 {kind:?} − AutoMax: top18 {:+.3} (seed spread {:.3}, cap 0.2) {} · points a match {:+.3} (seed spread {:.3}, not judged)",
        mean(&top18),
        spread(&top18),
        verdict(top18_ok),
        mean(&points),
        spread(&points),
    );
    top18_ok
}

fn verdict(ok: bool) -> &'static str {
    if ok { "ok" } else { "FAIL" }
}

/// Given 56 generated clubs in four leagues of six kinds of club, over three seeds,
/// when three online seasons are played by the legacy day and by recovery blocks of 8, 9 and 10
/// hours,
/// then each kind's numbers are printed, and E5-1's criteria are judged: the hours chosen are the
/// fewest at which bots and automatic clubs keep their legacy condition, injuries and growth
/// (A1–A4), and a person's own sessions grow his squad no more than the strongest automatic plan
/// (A5).
#[test]
#[ignore = "a measurement, run by hand"]
#[expect(
    clippy::disallowed_methods,
    reason = "a measurement times itself with the wall clock; it is not a rule and feeds no world"
)]
fn measure_recovery_blocks() {
    let variant = |recovery, seed| Variant::e51(16.0, recovery, 13, Some(&PLACES), seed);
    let started = std::time::Instant::now();
    let legacy: Vec<Measures> = SEEDS
        .iter()
        .map(|seed| run(variant(Recovery::Legacy { rest_days: 2 }, *seed)))
        .collect();
    for (seed, measures) in SEEDS.iter().zip(&legacy) {
        for (kind, m) in measures {
            report(
                variant(Recovery::Legacy { rest_days: 2 }, *seed),
                m,
                Some(*kind),
            );
        }
    }
    let mut chosen = None;
    for hours in [8, 9, 10] {
        let blocks_of = RecoveryBlocks { per_day: 6, hours };
        let runs: Vec<Measures> = SEEDS
            .iter()
            .map(|seed| run(variant(Recovery::Blocks(blocks_of), *seed)))
            .collect();
        for (seed, measures) in SEEDS.iter().zip(&runs) {
            for (kind, m) in measures {
                report(variant(Recovery::Blocks(blocks_of), *seed), m, Some(*kind));
            }
        }
        println!(
            "\n== criteria, 6 blocks of {hours} h, mean of {} seeds ==",
            SEEDS.len()
        );
        // Every kind is judged and printed before the verdict, so no short-circuit here.
        let a1_a4: Vec<bool> = [Kind::Bot, Kind::Auto]
            .into_iter()
            .map(|kind| criteria_a1_a4(&legacy, &runs, kind))
            .collect();
        let a5: Vec<bool> = [Kind::ManualHigh, Kind::ManualSmart]
            .into_iter()
            .map(|kind| criterion_a5(&runs, kind))
            .collect();
        let (a1_a4, a5) = (a1_a4.iter().all(|ok| *ok), a5.iter().all(|ok| *ok));
        println!("  A1–A4 {} · A5 {}", verdict(a1_a4), verdict(a5));
        if a1_a4 && chosen.is_none() {
            chosen = Some((hours, a5));
        }
    }
    match chosen {
        Some((hours, a5)) => println!("\nfewest hours passing A1–A4: {hours} (A5 {})", verdict(a5)),
        None => println!("\nno hours pass A1–A4: stop and report (E51-7)"),
    }
    println!("took {:.1} s", started.elapsed().as_secs_f64());
}

/// Given 56 generated clubs in four leagues of seven kinds of club (E5-4-tech-spec.md §4.1 and its
/// appendix "Bổ sung PO sau E5-4b"), over three seeds, every person's player training the focus
/// that raises his OVR most each day (E54-13),
/// when people press extra sessions at 12:00 and drink bottles by §4.2–§4.3, first seasons from a
/// fresh world at three turns of the places and three fixed seasons (E54-14),
/// then each kind's numbers of §4.4 are printed, E2–E9 judged, and PO's decision tree of stop
/// point Đ2 applied over the grid {40, 1000}, {40, 750}, {40, 500}, {60, 1000} (E54-16), with
/// the bottle levers 1 and 2 only when E6 still fails.
#[test]
#[ignore = "a measurement, run by hand"]
#[expect(
    clippy::disallowed_methods,
    reason = "a measurement times itself with the wall clock; it is not a rule and feeds no world"
)]
fn measure_extra_sessions() {
    let started = std::time::Instant::now();
    extra::decide();
    println!("took {:.1} s", started.elapsed().as_secs_f64());
}
