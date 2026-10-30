//! E5-4b (E5-4-tech-spec.md §4): online seasons where people press extra sessions at 12:00 and
//! drink condition bottles, measured by kind of club against `Auto` (the automatic sessions only)
//! and against `Bot`. The world, days, blocks and matches are E5-1's (`Blocks(8)`, 16×, three
//! seeds, 56 clubs); the kinds of club, the stars, each person's daily best focus (E54-13), the
//! 12:00 step and the samples (E54-14: season 1 from a fresh world, and fixed kinds) are new.
//!
//! Every club but a bot picks its stars at the start of a season (E54-7) and fields them whenever
//! they are fit, so a star's playing time is a starter's under every kind and kinds differ only by
//! the extra sessions. The E2 probe runs one extra session at each intensity on a copy of every
//! player up to 29 at the start of a season; the copies are thrown away.

use std::collections::{BTreeMap, HashMap, HashSet};

use domain::player::{Player, PlayerAttributes};
use domain::staff::Staff;
use domain::team::{TrainingFocus, TrainingIntensity};
use ofm_rules::recovery::RecoveryBlocks;
use ofm_rules::training::{
    BASE_TRAINING_GAIN, ExtraParams, TeamTrainingPlan, TrainingDay, age_factor, extra_session,
    extra_session_rng, extra_sit_out, team_training_plan,
};
use ofm_rules::{age, items, match_form, player_rating, playing_time, season, squad};

use super::{
    Club, DAYS, Kind, LEAGUE, Measure, Measures, Recovery, SEASONS, SEEDS, Variant, kind_measure,
    mean, over_seeds, report, rest_to, run, spread, top18, training_day, verdict,
};

/// The kinds of a league, before the season's turn (§4.1: 6 bots, 2 `Auto`, 1 `Off`, 1
/// `ExtraFree`, 2 `ExtraFreeAll`, 1 `ExtraMax3`, 1 `ExtraMaxAll`).
pub(super) const PLACES_E54: [Kind; LEAGUE] = [
    Kind::Bot,
    Kind::Bot,
    Kind::Bot,
    Kind::Bot,
    Kind::Bot,
    Kind::Bot,
    Kind::Auto,
    Kind::Auto,
    Kind::Off,
    Kind::ExtraFree,
    Kind::ExtraFreeAll,
    Kind::ExtraFreeAll,
    Kind::ExtraMax3,
    Kind::ExtraMaxAll,
];

/// One E5-4b measurement's rules: the extra sessions' `ExtraParams`, the bottle points a player
/// may drink a day (lever 1) and a club a day (lever 2, none by default).
#[derive(Clone, Copy)]
pub(super) struct ExtraRun {
    pub(super) params: ExtraParams,
    pub(super) player_cap: u8,
    pub(super) club_cap: Option<u32>,
}

impl ExtraRun {
    fn with(params: ExtraParams) -> Self {
        Self {
            params,
            player_cap: DRINK_CAP,
            club_cap: None,
        }
    }

    fn describe(self) -> String {
        format!(
            "ExtraParams {{ floor: {}, dev_permille: {} }}, bottle points a player a day {}, a club a day {}",
            self.params.floor,
            self.params.dev_permille,
            self.player_cap,
            self.club_cap
                .map_or("none".to_string(), |cap| cap.to_string())
        )
    }
}

/// The kinds printed, in this order.
const KINDS: [Kind; 7] = [
    Kind::Bot,
    Kind::Auto,
    Kind::Off,
    Kind::ExtraFree,
    Kind::ExtraFreeAll,
    Kind::ExtraMax3,
    Kind::ExtraMaxAll,
];

/// Low, Medium, High: a session's condition cost and how much it builds (`training.rs`).
const INTENSITY_NAMES: [&str; 3] = ["Low", "Medium", "High"];
const COST: [u8; 3] = [3, 6, 10];
const BUILD: [f64; 3] = [0.5, 1.0, 1.5];
const HIGH: usize = 2;

/// The condition on a bottle's label (`energyDrinkSmall`, `energyDrinkLarge`) and its price in
/// the current `price_list` (§4.2).
const SMALL: u8 = 15;
const LARGE: u8 = 35;
const SMALL_COINS: u32 = 5;
const LARGE_COINS: u32 = 12;
/// Bottle points a player may drink a day, by the labels (Qe54-3, R28-1).
const DRINK_CAP: u8 = 35;
/// §4.3 step 1: a large bottle at this condition or under, otherwise a small one at this or under;
/// neither is ever cut at 100.
const LARGE_AT: u8 = 65;
const SMALL_AT: u8 = 85;
/// The free bottles of the "Vừa" level (§4.2): a small one every day at 04:00, the event's small
/// ones and large ones on these days. 580 points a season.
const EVENT_SMALL_DAYS: [u32; 6] = [4, 8, 12, 16, 20, 24];
const EVENT_LARGE_DAYS: [u32; 2] = [10, 20];

/// A star is picked among players this old or younger (E54-7).
const STAR_AGE: i32 = 23;
/// The probe runs on players this old or younger (§4.4).
const PROBE_AGE: i32 = 29;
/// A star's season counts as done when he gains this much, if his potential does not stop him
/// first (E5).
const STAR_GAIN_TARGET: u8 = 18;
/// "Đá chính" of the probe (E54-6): `REGULAR_PLAYING_TIME`, a full development factor.
const REGULAR: u8 = 80;
/// §4.3 step 3: what a likely starter must keep after a session on a match day and on the days
/// before the first round.
const MATCH_DAY_KEEP: i32 = 75;
const NO_MATCH_KEEP: i32 = 40;
const FIRST_MATCH_DAY: u32 = 2;

/// E8: the most coins a season a club may usefully spend (25 times the free coins).
const COIN_CEILING: f64 = 2500.0;
/// E9 is set beside the gate's largest gap within a league.
const G_MAX: f64 = 10.0;

fn intensity(k: usize) -> TrainingIntensity {
    match k {
        0 => TrainingIntensity::Low,
        1 => TrainingIntensity::Medium,
        _ => TrainingIntensity::High,
    }
}

/// How many stars a kind picks; a bot none.
fn star_count(kind: Kind) -> usize {
    match kind {
        Kind::Bot => 0,
        Kind::ExtraMax3 => 3,
        _ => 1,
    }
}

fn presses(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::ExtraFree | Kind::ExtraFreeAll | Kind::ExtraMax3 | Kind::ExtraMaxAll
    )
}

fn presses_everyone(kind: Kind) -> bool {
    matches!(kind, Kind::ExtraFreeAll | Kind::ExtraMaxAll)
}

fn free_bottles(kind: Kind) -> bool {
    matches!(kind, Kind::ExtraFree | Kind::ExtraFreeAll)
}

fn buys_bottles(kind: Kind) -> bool {
    matches!(kind, Kind::ExtraMax3 | Kind::ExtraMaxAll)
}

/// A player's age on `date`; a date of birth that cannot be read counts as 25, as in training.
fn age_of(player: &Player, date: &str) -> i32 {
    age::age_on(&player.date_of_birth, date).map_or(25, |a| a.max(0))
}

/// ≤ 21, 22–25, 26–29, 30+ (§4.4).
fn band(age: i32) -> usize {
    match age {
        ..=21 => 0,
        22..=25 => 1,
        26..=29 => 2,
        _ => 3,
    }
}

const BAND_NAMES: [&str; 4] = ["≤21", "22–25", "26–29", "30+"];

fn plan_of(club: &Club) -> TeamTrainingPlan {
    let staff: Vec<&Staff> = club.staff.iter().collect();
    team_training_plan(&club.team, &staff, None)
}

/// One of a club's first stars of a season.
struct FirstStar {
    id: String,
    ovr: u8,
    /// The first day (0-based) he reached his potential or `STAR_GAIN_TARGET` more.
    reached: Option<u32>,
}

/// A club's stars and free bottles over a season.
#[derive(Default)]
pub(super) struct ClubExtra {
    /// Today's stars.
    stars: Vec<String>,
    /// Every player who may be a star this season, the largest room to grow first (E54-7).
    queue: Vec<String>,
    /// The next of `queue` to try when a star peaks.
    next: usize,
    first: Vec<FirstStar>,
    /// The eighteen best at the season's start: (id, OVR, age), for the split by age.
    top18_start: Vec<(String, u8, i32)>,
    small: u32,
    large: u32,
}

/// Sums of OVR change and attributes up over a count of sessions.
#[derive(Default, Clone, Copy)]
struct Tally {
    ovr: f64,
    gains: f64,
    n: u32,
}

impl Tally {
    fn add(&mut self, ovr: i32, gains: u8) {
        self.ovr += f64::from(ovr);
        self.gains += f64::from(gains);
        self.n += 1;
    }

    fn merge(&mut self, other: Tally) {
        self.ovr += other.ovr;
        self.gains += other.gains;
        self.n += other.n;
    }

    fn ovr_per_session(self) -> f64 {
        self.ovr / f64::from(self.n.max(1))
    }

    fn gains_per_session(self) -> f64 {
        self.gains / f64::from(self.n.max(1))
    }
}

/// What a kind of club did with extra sessions and bottles, summed over its club-seasons.
#[derive(Default)]
pub(super) struct ExtraMeasure {
    /// (intensity, age band, starter) → the probe's sessions.
    probe: BTreeMap<(usize, usize, bool), Tally>,
    probe_sat_out: u32,
    /// (intensity, age band, in the likely XI) → the sessions pressed.
    pressed: BTreeMap<(usize, usize, bool), Tally>,
    /// (intensity, ≤ 21 / 22–24 / older, starter by playing time ≥ 80) → (sessions with at least
    /// one attribute up, sessions): how often a press shows a gain to the player.
    feel: BTreeMap<(usize, usize, bool), (u32, u32)>,
    /// Club sessions (`n` of the day), summed.
    club_sessions: u32,
    star_sessions: u32,
    potential_raised: u32,
    /// Each first star's OVR change over a season.
    star_growth: Vec<f64>,
    star_days: Vec<Option<u32>>,
    /// The season of each entry of `star_growth` and `star_days`.
    star_season: Vec<u32>,
    /// Each first star's attributes of the clubs' focus (Technical) at 99 at the season's end,
    /// out of those he has: a focus at its ceiling builds nothing more.
    star_focus_capped: Vec<(u32, u32)>,
    star_playing_time: (f64, u32),
    kickoff_fitness: (f64, u32),
    small: u32,
    large: u32,
    wasted_points: u32,
    coins: u32,
    /// Season → (sum of the change in the eighteen best's mean OVR, clubs).
    top18_by_season: BTreeMap<u32, (f64, u32)>,
    stars_left: (u32, u32),
    /// Summed over club-seasons: the change of the start's eighteen best, over 18, from players
    /// up to `YOUNG_UNTIL` and from older ones (printed for E5-5's brake on the young).
    top18_by_age: [f64; 2],
    /// A buying club's (bottle points, coins) of each day, for a cap a club a day (E8 (c)).
    club_days: Vec<(u32, u32)>,
}

/// The start of a season for every club: a bot's players lose any focus of their own, a person's
/// take the best one (E54-13); then the probe on copies, the stars and an empty stock.
pub(super) fn open_season(
    clubs: &mut [Club],
    (season_number, football_year): (u32, u32),
    v: Variant,
    extra_run: ExtraRun,
    m: &mut Measures,
) {
    let params = extra_run.params;
    let day0 = training_day(football_year, 0, v.multiplier);
    let key = season::day_key(season_number, 0);
    for club in clubs.iter_mut() {
        if club.kind == Kind::Bot {
            for player in &mut club.players {
                player.training_focus = None;
            }
        }
        choose_focus(club);
        let measure = &mut kind_measure(m, club.kind).extra;
        probe(club, &day0, &key, (v.seed, params), measure);
        pick_stars(club, &day0.date);
        club.extra.top18_start = best_eighteen(club, &day0.date);
    }
}

/// §4.4: one extra session at each intensity on a copy of every player up to `PROBE_AGE`, with
/// the dice of the day's first extra session, on his own playing time.
fn probe(
    club: &Club,
    day0: &TrainingDay,
    key: &str,
    (seed, params): (u64, ExtraParams),
    measure: &mut ExtraMeasure,
) {
    let plan = plan_of(club);
    for player in &club.players {
        let age = age_of(player, &day0.date);
        if age > PROBE_AGE {
            continue;
        }
        let starter = player.playing_time >= REGULAR;
        for k in 0..INTENSITY_NAMES.len() {
            let mut copy = player.clone();
            let mut rng = extra_session_rng(seed, &player.id, key, 1);
            let outcome = extra_session(&mut copy, &plan, day0, intensity(k), &params, &mut rng);
            if outcome.sat_out.is_some() {
                // The reason does not depend on the intensity: count him once.
                measure.probe_sat_out += 1;
                break;
            }
            let change = i32::from(copy.ovr) - i32::from(player.ovr);
            measure
                .probe
                .entry((k, band(age), starter))
                .or_default()
                .add(change, outcome.gains);
        }
    }
}

/// (Technical attributes at 99, Technical attributes he has): the nine a Technical session rolls,
/// a split one counting only when it is not 0 (`try_gain_split`).
fn technical_capped(player: &Player) -> (u32, u32) {
    let a = &player.attributes;
    let plain = [a.passing, a.shooting, a.dribbling];
    let split = [
        a.long_passing,
        a.crossing,
        a.curve,
        a.free_kick,
        a.long_shots,
        a.first_touch,
    ];
    let rolled: Vec<u8> = plain
        .into_iter()
        .chain(split.into_iter().filter(|v| *v != 0))
        .collect();
    let capped = rolled.iter().filter(|v| **v >= 99).count();
    (capped as u32, rolled.len() as u32)
}

/// The focuses a session can build, in the enum's order (E54-13 breaks ties by it).
const FOCUSES: [TrainingFocus; 5] = [
    TrainingFocus::Physical,
    TrainingFocus::Technical,
    TrainingFocus::Tactical,
    TrainingFocus::Defending,
    TrainingFocus::Attacking,
];

/// `attributes` with one point more on every attribute `focus` rolls that is still under 99; a
/// split attribute only when he has it (`training.rs` `apply_focus_gains`, `try_gain_split`).
fn one_more_of(attributes: &PlayerAttributes, focus: &TrainingFocus) -> PlayerAttributes {
    let mut a = attributes.clone();
    let up = |value: &mut u8, split: bool| {
        if *value < 99 && !(split && *value == 0) {
            *value += 1;
        }
    };
    match focus {
        TrainingFocus::Physical => {
            for value in [&mut a.pace, &mut a.stamina, &mut a.strength, &mut a.agility] {
                up(value, false);
            }
        }
        TrainingFocus::Technical => {
            for value in [&mut a.passing, &mut a.shooting, &mut a.dribbling] {
                up(value, false);
            }
            for value in [
                &mut a.long_passing,
                &mut a.crossing,
                &mut a.curve,
                &mut a.free_kick,
                &mut a.long_shots,
                &mut a.first_touch,
            ] {
                up(value, true);
            }
        }
        TrainingFocus::Tactical => {
            for value in [
                &mut a.positioning,
                &mut a.vision,
                &mut a.decisions,
                &mut a.composure,
            ] {
                up(value, false);
            }
        }
        TrainingFocus::Defending => {
            for value in [
                &mut a.tackling,
                &mut a.defending,
                &mut a.strength,
                &mut a.positioning,
            ] {
                up(value, false);
            }
            up(&mut a.heading, true);
        }
        TrainingFocus::Attacking => {
            for value in [&mut a.shooting, &mut a.dribbling, &mut a.pace] {
                up(value, false);
            }
            for value in [&mut a.long_shots, &mut a.first_touch, &mut a.heading] {
                up(value, true);
            }
        }
        TrainingFocus::Recovery => {}
    }
    a
}

/// E54-13, a measurement assumption and not a rule of the game: the focus (never Recovery) whose
/// one point more on each of its attributes under 99 raises the player's OVR at his position
/// most; a tie keeps the focus he has, then goes by the enum's order.
fn best_focus(player: &Player, current: &TrainingFocus) -> TrainingFocus {
    let position = player_rating::primary_position(player);
    let now = player_rating::ovr_from_attributes(&player.attributes, &position);
    let rise = |focus: &TrainingFocus| {
        player_rating::ovr_from_attributes(&one_more_of(&player.attributes, focus), &position) - now
    };
    let mut best = (current.clone(), rise(current));
    for focus in &FOCUSES {
        let value = rise(focus);
        if value > best.1 + 1e-9 {
            best = (focus.clone(), value);
        }
    }
    best.0
}

/// Every day before the automatic session, a person's every player takes his best focus
/// (E54-13); a bot keeps the AI's plan (E5-1).
pub(super) fn choose_focus(club: &mut Club) {
    if club.kind == Kind::Bot {
        return;
    }
    let team_focus = club.team.training_focus.clone();
    for player in &mut club.players {
        let current = match player.training_focus.clone() {
            Some(TrainingFocus::Recovery) | None => team_focus.clone(),
            Some(focus) => focus,
        };
        player.training_focus = Some(best_focus(player, &current));
    }
}

/// The age up to which E5-5 would brake a player (its young band), for the printed split.
const YOUNG_UNTIL: i32 = 24;

/// A club's eighteen best by OVR at the start of a season, with their OVR and age then.
fn best_eighteen(club: &Club, date: &str) -> Vec<(String, u8, i32)> {
    let mut best: Vec<&Player> = club.players.iter().collect();
    best.sort_by(|a, b| b.ovr.cmp(&a.ovr).then_with(|| a.id.cmp(&b.id)));
    best.iter()
        .take(18)
        .map(|p| (p.id.clone(), p.ovr, age_of(p, date)))
        .collect()
}

fn room(player: &Player) -> i16 {
    i16::from(player.potential) - i16::from(player.ovr)
}

/// E54-7: the young fit players by room to grow (ties to the smaller id), and the first of them
/// who can still grow as stars.
fn pick_stars(club: &mut Club, date: &str) {
    let mut young: Vec<&Player> = club
        .players
        .iter()
        .filter(|p| p.injury.is_none() && age_of(p, date) <= STAR_AGE)
        .collect();
    young.sort_by(|a, b| room(b).cmp(&room(a)).then_with(|| a.id.cmp(&b.id)));
    club.extra = ClubExtra {
        queue: young.iter().map(|p| p.id.clone()).collect(),
        ..ClubExtra::default()
    };
    fill_stars(club);
    club.extra.first = club
        .extra
        .stars
        .iter()
        .filter_map(|id| club.players.iter().find(|p| &p.id == id))
        .map(|p| FirstStar {
            id: p.id.clone(),
            ovr: p.ovr,
            reached: None,
        })
        .collect();
}

/// Tops the stars up to the kind's number from the queue, skipping anyone already at potential.
fn fill_stars(club: &mut Club) {
    let wanted = star_count(club.kind);
    while club.extra.stars.len() < wanted && club.extra.next < club.extra.queue.len() {
        let id = club.extra.queue[club.extra.next].clone();
        club.extra.next += 1;
        if club
            .players
            .iter()
            .any(|p| p.id == id && p.ovr < p.potential)
        {
            club.extra.stars.push(id);
        }
    }
}

/// After the 04:00 job of `day`: the day's free bottles, and a star who peaked replaced.
pub(super) fn morning(club: &mut Club, day: u32) {
    if club.kind == Kind::Bot {
        return;
    }
    if free_bottles(club.kind) {
        club.extra.small += 1 + u32::from(EVENT_SMALL_DAYS.contains(&day));
        club.extra.large += u32::from(EVENT_LARGE_DAYS.contains(&day));
    }
    let players = &club.players;
    club.extra
        .stars
        .retain(|id| players.iter().any(|p| &p.id == id && p.ovr < p.potential));
    fill_stars(club);
}

/// What one press of the day shares: the plan, the day, its key and the world's dice.
struct PressDay<'a> {
    plan: &'a TeamTrainingPlan,
    day: &'a TrainingDay,
    key: &'a str,
    seed: u64,
    params: ExtraParams,
}

/// §4.3, at 12:00 of `day`: rest to the press, bottles, then rounds of extra sessions until no one
/// may take another.
pub(super) fn press(
    club: &mut Club,
    at: i64,
    (season_number, day, football_year): (u32, u32, u32),
    v: Variant,
    extra_run: ExtraRun,
    measure: &mut Measure,
) {
    let params = extra_run.params;
    if !presses(club.kind) {
        return;
    }
    let Recovery::Blocks(blocks_of) = v.recovery else {
        return;
    };
    let today = training_day(football_year, day, v.multiplier);
    rest_to(club, at, &blocks_of, &today.date);
    let plan = plan_of(club);
    let order = pressers(club);
    drink(club, &order, extra_run, &mut measure.extra);
    let likely = likely_eleven(club);
    let choices: Vec<(usize, usize)> = order
        .iter()
        .map(|&i| (i, best_intensity(&club.players[i], &plan, &today, params)))
        .collect();
    let key = season::day_key(season_number, day);
    let ctx = PressDay {
        plan: &plan,
        day: &today,
        key: &key,
        seed: v.seed,
        params,
    };
    let keep = |in_xi: bool| match (in_xi, day >= FIRST_MATCH_DAY) {
        (true, true) => MATCH_DAY_KEEP,
        (true, false) => NO_MATCH_KEEP,
        (false, _) => i32::from(params.floor),
    };
    let mut n = 0;
    loop {
        let mut pressed = false;
        for (k, cost) in COST.iter().enumerate() {
            let group: Vec<usize> = choices
                .iter()
                .filter(|(_, choice)| *choice == k)
                .map(|(i, _)| *i)
                .filter(|&i| {
                    let player = &club.players[i];
                    let floor = keep(likely.contains(&player.id));
                    extra_sit_out(player, &plan, &params).is_none()
                        && i32::from(player.condition) - i32::from(*cost) >= floor
                })
                .collect();
            if group.is_empty() {
                continue;
            }
            n += 1;
            pressed = true;
            for i in group {
                let in_xi = likely.contains(&club.players[i].id);
                let is_star = club.extra.stars.contains(&club.players[i].id);
                let player = &mut club.players[i];
                press_one(&ctx, player, (k, n), (in_xi, is_star), &mut measure.extra);
            }
        }
        if !pressed {
            break;
        }
    }
    measure.extra.club_sessions += n;
}

/// The players a kind presses for (its stars, or everyone), as indices in `id` order.
fn pressers(club: &Club) -> Vec<usize> {
    let mut order: Vec<usize> = (0..club.players.len())
        .filter(|&i| presses_everyone(club.kind) || club.extra.stars.contains(&club.players[i].id))
        .collect();
    order.sort_by(|&a, &b| club.players[a].id.cmp(&club.players[b].id));
    order
}

/// The selector's condition-free first choice, plus the stars (§4.3 step 3).
fn likely_eleven(club: &Club) -> HashSet<String> {
    let available: Vec<&Player> = club.players.iter().filter(|p| p.injury.is_none()).collect();
    let mut ids: HashSet<String> = squad::first_choice_eleven(&available, &club.team.formation)
        .iter()
        .map(|p| p.id.clone())
        .collect();
    ids.extend(club.extra.stars.iter().cloned());
    ids
}

/// One bottle of `size` from the club's stock, or bought; false when the stock has none.
fn take(extra: &mut ClubExtra, kind: Kind, size: u8) -> bool {
    if buys_bottles(kind) {
        return true;
    }
    let stock = if size == LARGE {
        &mut extra.large
    } else {
        &mut extra.small
    };
    if *stock == 0 {
        return false;
    }
    *stock -= 1;
    true
}

/// §4.3 step 1: the drinkers of the kind (the stars; everyone pressed for `ExtraMaxAll`), fit and
/// still growing, each up to the day's cap.
fn drink(club: &mut Club, order: &[usize], extra_run: ExtraRun, measure: &mut ExtraMeasure) {
    let kind = club.kind;
    let (mut day_points, mut day_coins) = (0u32, 0u32);
    // Lever 2: the club's bottle points of the day, by the labels.
    let club_cap = extra_run.club_cap.unwrap_or(u32::MAX);
    let mut club_points = 0u32;
    for &i in order {
        let player = &club.players[i];
        let drinks = kind == Kind::ExtraMaxAll || club.extra.stars.contains(&player.id);
        if !drinks || player.injury.is_some() || player.ovr >= player.potential {
            continue;
        }
        let extra = &mut club.extra;
        let drunk = pour(&mut club.players[i], extra_run.player_cap, |size| {
            if club_points + u32::from(size) > club_cap || !take(extra, kind, size) {
                return false;
            }
            club_points += u32::from(size);
            true
        });
        for size in drunk {
            day_points += u32::from(size);
            let price = if size == LARGE {
                measure.large += 1;
                LARGE_COINS
            } else {
                measure.small += 1;
                SMALL_COINS
            };
            if buys_bottles(kind) {
                day_coins += price;
            }
        }
    }
    measure.coins += day_coins;
    if buys_bottles(kind) {
        measure.club_days.push((day_points, day_coins));
    }
}

/// §4.3 step 1 for one player: a large bottle at `LARGE_AT` or under, then small ones at
/// `SMALL_AT` or under, while `cap`, the player's bottle points a day by the labels, allows. `take`
/// hands a bottle of a size over, or says there is none. Returns the sizes drunk.
fn pour(player: &mut Player, cap: u8, mut take: impl FnMut(u8) -> bool) -> Vec<u8> {
    let mut taken = 0u8;
    let mut drunk = Vec::new();
    if player.condition <= LARGE_AT && LARGE <= cap && take(LARGE) {
        items::boost_condition(player, LARGE);
        taken += LARGE;
        drunk.push(LARGE);
    }
    while taken + SMALL <= cap && player.condition <= SMALL_AT && take(SMALL) {
        items::boost_condition(player, SMALL);
        taken += SMALL;
        drunk.push(SMALL);
    }
    drunk
}

/// §4.3 step 2 (P-2): the intensity with the most expected attribute points per point of
/// condition, `min(gain, 1) / cost`, ties to the lighter. `gain` is the player's own chance per
/// attribute as `training.rs` `develop` computes it.
fn best_intensity(
    player: &Player,
    plan: &TeamTrainingPlan,
    day: &TrainingDay,
    params: ExtraParams,
) -> usize {
    let age = u32::try_from(age_of(player, &day.date)).unwrap_or(0);
    let gain = BASE_TRAINING_GAIN
        * day.development_multiplier
        * age_factor(age)
        * plan.bonus.coaching_mult
        * plan.bonus.specialization_mult
        * plan.training_facility_mult
        * playing_time::development_factor(player.playing_time)
        * match_form::development_factor(player.match_form)
        * f64::from(params.dev_permille)
        / 1000.0;
    best_for_gain(gain)
}

/// The intensity (0 Low, 1 Medium, 2 High) with the most `min(gain × build, 1) / cost`, ties to
/// the lighter.
fn best_for_gain(gain: f64) -> usize {
    let mut best = (0, f64::MIN);
    for (k, (build, cost)) in BUILD.iter().zip(COST).enumerate() {
        let value = (gain * build).min(1.0) / f64::from(cost);
        // Low and Medium tie exactly below a gain of 1; rounding must not break the tie.
        if value > best.1 + 1e-9 {
            best = (k, value);
        }
    }
    best.0
}

/// One extra session of one player, recorded (§4.3 step 4).
fn press_one(
    ctx: &PressDay<'_>,
    player: &mut Player,
    (k, n): (usize, u32),
    (in_xi, is_star): (bool, bool),
    measure: &mut ExtraMeasure,
) {
    let age = age_of(player, &ctx.day.date);
    let (ovr, potential) = (player.ovr, player.potential);
    let starter = player.playing_time >= REGULAR;
    let mut rng = extra_session_rng(ctx.seed, &player.id, ctx.key, n);
    let outcome = extra_session(
        player,
        ctx.plan,
        ctx.day,
        intensity(k),
        &ctx.params,
        &mut rng,
    );
    assert!(
        outcome.sat_out.is_none(),
        "the policy only presses players who take part"
    );
    measure
        .pressed
        .entry((k, band(age), in_xi))
        .or_default()
        .add(i32::from(player.ovr) - i32::from(ovr), outcome.gains);
    measure.potential_raised += u32::from(player.potential > potential);
    measure.star_sessions += u32::from(is_star);
    let feel = measure
        .feel
        .entry((k, feel_band(age), starter))
        .or_default();
    feel.0 += u32::from(outcome.gains > 0);
    feel.1 += 1;
}

/// ≤ 21, 22–24, older: the bands of the feel check (user's decision of 2026-10-31).
fn feel_band(age: i32) -> usize {
    match age {
        ..=21 => 0,
        22..=24 => 1,
        _ => 2,
    }
}

/// At the end of `day`: the first day each first star reached his potential or +18.
pub(super) fn track_stars(club: &mut Club, day: u32) {
    for star in club.extra.first.iter_mut().filter(|s| s.reached.is_none()) {
        let Some(player) = club.players.iter().find(|p| p.id == star.id) else {
            continue;
        };
        if player.ovr >= player.potential || player.ovr >= star.ovr.saturating_add(STAR_GAIN_TARGET)
        {
            star.reached = Some(day);
        }
    }
}

/// P-3: a fit star the selector left out takes the place of the starter of his position group
/// with the lowest OVR. Only the bridge's own output is reordered; nothing is built here.
pub(super) fn field_stars(
    club: &Club,
    side: &mut engine::TeamData,
    bench: &mut [engine::PlayerData],
) {
    if club.kind == Kind::Bot {
        return;
    }
    let ovr: HashMap<&str, u8> = club
        .players
        .iter()
        .map(|p| (p.id.as_str(), p.ovr))
        .collect();
    for star in &club.extra.stars {
        if side.players.iter().any(|p| &p.id == star) {
            continue;
        }
        // An injured star is not on the bench: the bench is the fit players left out.
        let Some(at) = bench.iter().position(|p| &p.id == star) else {
            continue;
        };
        let group = bench[at].position;
        let out = side
            .players
            .iter()
            .enumerate()
            .filter(|(_, p)| p.position == group && !club.extra.stars.contains(&p.id))
            .min_by(|(_, a), (_, b)| {
                let rating = |p: &engine::PlayerData| ovr.get(p.id.as_str()).copied().unwrap_or(0);
                rating(a).cmp(&rating(b)).then_with(|| a.id.cmp(&b.id))
            })
            .map(|(slot, _)| slot);
        if let Some(slot) = out {
            std::mem::swap(&mut side.players[slot], &mut bench[at]);
        }
    }
}

/// At kick-off: the eleven's fitness (N-7) and the stars' playing time.
pub(super) fn kickoff(club: &Club, side: &engine::TeamData, measure: &mut Measure) {
    let by_id: HashMap<&str, &Player> = club.players.iter().map(|p| (p.id.as_str(), p)).collect();
    let fitness: Vec<f64> = side
        .players
        .iter()
        .filter_map(|p| by_id.get(p.id.as_str()))
        .map(|p| f64::from(p.fitness))
        .collect();
    let e = &mut measure.extra;
    if !fitness.is_empty() {
        e.kickoff_fitness.0 += fitness.iter().sum::<f64>() / fitness.len() as f64;
        e.kickoff_fitness.1 += 1;
    }
    for star in &club.extra.stars {
        if let Some(p) = by_id.get(star.as_str()) {
            e.star_playing_time.0 += f64::from(p.playing_time);
            e.star_playing_time.1 += 1;
        }
    }
}

/// Before aging: each kind's eighteen best by season, its first stars, bottles left, stars left.
pub(super) fn close_season(
    clubs: &[Club],
    season_number: u32,
    start_top18: &[f64],
    m: &mut Measures,
) {
    for (club, at_start) in clubs.iter().zip(start_top18) {
        let e = &mut kind_measure(m, club.kind).extra;
        let entry = e.top18_by_season.entry(season_number).or_default();
        entry.0 += top18(&club.players) - at_start;
        entry.1 += 1;
        for (id, ovr, age) in &club.extra.top18_start {
            if let Some(p) = club.players.iter().find(|p| &p.id == id) {
                let slot = usize::from(*age > YOUNG_UNTIL);
                e.top18_by_age[slot] += (f64::from(p.ovr) - f64::from(*ovr)) / 18.0;
            }
        }
        if club.kind == Kind::Bot {
            continue;
        }
        for star in &club.extra.first {
            if let Some(p) = club.players.iter().find(|p| p.id == star.id) {
                e.star_growth.push(f64::from(p.ovr) - f64::from(star.ovr));
                e.star_days.push(star.reached);
                e.star_season.push(season_number);
                e.star_focus_capped.push(technical_capped(p));
            }
        }
        e.wasted_points +=
            club.extra.small * u32::from(SMALL) + club.extra.large * u32::from(LARGE);
        let left = club.extra.queue[club.extra.next..]
            .iter()
            .filter(|id| {
                club.players
                    .iter()
                    .any(|p| &p.id == *id && p.ovr < p.potential)
            })
            .count();
        e.stars_left.0 += left as u32;
        e.stars_left.1 += 1;
    }
}

// ---------------------------------------------------------------------------------------------
// The report (§4.4) and the criteria (§4.5).

fn per_club_season(m: &Measure, value: f64) -> f64 {
    value / f64::from(m.club_seasons.max(1))
}

fn star_growth(m: &Measure) -> f64 {
    mean(&m.extra.star_growth)
}

fn kickoff_fitness(m: &Measure) -> f64 {
    m.extra.kickoff_fitness.0 / f64::from(m.extra.kickoff_fitness.1.max(1))
}

fn star_playing_time(m: &Measure) -> f64 {
    m.extra.star_playing_time.0 / f64::from(m.extra.star_playing_time.1.max(1))
}

fn coins(m: &Measure) -> f64 {
    per_club_season(m, f64::from(m.extra.coins))
}

/// The eighteen best's change summed over the seasons: a club changes kind every season, so this
/// is the sum of each season's mean.
fn top18_cumulative(m: &Measure) -> f64 {
    m.extra
        .top18_by_season
        .values()
        .map(|(sum, n)| sum / f64::from((*n).max(1)))
        .sum()
}

/// `kind − base` of `read`, seed by seed.
fn gap(runs: &[Measures], kind: Kind, base: Kind, read: fn(&Measure) -> f64) -> Vec<f64> {
    over_seeds(runs, kind, read)
        .iter()
        .zip(over_seeds(runs, base, read))
        .map(|(a, b)| a - b)
        .collect()
}

fn mean_spread(values: &[f64]) -> String {
    format!("{:+.2} (±{:.2})", mean(values), spread(values))
}

/// The median of the days, a day never reached counting as after the season; `None` when the
/// median itself was never reached.
fn median_day(days: &[Option<u32>]) -> Option<u32> {
    let mut sorted: Vec<u32> = days.iter().map(|d| d.unwrap_or(u32::MAX)).collect();
    sorted.sort_unstable();
    sorted
        .get(sorted.len() / 2)
        .copied()
        .filter(|d| *d != u32::MAX)
}

/// `gap` of a reading that depends on more than the measure (a season).
fn gap_of(runs: &[Measures], kind: Kind, base: Kind, read: &dyn Fn(&Measure) -> f64) -> Vec<f64> {
    over_seeds(runs, kind, read)
        .iter()
        .zip(over_seeds(runs, base, read))
        .map(|(a, b)| a - b)
        .collect()
}

fn top18_in(m: &Measure, season_number: u32) -> f64 {
    m.extra
        .top18_by_season
        .get(&season_number)
        .map_or(0.0, |(sum, n)| sum / f64::from((*n).max(1)))
}

fn star_growth_in(m: &Measure, season_number: u32) -> f64 {
    let values: Vec<f64> = m
        .extra
        .star_growth
        .iter()
        .zip(&m.extra.star_season)
        .filter(|(_, s)| **s == season_number)
        .map(|(g, _)| *g)
        .collect();
    mean(&values)
}

/// E3–E6 and E9 season by season of the runs where every club keeps its kind (printed only:
/// the criteria read season 1 from a fresh world, E54-14).
fn print_by_season(runs: &[Measures]) {
    println!("\n-- E3–E6, E9 season by season, kinds kept (mean of seeds; printed) --");
    for season_number in 1..=SEASONS {
        let top = |kind, base| {
            mean(&gap_of(runs, kind, base, &|m: &Measure| {
                top18_in(m, season_number)
            }))
        };
        let star = mean(&gap_of(
            runs,
            Kind::ExtraFree,
            Kind::Auto,
            &|m: &Measure| star_growth_in(m, season_number),
        ));
        let days: Vec<Option<u32>> = runs
            .iter()
            .flat_map(|r| {
                let e = &r[&Kind::ExtraMax3].extra;
                e.star_days
                    .iter()
                    .zip(&e.star_season)
                    .filter(|(_, s)| **s == season_number)
                    .map(|(d, _)| *d)
                    .collect::<Vec<_>>()
            })
            .collect();
        println!(
            "  s{season_number}: E3 {star:+.2} · E4 Free {:+.2} · E4 FreeAll {:+.2} · E5 {} · E6 {:+.2} · E9 MaxAll−Bot {:+.2}, FreeAll−Bot {:+.2}",
            top(Kind::ExtraFree, Kind::Auto),
            top(Kind::ExtraFreeAll, Kind::Auto),
            describe_day(median_day(&days)),
            top(Kind::ExtraMaxAll, Kind::Auto),
            top(Kind::ExtraMaxAll, Kind::Bot),
            top(Kind::ExtraFreeAll, Kind::Bot),
        );
    }
}

fn star_days(runs: &[Measures], kind: Kind) -> Vec<Option<u32>> {
    runs.iter()
        .flat_map(|m| m[&kind].extra.star_days.iter().copied())
        .collect()
}

fn describe_day(day: Option<u32>) -> String {
    // Day 0 is the season's first: reached on index d is d + 1 days into the season.
    day.map_or(format!("not in the season (> {DAYS})"), |d| {
        format!("{}", d + 1)
    })
}

fn print_probe(runs: &[Measures]) {
    let mut pooled: BTreeMap<(usize, usize, bool), Tally> = BTreeMap::new();
    let mut sat_out = 0;
    for m in runs.iter().flat_map(|r| r.values()) {
        sat_out += m.extra.probe_sat_out;
        for (key, tally) in &m.extra.probe {
            pooled.entry(*key).or_default().merge(*tally);
        }
    }
    println!(
        "\n-- E2 probe: one extra session on a copy, every club, {} seeds × {SEASONS} seasons ({sat_out} copies sat out, not counted) --",
        runs.len()
    );
    println!("  intensity  age     starter (pt ≥ 80)                    not a starter");
    for (k, name) in INTENSITY_NAMES.iter().enumerate() {
        for (b, band_name) in BAND_NAMES.iter().take(3).enumerate() {
            let cell = |starter| {
                pooled.get(&(k, b, starter)).map_or("–".to_string(), |t| {
                    format!(
                        "ΔOVR {:.3}, +1s {:.2} (n={})",
                        t.ovr_per_session(),
                        t.gains_per_session(),
                        t.n
                    )
                })
            };
            println!(
                "  {name:<9}  {band_name:<6}  {:<36} {}",
                cell(true),
                cell(false)
            );
        }
    }
    for kind in KINDS {
        let values: Vec<f64> = runs
            .iter()
            .map(|r| {
                r[&kind]
                    .extra
                    .probe
                    .get(&(HIGH, 0, true))
                    .map_or(0.0, |t| t.ovr_per_session())
            })
            .collect();
        println!(
            "  {kind:?}: High, ≤21, starter ΔOVR a session {:.3} (seed spread {:.3})",
            mean(&values),
            spread(&values)
        );
    }
}

/// E2: High, ≤ 21, starter, every club pooled; and the value seed by seed.
fn e2_value(runs: &[Measures]) -> (f64, Vec<f64>) {
    let tally_of = |r: &Measures| {
        let mut t = Tally::default();
        for m in r.values() {
            if let Some(cell) = m.extra.probe.get(&(HIGH, 0, true)) {
                t.merge(*cell);
            }
        }
        t
    };
    let mut pooled = Tally::default();
    let mut by_seed = Vec::new();
    for r in runs {
        let t = tally_of(r);
        by_seed.push(t.ovr_per_session());
        pooled.merge(t);
    }
    (pooled.ovr_per_session(), by_seed)
}

fn print_kind(runs: &[Measures], kind: Kind) {
    let read = |f: fn(&Measure) -> f64| over_seeds(runs, kind, f);
    let sessions = |k: usize| -> fn(&Measure) -> f64 {
        match k {
            0 => |m| per_club_season(m, pressed_sessions(m, 0)),
            1 => |m| per_club_season(m, pressed_sessions(m, 1)),
            _ => |m| per_club_season(m, pressed_sessions(m, 2)),
        }
    };
    println!(
        "\n-- {kind:?} (mean of {} seeds, ± seed spread) --",
        runs.len()
    );
    println!(
        "  top18 a season {} · vs Auto {} · vs Bot {} · summed over seasons vs Auto {} · vs Bot {}",
        mean_spread(&read(Measure::top18)),
        mean_spread(&gap(runs, kind, Kind::Auto, Measure::top18)),
        mean_spread(&gap(runs, kind, Kind::Bot, Measure::top18)),
        mean_spread(&gap(runs, kind, Kind::Auto, top18_cumulative)),
        mean_spread(&gap(runs, kind, Kind::Bot, top18_cumulative)),
    );
    println!(
        "  XI at kick-off: condition {:.1}, fitness {:.1} · starters < 60 {:.2}% · injuries/club/season {:.2} · points a match {:.3}",
        mean(&read(Measure::kickoff_mean)),
        mean(&read(kickoff_fitness)),
        mean(&read(Measure::below_60_percent)),
        mean(&read(Measure::injuries_per_club_season)),
        mean(&read(Measure::points_per_match)),
    );
    if kind == Kind::Bot {
        return;
    }
    let days = star_days(runs, kind);
    let reached = days.iter().filter(|d| d.is_some()).count();
    println!(
        "  stars: ΔOVR a season {} · median day at potential or +18: {} ({reached}/{} reached) · playing time {:.1} · stars left a club-season {:.1}",
        mean_spread(&read(star_growth)),
        describe_day(median_day(&days)),
        days.len(),
        mean(&read(star_playing_time)),
        mean(&read(|m| {
            f64::from(m.extra.stars_left.0) / f64::from(m.extra.stars_left.1.max(1))
        })),
    );
    println!(
        "  first stars at the season's end: Technical attributes at 99 {:.1}%",
        mean(&read(|m| {
            let (capped, of) = m
                .extra
                .star_focus_capped
                .iter()
                .fold((0, 0), |(c, n), (a, b)| (c + a, n + b));
            100.0 * f64::from(capped) / f64::from(of.max(1))
        })),
    );
    if !presses(kind) {
        return;
    }
    println!(
        "  extra sessions a club-season: player-sessions Low {:.0} · Medium {:.0} · High {:.0} · club sessions {:.0} · a star's {:.0}",
        mean(&read(sessions(0))),
        mean(&read(sessions(1))),
        mean(&read(sessions(2))),
        mean(&read(|m| per_club_season(
            m,
            f64::from(m.extra.club_sessions)
        ))),
        mean(&read(|m| {
            f64::from(m.extra.star_sessions) / (m.extra.star_growth.len().max(1) as f64)
        })),
    );
    println!(
        "  bottles a club-season: small {:.1} · large {:.1} · points {:.0} · free points left {:.0} · coins {:.0} · potential raised {}",
        mean(&read(|m| per_club_season(m, f64::from(m.extra.small)))),
        mean(&read(|m| per_club_season(m, f64::from(m.extra.large)))),
        mean(&read(|m| {
            per_club_season(
                m,
                f64::from(m.extra.small * u32::from(SMALL) + m.extra.large * u32::from(LARGE)),
            )
        })),
        mean(&read(|m| per_club_season(
            m,
            f64::from(m.extra.wasted_points)
        ))),
        mean(&read(coins)),
        runs.iter()
            .map(|r| r[&kind].extra.potential_raised)
            .sum::<u32>(),
    );
    print_pressed(runs, kind);
}

fn pressed_sessions(m: &Measure, k: usize) -> f64 {
    m.extra
        .pressed
        .iter()
        .filter(|((intensity, _, _), _)| *intensity == k)
        .map(|(_, t)| f64::from(t.n))
        .sum()
}

/// The sessions the policy pressed, pooled over the seeds: ΔOVR a session by age and XI.
fn print_pressed(runs: &[Measures], kind: Kind) {
    let mut pooled: BTreeMap<(usize, usize, bool), Tally> = BTreeMap::new();
    for r in runs {
        for (key, tally) in &r[&kind].extra.pressed {
            pooled.entry(*key).or_default().merge(*tally);
        }
    }
    let cells: Vec<String> = pooled
        .iter()
        .map(|((k, b, in_xi), t)| {
            format!(
                "{} {} {}: {:.3}, +1s {:.2} (n={})",
                INTENSITY_NAMES[*k],
                BAND_NAMES[*b],
                if *in_xi { "XI" } else { "out" },
                t.ovr_per_session(),
                t.gains_per_session(),
                t.n
            )
        })
        .collect();
    println!("  pressed ΔOVR a session: {}", cells.join(" · "));
}

/// E8 (c), roughly: the coins a club-season had each buying club-day been capped at `cap` bottle
/// points, paying for the points kept at the day's own price. The cut growth is not fed back.
fn coins_under_club_cap(m: &Measure, cap: u32) -> f64 {
    let kept: f64 = m
        .extra
        .club_days
        .iter()
        .filter(|(points, _)| *points > 0)
        .map(|(points, coins)| {
            f64::from(*coins) * f64::from((*points).min(cap)) / f64::from(*points)
        })
        .sum();
    per_club_season(m, kept)
}

fn print_e8_levers(runs: &[Measures], kind: Kind) {
    let spent = mean(&over_seeds(runs, kind, coins));
    if spent <= COIN_CEILING {
        return;
    }
    // (b) "price × k" is dropped (E54-15): no buyer here answers to a price.
    let fits = (0..=600u32)
        .rev()
        .step_by(5)
        .find(|cap| {
            let values: Vec<f64> = runs
                .iter()
                .map(|r| coins_under_club_cap(&r[&kind], *cap))
                .collect();
            mean(&values) <= COIN_CEILING
        })
        .unwrap_or(0);
    let at = |cap: u32| {
        let values: Vec<f64> = runs
            .iter()
            .map(|r| coins_under_club_cap(&r[&kind], cap))
            .collect();
        format!("{cap}: {:.0}", mean(&values))
    };
    println!(
        "    (c) bottle points a club a day: largest cap within {COIN_CEILING} coins = {fits} (coins a season at caps {} · {} · {} · {}; static, growth not fed back)",
        at(35),
        at(70),
        at(105),
        at(fits),
    );
}

/// What the criteria found under one `ExtraRun`; PO's decision tree reads it.
#[derive(Clone, Copy)]
struct Found {
    /// E2–E7 all pass (E1 is the test suite and `measure_recovery_blocks`, run apart).
    e2_e7: bool,
    e2: f64,
    e5_ok: bool,
    e7_ok: bool,
    e3: f64,
    e4_free: f64,
    e4_all: f64,
    e6: f64,
    e8_max3: f64,
    e8_max_all: f64,
}

impl Found {
    /// Step 2 of the tree: E4 (both kinds), E3 and E6 at once.
    fn passes_e3_e4_e6(self) -> bool {
        self.e4_free <= 1.5 && self.e4_all <= 1.5 && self.e3 >= 5.0 && self.e6 <= 4.0
    }
}

fn criterion(name: &str, value: String, limit: &str, ok: bool) -> bool {
    println!("  {name}: {value} — {limit} — {}", verdict(ok));
    ok
}

/// E3–E8 on `first` (season 1 from a fresh world, E54-14), E2 and E9 on `fixed` (kinds kept,
/// three seasons; E2 reads seasons 2–3, the first having no regular starter).
fn judge(first: &[Measures], fixed: &[Measures]) -> Found {
    println!(
        "\n== criteria (E3–E8: {} season-1 samples; E2, E9: {} fixed runs; E1 run apart) ==",
        first.len(),
        fixed.len()
    );
    let (e2, e2_seeds) = e2_value(fixed);
    let e2_ok = criterion(
        "E2 probe ΔOVR a High session, ≤21 starter",
        format!("{e2:.3} (seeds {e2_seeds:.3?})"),
        "0.1–0.8",
        (0.1..=0.8).contains(&e2),
    );
    let e3 = gap(first, Kind::ExtraFree, Kind::Auto, star_growth);
    let e3_ok = criterion(
        "E3 star ExtraFree − star Auto, ΔOVR a season",
        mean_spread(&e3),
        "≥ +5",
        mean(&e3) >= 5.0,
    );
    let e4_free = gap(first, Kind::ExtraFree, Kind::Auto, Measure::top18);
    let e4_all = gap(first, Kind::ExtraFreeAll, Kind::Auto, Measure::top18);
    let e4_free_ok = criterion(
        "E4 ExtraFree − Auto, top18 a season",
        mean_spread(&e4_free),
        "≤ +1.5",
        mean(&e4_free) <= 1.5,
    );
    let e4_all_ok = criterion(
        "E4 ExtraFreeAll − Auto, top18 a season",
        mean_spread(&e4_all),
        "≤ +1.5",
        mean(&e4_all) <= 1.5,
    );
    let e5 = median_day(&star_days(first, Kind::ExtraMax3));
    let e5_ok = criterion(
        "E5 ExtraMax3 stars, median day at potential or +18",
        describe_day(e5),
        "≥ day 10",
        e5.is_none_or(|d| d + 1 >= 10),
    );
    let e6 = gap(first, Kind::ExtraMaxAll, Kind::Auto, Measure::top18);
    let e6_ok = criterion(
        "E6 ExtraMaxAll − Auto, top18 a season",
        mean_spread(&e6),
        "≤ +4",
        mean(&e6) <= 4.0,
    );
    let e7 = gap(
        first,
        Kind::ExtraFree,
        Kind::Auto,
        Measure::points_per_match,
    );
    let e7_ok = criterion(
        "E7 ExtraFree − Auto, points a match",
        format!("{:+.3} (±{:.3})", mean(&e7), spread(&e7)),
        "≥ −0.10 (fails: fix the policy, not a rule lever)",
        mean(&e7) >= -0.10,
    );
    let e7_all = gap(
        first,
        Kind::ExtraFreeAll,
        Kind::Auto,
        Measure::points_per_match,
    );
    println!(
        "  E7 (printed) ExtraFreeAll − Auto, points a match: {:+.3} (±{:.3})",
        mean(&e7_all),
        spread(&e7_all)
    );
    let mut e8 = [0.0; 2];
    for (slot, kind) in [Kind::ExtraMax3, Kind::ExtraMaxAll].into_iter().enumerate() {
        let spent = over_seeds(first, kind, coins);
        e8[slot] = mean(&spent);
        criterion(
            &format!("E8 {kind:?} coins a season"),
            format!("{:.0} (±{:.0})", mean(&spent), spread(&spent)),
            "≤ 2500 (reported, does not stop)",
            mean(&spent) <= COIN_CEILING,
        );
        print_e8_levers(first, kind);
    }
    for kind in [Kind::ExtraMaxAll, Kind::ExtraFreeAll] {
        let e9 = gap(fixed, kind, Kind::Bot, top18_cumulative);
        println!(
            "  E9 (printed) {kind:?} − Bot, top18 over {SEASONS} fixed seasons: {} — beside G_max {G_MAX}",
            mean_spread(&e9)
        );
    }
    let e2_e7 = e2_ok && e3_ok && e4_free_ok && e4_all_ok && e5_ok && e6_ok && e7_ok;
    println!("  E2–E7 {}", verdict(e2_e7));
    Found {
        e2_e7,
        e2,
        e5_ok,
        e7_ok,
        e3: mean(&e3),
        e4_free: mean(&e4_free),
        e4_all: mean(&e4_all),
        e6: mean(&e6),
        e8_max3: e8[0],
        e8_max_all: e8[1],
    }
}

/// One measurement under `extra_run` (E54-14): season 1 from a fresh world at three turns of the
/// places × three seeds, and three seeds of three seasons with every club keeping its kind; each
/// sample's numbers, the summaries by kind, and the criteria.
fn measure(extra_run: ExtraRun) -> Found {
    let variant =
        |seed, shift, rotate, seasons| e54_variant(extra_run, seed, (shift, rotate, seasons));
    let first_variants: Vec<Variant> = (0..3)
        .flat_map(|shift| SEEDS.iter().map(move |seed| variant(*seed, shift, true, 1)))
        .collect();
    let fixed_variants: Vec<Variant> = SEEDS
        .iter()
        .map(|seed| variant(*seed, 0, false, SEASONS))
        .collect();
    let first: Vec<Measures> = first_variants.iter().map(|v| run(*v)).collect();
    let fixed: Vec<Measures> = fixed_variants.iter().map(|v| run(*v)).collect();
    for (v, measures) in first_variants.iter().zip(&first) {
        println!("\n######## season 1, places turned {} ########", v.shift);
        for (kind, m) in measures {
            report(*v, m, Some(*kind));
        }
    }
    for (v, measures) in fixed_variants.iter().zip(&fixed) {
        println!("\n######## {SEASONS} seasons, kinds kept ########");
        for (kind, m) in measures {
            report(*v, m, Some(*kind));
        }
    }
    println!("\n==== E5-4b, {} ====", extra_run.describe());
    println!(
        "\n---- season 1 from a fresh world, {} samples (3 turns × {} seeds): E3–E8 ----",
        first.len(),
        SEEDS.len()
    );
    for kind in KINDS {
        print_kind(&first, kind);
    }
    println!(
        "\n---- {SEASONS} seasons, kinds kept, {} seeds: E2, E9, cumulative (printed) ----",
        fixed.len()
    );
    print_probe(&fixed);
    for kind in KINDS {
        print_kind(&fixed, kind);
    }
    print_by_season(&fixed);
    judge(&first, &fixed)
}

/// E5-4b's world under `extra_run`: E5-1's blocks and pace, E5-4b's places, turned `shift` places.
fn e54_variant(
    extra_run: ExtraRun,
    seed: u64,
    (shift, rotate, seasons): (usize, bool, u32),
) -> Variant {
    Variant {
        multiplier: 16.0,
        recovery: Recovery::Blocks(RecoveryBlocks {
            per_day: 6,
            hours: 8,
        }),
        injury_scale: 13,
        places: Some(&PLACES_E54),
        shift,
        rotate,
        seasons,
        seed,
        extra: Some(extra_run),
    }
}

fn grid_line(extra_run: ExtraRun, found: Found) -> String {
    format!(
        "  {}: E2–E7 {} · E3 {:+.2} · E4 Free {:+.2} · E4 FreeAll {:+.2} · E6 {:+.2} · E8 Max3 {:.0}, MaxAll {:.0}",
        extra_run.describe(),
        verdict(found.e2_e7),
        found.e3,
        found.e4_free,
        found.e4_all,
        found.e6,
        found.e8_max3,
        found.e8_max_all
    )
}

fn top18_young(m: &Measure) -> f64 {
    per_club_season(m, m.extra.top18_by_age[0])
}

fn top18_older(m: &Measure) -> f64 {
    per_club_season(m, m.extra.top18_by_age[1])
}

/// For the user's information after PO's decision on the rerun (no stop rule): season 1 from a
/// fresh world, 9 samples, at low `devPermille`, with each kind's gap to `Auto` in the eighteen
/// best split into what players up to 24 and from 25 brought (E5-5 brakes only the young).
pub(super) fn low_dev_points() {
    println!("\n==== low devPermille points, season 1, 9 samples, gaps to Auto ====");
    for dev_permille in [1000, 250, 100] {
        let extra_run = ExtraRun::with(ExtraParams {
            floor: 40,
            dev_permille,
        });
        let first: Vec<Measures> = (0..3)
            .flat_map(|shift| {
                SEEDS
                    .iter()
                    .map(move |seed| run(e54_variant(extra_run, *seed, (shift, true, 1))))
            })
            .collect();
        let gap_mean = |kind, read: fn(&Measure) -> f64| mean(&gap(&first, kind, Kind::Auto, read));
        println!(
            "  {{40, {dev_permille}}}: E3 {:+.2} · E4 Free {:+.2} · E4 FreeAll {:+.2} · E6 {:+.2}",
            gap_mean(Kind::ExtraFree, star_growth),
            gap_mean(Kind::ExtraFree, Measure::top18),
            gap_mean(Kind::ExtraFreeAll, Measure::top18),
            gap_mean(Kind::ExtraMaxAll, Measure::top18),
        );
        for kind in [Kind::ExtraFree, Kind::ExtraFreeAll, Kind::ExtraMaxAll] {
            println!(
                "    {kind:?} − Auto, the start's eighteen best: ≤{YOUNG_UNTIL} {:+.2} · ≥{} {:+.2} (top18 {:+.2})",
                gap_mean(kind, top18_young),
                YOUNG_UNTIL + 1,
                gap_mean(kind, top18_older),
                gap_mean(kind, Measure::top18),
            );
        }
    }
}

/// The share of pressed sessions that raised at least one attribute (Low only is ever pressed),
/// pooled over the samples: ≤ 21 starters, ≤ 21 others, 22–24 starters, 22–24 others.
fn feel_shares(runs: &[Measures]) -> [(f64, u32); 4] {
    let mut cells = [(0u32, 0u32); 4];
    for m in runs.iter().flat_map(|r| r.values()) {
        for ((_, age_band, starter), (hits, n)) in &m.extra.feel {
            if *age_band < 2 {
                let cell = &mut cells[age_band * 2 + usize::from(!starter)];
                cell.0 += hits;
                cell.1 += n;
            }
        }
    }
    cells.map(|(hits, n)| (f64::from(hits) / f64::from(n.max(1)), n))
}

/// The feel floor of the user's decision (2026-10-31): a starter of 21 or younger sees +1 in at
/// least a fifth of his Low sessions.
const FEEL_FLOOR: f64 = 0.2;

/// The user's decision of 2026-10-31: E1–E9 in full at `devPermille` 150, 125 and 100, the feel
/// of a press, and the largest level that passes all of it (E2 under 0.1 only because the level
/// was lowered on purpose does not block); none passing keeps 1000.
pub(super) fn lowered_dev_levels() {
    let mut passing = None;
    let mut lines = Vec::new();
    for dev_permille in [150, 125, 100] {
        let extra_run = ExtraRun::with(ExtraParams {
            floor: 40,
            dev_permille,
        });
        let first: Vec<Measures> = (0..3)
            .flat_map(|shift| {
                SEEDS
                    .iter()
                    .map(move |seed| run(e54_variant(extra_run, *seed, (shift, true, 1))))
            })
            .collect();
        let found = measure(extra_run);
        let feel = feel_shares(&first);
        let feel_ok = feel[0].0 >= FEEL_FLOOR;
        let rules_ok = found.passes_e3_e4_e6()
            && found.e5_ok
            && found.e7_ok
            && found.e8_max3 <= COIN_CEILING
            && found.e8_max_all <= COIN_CEILING;
        let e2_note = if (0.1..=0.8).contains(&found.e2) {
            "in range"
        } else if found.e2 < 0.1 {
            "under 0.1 only because devPermille was lowered on purpose: does not block"
        } else {
            "over 0.8"
        };
        let line = format!(
            "  {{40, {dev_permille}}}: E2 {:.3} ({e2_note}) · E3 {:+.2} · E4 Free {:+.2} · E4 FreeAll {:+.2} · E5 {} · E6 {:+.2} · E7 {} · E8 {:.0}/{:.0} · feel ≤21 starter {:.1}% (n={}) {}, ≤21 other {:.1}%, 22–24 starter {:.1}%, 22–24 other {:.1}% · E3–E8 {} · overall {}",
            found.e2,
            found.e3,
            found.e4_free,
            found.e4_all,
            verdict(found.e5_ok),
            found.e6,
            verdict(found.e7_ok),
            found.e8_max3,
            found.e8_max_all,
            100.0 * feel[0].0,
            feel[0].1,
            verdict(feel_ok),
            100.0 * feel[1].0,
            100.0 * feel[2].0,
            100.0 * feel[3].0,
            verdict(rules_ok),
            verdict(rules_ok && feel_ok && found.e2 <= 0.8),
        );
        if passing.is_none() && rules_ok && feel_ok && found.e2 <= 0.8 {
            passing = Some(dev_permille);
        }
        lines.push(line);
    }
    println!("\n==== lowered devPermille levels (user's decision of 2026-10-31) ====");
    for line in lines {
        println!("{line}");
    }
    match passing {
        Some(dev_permille) => {
            println!("  chosen: the largest passing level, devPermille {dev_permille}")
        }
        None => println!("  no level passes: keep devPermille 1000"),
    }
}

/// The club caps a day tried for lever 2, largest first (bottle points by the labels).
const CLUB_CAPS: [u32; 6] = [175, 140, 105, 70, 50, 35];

/// PO's decision tree of stop point Đ2 (E54-16), applied over the grid: keep `PROPOSED` if it
/// passes; else the largest `devPermille` of 750, 500 passing E4, E3 and E6 at once; else accept
/// E4 at {40, 1000}. If E6 then fails, lever 1 (25 points a player a day), then lever 2 (a club cap
/// a day, the largest that brings E6 to +4).
pub(super) fn decide() {
    let grid: Vec<(ExtraRun, Found)> = [(40, 1000), (40, 750), (40, 500), (60, 1000)]
        .into_iter()
        .map(|(floor, dev_permille)| {
            let extra_run = ExtraRun::with(ExtraParams {
                floor,
                dev_permille,
            });
            (extra_run, measure(extra_run))
        })
        .collect();
    println!("\n==== the grid (E54-16) ====");
    for (extra_run, found) in &grid {
        println!("{}", grid_line(*extra_run, *found));
    }
    let (proposed, at_proposed) = grid[0];
    let (mut chosen, mut found, branch) = if at_proposed.e2_e7 {
        (
            proposed,
            at_proposed,
            "1: {40, 1000} passes E2–E7, keep PROPOSED",
        )
    } else if at_proposed.e4_all > 1.5 || at_proposed.e4_free > 1.5 {
        match grid[1..3].iter().find(|(_, f)| f.passes_e3_e4_e6()) {
            Some((extra_run, f)) => (
                *extra_run,
                *f,
                "2: the largest devPermille with E4 (both), E3 and E6 passing",
            ),
            None => (
                proposed,
                at_proposed,
                "3: no devPermille passes E4, E3 and E6 at once: accept E4 (a), keep {40, 1000}",
            ),
        }
    } else {
        (
            proposed,
            at_proposed,
            "1 fails outside E4: keep PROPOSED, read step 4",
        )
    };
    println!("\n==== decision tree ====\n  branch {branch}");
    println!("{}", grid_line(chosen, found));
    if found.e6 > 4.0 {
        println!(
            "  step 4: E6 {:+.2} > +4, lever 1 (25 points a player a day)",
            found.e6
        );
        chosen.player_cap = 25;
        found = measure(chosen);
        println!("{}", grid_line(chosen, found));
        if found.e6 > 4.0 {
            println!("  step 4: E6 still > +4, lever 2 (a club cap a day)");
            for cap in CLUB_CAPS {
                chosen.club_cap = Some(cap);
                found = measure(chosen);
                println!("{}", grid_line(chosen, found));
                if found.e6 <= 4.0 {
                    break;
                }
            }
        }
    }
    if found.e6 > 4.0 {
        println!(
            "\n==== step 4 ends: no lever brings E6 to +4; stop and report to PO ====\n{}",
            grid_line(chosen, found)
        );
        return;
    }
    println!("\n==== chosen for S-28b ====\n{}", grid_line(chosen, found));
    if chosen.club_cap.is_some() {
        println!("  step 5: E8 reread under the club cap (above)");
    } else {
        println!("  step 5: E8 accepted as measured (a)");
    }
}

#[cfg(test)]
mod tests {
    use super::{DRINK_CAP, LARGE, SMALL, best_focus, best_for_gain, median_day, pour};
    use domain::player::Player;
    use domain::team::TrainingFocus;
    use ofm_rules::worldgen::online::{Generator, OnlineContentPack};

    /// A generated player at `condition`.
    fn player_at(condition: u8) -> Player {
        let pack = OnlineContentPack::builtin();
        let generator = Generator::new(1, &pack).expect("a generator");
        let club = generator
            .club("AsiaSoutheast", 0, 0, 2026, None)
            .expect("a club");
        let mut player = club.players.into_iter().next().expect("a player");
        player.condition = condition;
        player
    }

    /// Given a player's chance per attribute below, at and above one,
    /// when the measurement picks his extra session's intensity,
    /// then it is Low: Low ties Medium below a chance of one and beats both past it.
    #[test]
    fn the_best_intensity_is_low_and_ties_go_to_the_lighter() {
        for gain in [0.05, 0.48, 0.96, 1.0, 1.44, 3.0] {
            assert_eq!(best_for_gain(gain), 0, "gain {gain}");
        }
    }

    /// Given a large and small bottles to hand,
    /// when players at 60, 70, 80 and 90 drink by §4.3 step 1,
    /// then 60 takes one large, 70 two small, 80 one small (then over 85), 90 none; never past 100.
    #[test]
    fn bottles_follow_the_condition_and_the_daily_cap() {
        let cases: [(u8, &[u8], u8); 4] = [
            (60, &[LARGE], 95),
            (70, &[SMALL, SMALL], 100),
            (80, &[SMALL], 95),
            (90, &[], 90),
        ];
        for (condition, sizes, after) in cases {
            let mut player = player_at(condition);
            assert_eq!(
                pour(&mut player, DRINK_CAP, |_| true),
                sizes,
                "at {condition}"
            );
            assert_eq!(player.condition, after, "at {condition}");
        }
    }

    /// Given a tired player with no large bottle left,
    /// when he drinks,
    /// then he takes two small ones, the cap of 35 allowing no third.
    #[test]
    fn without_a_large_bottle_two_small_ones_fill_the_cap() {
        let mut player = player_at(50);
        assert_eq!(
            pour(&mut player, DRINK_CAP, |size| size == SMALL),
            [SMALL, SMALL]
        );
        assert_eq!(player.condition, 80);
    }

    /// Given days reached and never reached,
    /// when their median is taken,
    /// then a day never reached counts as after the season.
    #[test]
    fn a_day_never_reached_counts_as_after_the_season() {
        assert_eq!(median_day(&[Some(3), None, Some(9)]), Some(9));
        assert_eq!(median_day(&[None, None, Some(1)]), None);
        assert_eq!(median_day(&[Some(4), Some(2), Some(8)]), Some(4));
    }

    /// Given a player whose Technical attributes are all at 99,
    /// when his focus of the day is chosen (E54-13),
    /// then it is no longer Technical: a full focus builds nothing.
    #[test]
    fn a_full_focus_is_left_for_one_that_still_builds() {
        let mut player = player_at(80);
        let a = &mut player.attributes;
        for value in [
            &mut a.passing,
            &mut a.shooting,
            &mut a.dribbling,
            &mut a.long_passing,
            &mut a.crossing,
            &mut a.curve,
            &mut a.free_kick,
            &mut a.long_shots,
            &mut a.first_touch,
        ] {
            *value = 99;
        }
        assert_ne!(
            best_focus(&player, &TrainingFocus::Technical),
            TrainingFocus::Technical
        );
    }
}
