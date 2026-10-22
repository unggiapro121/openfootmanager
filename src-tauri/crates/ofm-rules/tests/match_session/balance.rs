//! Does splitting the AI onto its own streams change the game's numbers? Run by hand:
//! `cargo test --release -p ofm-rules --test match_session balance -- --ignored --nocapture`.
//! It plays the same matches both ways: through the session, and the way the game played them
//! before E3-3 (engine and both AIs on one generator).

use std::time::Instant;

use engine::ai::ai_decide;
use engine::{EventType, LiveMatchState, MatchReport, Side};
use ofm_rules::match_session::{Controller, MatchSession, MatchSetup};

use crate::support::{MAX_STEPS, even_setup};

#[derive(Default)]
struct Tally {
    matches: u32,
    goals: u32,
    home_wins: u32,
    draws: u32,
    substitutions: u32,
}

impl Tally {
    fn add(&mut self, report: &MatchReport) {
        let (home, away) = (report.home_goals, report.away_goals);
        self.matches += 1;
        self.goals += u32::from(home) + u32::from(away);
        self.home_wins += u32::from(home > away);
        self.draws += u32::from(home == away);
        self.substitutions += report
            .events
            .iter()
            .filter(|event| event.event_type == EventType::Substitution)
            .count() as u32;
    }

    fn line(&self, label: &str, seconds: f64) -> String {
        let n = f64::from(self.matches);
        format!(
            "{label:<22} {:>6} trận | bàn/trận {:.3} | chủ nhà thắng {:.1}% | hoà {:.1}% | thay người/trận {:.2} | {:.3} ms/trận",
            self.matches,
            f64::from(self.goals) / n,
            f64::from(self.home_wins) / n * 100.0,
            f64::from(self.draws) / n * 100.0,
            f64::from(self.substitutions) / n,
            seconds * 1000.0 / n,
        )
    }
}

fn shared_generator(setup: MatchSetup) -> MatchReport {
    let mut rng = setup.seed.engine_rng();
    let (ai_home, ai_away) = (setup.ai_home.clone(), setup.ai_away.clone());
    let mut state = LiveMatchState::new(
        setup.home,
        setup.away,
        setup.config,
        setup.home_bench,
        setup.away_bench,
        setup.allows_extra_time,
    );
    for _ in 0..MAX_STEPS {
        if state.is_finished() {
            break;
        }
        let result = state.step_minute(&mut rng);
        if result.is_finished {
            break;
        }
        for (side, profile) in [(Side::Home, &ai_home), (Side::Away, &ai_away)] {
            for command in ai_decide(&state, side, profile, &mut rng) {
                if let Err(_refused) = state.apply_command(command) {}
            }
        }
    }
    state.into_report()
}

fn session(setup: MatchSetup) -> MatchReport {
    let mut session = MatchSession::new(setup, Controller::Ai, Controller::Ai);
    for _ in 0..MAX_STEPS {
        if session.is_finished() {
            break;
        }
        session.step();
    }
    session.into_report()
}

/// Given 4,000 even 4-4-2 meetings with seven-man benches and the AI on both touchlines,
/// when each is played through the session and the old way,
/// then the goals, results and substitutions per match are printed side by side.
#[test]
#[ignore = "a measurement, run by hand in release"]
#[expect(
    clippy::disallowed_methods,
    reason = "times the two ways of playing; no match reads the clock"
)]
fn balance_session_against_the_shared_generator() {
    const MATCHES: u64 = 4_000;
    let mut old = Tally::default();
    let started = Instant::now();
    for number in 0..MATCHES {
        old.add(&shared_generator(even_setup(50_000 + number)));
    }
    let old_seconds = started.elapsed().as_secs_f64();
    let mut new = Tally::default();
    let started = Instant::now();
    for number in 0..MATCHES {
        new.add(&session(even_setup(50_000 + number)));
    }
    let new_seconds = started.elapsed().as_secs_f64();
    println!("{}", old.line("chung một bộ sinh", old_seconds));
    println!("{}", new.line("phiên trận (3 luồng)", new_seconds));
    assert_eq!(old.matches, new.matches);
}
