//! E3-9: what the online coach's licence does to a match (phase 3, S-9 §6). Run by hand:
//! `cargo test --release -p ofm-rules --test licence_measure -- --ignored --nocapture`.
//!
//! The clubs are 56 online bot clubs of one region, each reviewing its week as the server's bots
//! do: with every control open, or within the first licence (`weekly_review_within`). Every match
//! is played through the match session with the AI on both sides, as an absent coach's would be.
//!
//! - M1: 1,000 first-licence meetings against the same 1,000 with everything open.
//! - M2: each club with every licence against itself with the first, both ways round.
//! - M3: the orders the AI gave, by kind, in M1.
//! - M4: time per match in M1.

use std::collections::BTreeMap;
use std::time::Instant;

use domain::manager::PlayStyleMastery;
use domain::player::Player;
use domain::team::Team;
use engine::ai::AiProfile;
use engine::{MatchCommand, MatchConfig, MatchReport};
use ofm_rules::ai_tactics::{weekly_review, weekly_review_within};
use ofm_rules::licence::{LicenceControls, controls};
use ofm_rules::match_session::{
    Controller, InputSource, MatchInput, MatchSeed, MatchSession, MatchSetup,
};
use ofm_rules::squad::{
    FixtureLoad, SideSelection, build_side, coach_mastery_from, management_quality_from_rating,
    selection_seed,
};
use ofm_rules::worldgen::online::{Generator, OnlineContentPack};

const SEED: u64 = 0x0E39;
const CLUBS: u64 = 56;
const MEETINGS: u64 = 1_000;
const MIRROR_ROUNDS: u64 = 18;

struct Club {
    players: Vec<Player>,
    mastery: PlayStyleMastery,
    rating: u8,
    /// The club as it lines up with every control open, and within the first licence.
    open: Team,
    grassroots: Team,
}

fn world() -> Vec<Club> {
    let pack = OnlineContentPack::builtin();
    let generator = Generator::new(SEED, &pack).expect("a generator");
    (0..CLUBS)
        .map(|ordinal| {
            let club = generator
                .club("AsiaSoutheast", ordinal, 0, 2026, None)
                .expect("a club");
            let mastery = club.coach.play_style_mastery;
            let squad: Vec<&Player> = club.players.iter().collect();
            let mut open = club.team.clone();
            weekly_review(&mut open, &squad, None);
            let mut grassroots = club.team.clone();
            weekly_review_within(&mut grassroots, &squad, None, &controls(1), &mastery);
            Club {
                rating: club.coach.rating(),
                mastery,
                open,
                grassroots,
                players: club.players,
            }
        })
        .collect()
}

/// A side of `club` lined up as `team`, under `licence`.
struct Lineup<'a> {
    club: &'a Club,
    team: &'a Team,
    licence: Option<LicenceControls>,
}

/// `club` within `licence`, or as it lines up with everything open when there is none.
fn lineup<'a>(club: &'a Club, licence: Option<&LicenceControls>) -> Lineup<'a> {
    Lineup {
        club,
        team: if licence.is_some() {
            &club.grassroots
        } else {
            &club.open
        },
        licence: licence.cloned(),
    }
}

fn side(lineup: &Lineup<'_>, key: &str) -> (engine::TeamData, Vec<engine::PlayerData>) {
    let available: Vec<&Player> = lineup.club.players.iter().collect();
    build_side(&SideSelection {
        team_id: &lineup.team.id,
        team: Some(lineup.team),
        available: &available,
        injured: &[],
        is_user_team: false,
        head_coach: coach_mastery_from(&lineup.club.mastery),
        management_quality: management_quality_from_rating(lineup.club.rating),
        selection_seed: selection_seed(&lineup.team.id, key),
        load: FixtureLoad::Normal,
    })
}

/// One match, with what the AI ordered and how long it took.
struct Played {
    report: MatchReport,
    formations: [String; 2],
    orders: BTreeMap<&'static str, u32>,
    millis: f64,
}

#[expect(
    clippy::disallowed_methods,
    reason = "a measurement times its matches with the wall clock; it is not a rule and feeds no world"
)]
fn play(home: &Lineup<'_>, away: &Lineup<'_>, key: &str) -> Played {
    let (home_side, home_bench) = side(home, key);
    let (away_side, away_bench) = side(away, key);
    let formations = [home_side.formation.clone(), away_side.formation.clone()];
    let mut seed = [0u8; 32];
    seed[..8]
        .copy_from_slice(&ofm_rules::stable_hash::stable_hash(key.as_bytes(), SEED).to_le_bytes());
    let setup = MatchSetup {
        home: home_side,
        away: away_side,
        home_bench,
        away_bench,
        config: MatchConfig::default(),
        allows_extra_time: false,
        seed: MatchSeed(seed),
        ai_home: AiProfile::default(),
        ai_away: AiProfile::default(),
        injury_window_steps: Some(3),
        licence_home: home.licence.clone(),
        licence_away: away.licence.clone(),
    };
    let started = Instant::now();
    let mut session = MatchSession::new(setup, Controller::Ai, Controller::Ai);
    while !session.is_finished() {
        session.step();
    }
    let millis = started.elapsed().as_secs_f64() * 1_000.0;
    let mut orders = BTreeMap::new();
    for record in session.log() {
        if record.source != InputSource::Ai {
            continue;
        }
        if let MatchInput::Command(command) = &record.input {
            let kind = match command {
                MatchCommand::ChangeFormation { .. } => "shape",
                MatchCommand::ChangePlayStyle { .. } => "style",
                MatchCommand::ChangeTacticalDial { .. } => "dial",
                MatchCommand::ChangePlayerRole { .. } => "role",
                MatchCommand::Substitute { .. } => "substitution",
                _ => "other",
            };
            *orders.entry(kind).or_insert(0) += 1;
        }
    }
    Played {
        report: session.into_report(),
        formations,
        orders,
        millis,
    }
}

#[derive(Default)]
struct Tally {
    matches: u32,
    goals: u32,
    home_wins: u32,
    draws: u32,
    shots: u32,
    corners: u32,
    cards: u32,
    possession_sq: f64,
    formations: BTreeMap<String, u32>,
    orders: BTreeMap<&'static str, u32>,
    millis: Vec<f64>,
}

impl Tally {
    fn add(&mut self, played: Played) {
        let r = &played.report;
        self.matches += 1;
        self.goals += u32::from(r.home_goals) + u32::from(r.away_goals);
        if r.home_goals > r.away_goals {
            self.home_wins += 1;
        } else if r.home_goals == r.away_goals {
            self.draws += 1;
        }
        self.shots += u32::from(r.home_stats.shots) + u32::from(r.away_stats.shots);
        self.corners += u32::from(r.home_stats.corners) + u32::from(r.away_stats.corners);
        self.cards += [&r.home_stats, &r.away_stats]
            .iter()
            .map(|s| u32::from(s.yellow_cards) + u32::from(s.red_cards))
            .sum::<u32>();
        self.possession_sq += (r.home_possession - 50.0).powi(2);
        for formation in played.formations {
            *self.formations.entry(formation).or_insert(0) += 1;
        }
        for (kind, count) in played.orders {
            *self.orders.entry(kind).or_insert(0) += count;
        }
        self.millis.push(played.millis);
    }

    fn per_match(&self, value: u32) -> f64 {
        f64::from(value) / f64::from(self.matches)
    }

    fn p50_millis(&mut self) -> f64 {
        self.millis.sort_by(f64::total_cmp);
        self.millis[self.millis.len() / 2]
    }

    fn report(&mut self, name: &str) {
        let m = f64::from(self.matches);
        println!("== {name}: {} matches", self.matches);
        println!(
            "  goals/match {:.3} · home wins {:.1}% · draws {:.1}% · shots/match {:.2} · corners/match {:.2} · cards/match {:.2} · possession SD {:.2}",
            self.per_match(self.goals),
            100.0 * f64::from(self.home_wins) / m,
            100.0 * f64::from(self.draws) / m,
            self.per_match(self.shots),
            self.per_match(self.corners),
            self.per_match(self.cards),
            (self.possession_sq / m).sqrt(),
        );
        let sides = 2.0 * m;
        let shares: Vec<String> = self
            .formations
            .iter()
            .map(|(f, n)| format!("{f} {:.1}%", 100.0 * f64::from(*n) / sides))
            .collect();
        println!(
            "  shapes at kick-off ({} in use): {}",
            self.formations.len(),
            shares.join(", ")
        );
        let orders: Vec<String> = self
            .orders
            .iter()
            .map(|(k, n)| format!("{k} {:.2}", f64::from(*n) / m))
            .collect();
        println!("  AI orders per match: {}", orders.join(", "));
        println!("  ms/match p50 {:.3}", self.p50_millis());
    }

    fn tactical_orders(&self) -> u32 {
        ["shape", "style", "dial", "role"]
            .iter()
            .map(|k| self.orders.get(k).copied().unwrap_or(0))
            .sum()
    }
}

fn meeting(k: u64) -> (usize, usize) {
    let home = k % CLUBS;
    let mut away = (k * 7 + 13) % CLUBS;
    if away == home {
        away = (away + 1) % CLUBS;
    }
    (home as usize, away as usize)
}

#[test]
#[ignore = "a measurement, run by hand"]
fn measure_licences() {
    let clubs = world();
    let grassroots = controls(1);

    // M1, M3, M4.
    let mut open = Tally::default();
    let mut first = Tally::default();
    for k in 0..MEETINGS {
        let (h, a) = meeting(k);
        let key = format!("m1/{k}");
        open.add(play(
            &lineup(&clubs[h], None),
            &lineup(&clubs[a], None),
            &key,
        ));
        first.add(play(
            &lineup(&clubs[h], Some(&grassroots)),
            &lineup(&clubs[a], Some(&grassroots)),
            &key,
        ));
    }
    open.report("M1 everything open");
    first.report("M1 first licence, both sides");
    println!(
        "M3: tactical orders per match, first licence / open: {:.2} / {:.2} = {:.0}%",
        first.per_match(first.tactical_orders()),
        open.per_match(open.tactical_orders()),
        100.0 * f64::from(first.tactical_orders()) / f64::from(open.tactical_orders().max(1)),
    );

    // M2: each club with every licence against itself with the first.
    let (mut points_elite, mut points_first, mut matches) = (0u32, 0u32, 0u32);
    for round in 0..MIRROR_ROUNDS {
        for (c, club) in clubs.iter().enumerate() {
            let elite = Lineup {
                club,
                team: &club.open,
                licence: Some(LicenceControls::all_open()),
            };
            let first_side = Lineup {
                club,
                team: &club.grassroots,
                licence: Some(grassroots.clone()),
            };
            for leg in 0..2 {
                let key = format!("m2/{round}/{c}/{leg}");
                let (home, away, elite_home) = if leg == 0 {
                    (&elite, &first_side, true)
                } else {
                    (&first_side, &elite, false)
                };
                let r = play(home, away, &key).report;
                let (elite_goals, first_goals) = if elite_home {
                    (r.home_goals, r.away_goals)
                } else {
                    (r.away_goals, r.home_goals)
                };
                match elite_goals.cmp(&first_goals) {
                    std::cmp::Ordering::Greater => points_elite += 3,
                    std::cmp::Ordering::Less => points_first += 3,
                    std::cmp::Ordering::Equal => {
                        points_elite += 1;
                        points_first += 1;
                    }
                }
                matches += 1;
            }
        }
    }
    println!(
        "M2: {matches} mirror matches, every licence vs the first: share of points {:.1}% / {:.1}%",
        100.0 * f64::from(points_elite) / f64::from(points_elite + points_first),
        100.0 * f64::from(points_first) / f64::from(points_elite + points_first),
    );
}
