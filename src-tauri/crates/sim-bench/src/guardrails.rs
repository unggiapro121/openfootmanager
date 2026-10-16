//! The phase-2 guardrails: one command that says whether the engine is still
//! inside the agreed bands (fm-document/game-engine/phase 2/
//! implementation-plan-phase2.md §6).
//!
//! The measurement is fixed so that two runs are comparable: a managed sweep
//! (benches and AI managers, the path every unwatched fixture takes) over gaps
//! 0–20 in steps of 2, 60 squad pairs and 2,000 matches per gap.
//!
//! Two stages. `lan-can` is the loose band every PR of GĐ1–GĐ4 must stay in;
//! goal-source shares are only measured there, because the mechanisms that
//! produce them arrive during those stages. `gd5` is the calibration target.

use clap::ValueEnum;
use engine::MatchConfig;
use serde::Serialize;

use crate::sweep::{self, SweepResult, SweepSpec};

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum Stage {
    /// The loose band for GĐ1–GĐ4.
    LanCan,
    /// The calibration target for GĐ5.
    Gd5,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum Verdict {
    Pass,
    Fail,
    /// Reported, not judged at this stage.
    Measure,
    /// The engine does not produce this yet.
    NotAvailable,
}

#[derive(Debug, Serialize)]
pub struct Check {
    pub name: &'static str,
    pub value: Option<f64>,
    pub band: String,
    pub verdict: Verdict,
}

const CENTRE: u8 = 70;
const PAIRS: u32 = 60;
const GAMES_PER_GAP: u32 = 2_000;

pub fn spec(seed: u64) -> SweepSpec<'static> {
    SweepSpec {
        centre: CENTRE,
        gaps: (0..=20).step_by(2).collect(),
        pairs: PAIRS,
        games_per_gap: GAMES_PER_GAP,
        managed: true,
        formation: "4-4-2",
        seed,
    }
}

/// Play the guardrail sweep and judge it. Returns the sweep too, for printing.
pub fn run(config: &MatchConfig, stage: Stage, seed: u64) -> (SweepResult, Vec<Check>) {
    let result = sweep::run(config, &spec(seed));
    let checks = judge(&result, stage);
    (result, checks)
}

fn in_band(value: f64, lo: f64, hi: f64) -> Verdict {
    if (lo..=hi).contains(&value) {
        Verdict::Pass
    } else {
        Verdict::Fail
    }
}

/// A band check that is only judged at GĐ5 and merely measured before it.
fn judged_at_gd5(stage: Stage, value: f64, lo: f64, hi: f64) -> (Verdict, String) {
    match stage {
        Stage::LanCan => (Verdict::Measure, format!("đo (GĐ5: {lo}–{hi})")),
        Stage::Gd5 => (in_band(value, lo, hi), format!("{lo}–{hi}")),
    }
}

pub fn judge(result: &SweepResult, stage: Stage) -> Vec<Check> {
    vec![
        goals_per_game(result, stage),
        monotone_gap_curve(result),
        zero_gap_symmetry(result, stage),
        match_time(result, stage),
        cross_goal_share(result, stage),
        Check {
            name: "bàn từ sút xa (%)",
            value: None,
            band: "chưa có cơ chế (P2.5)".to_string(),
            verdict: not_yet(stage),
        },
        Check {
            name: "bàn từ đá phạt trực tiếp (%)",
            value: None,
            band: "chưa có cơ chế (P2.4)".to_string(),
            verdict: not_yet(stage),
        },
        defender_aerial_win(result, stage),
    ]
}

/// A share the engine cannot produce yet: information before GĐ5, a failure at it.
fn not_yet(stage: Stage) -> Verdict {
    match stage {
        Stage::LanCan => Verdict::NotAvailable,
        Stage::Gd5 => Verdict::Fail,
    }
}

fn goals_per_game(result: &SweepResult, stage: Stage) -> Check {
    let value = result.stats.gpg();
    let (lo, hi) = match stage {
        Stage::LanCan => (1.5, 4.5),
        Stage::Gd5 => (2.0, 2.5),
    };
    Check {
        name: "bàn/trận",
        value: Some(value),
        band: format!("{lo}–{hi}"),
        verdict: in_band(value, lo, hi),
    }
}

/// The win rate must not fall as the gap widens. A drop is only counted when it
/// is larger than twice the combined standard error of the two rows, so the
/// check does not fail on sampling noise alone.
fn monotone_gap_curve(result: &SweepResult) -> Check {
    let worst = result
        .rows
        .windows(2)
        .map(|w| {
            let drop = w[0].win_pct() - w[1].win_pct();
            let allowance = 2.0 * (w[0].win_pct_se().powi(2) + w[1].win_pct_se().powi(2)).sqrt();
            drop - allowance
        })
        .fold(f64::NEG_INFINITY, f64::max);
    Check {
        name: "tỉ lệ thắng đơn điệu theo chênh OVR (độ tụt vượt 2σ, điểm %)",
        value: Some(worst.max(0.0)),
        band: "≤ 0".to_string(),
        verdict: if worst <= 0.0 {
            Verdict::Pass
        } else {
            Verdict::Fail
        },
    }
}

/// At gap 0 the two sides are mirror images and home alternates, so the win
/// and loss rates must agree. At GĐ5 the split must also be near 40/20/40.
fn zero_gap_symmetry(result: &SweepResult, stage: Stage) -> Check {
    let Some(row) = result.rows.iter().find(|r| r.gap == 0) else {
        return Check {
            name: "chênh 0, đội soi gương: |thắng − thua| (điểm %)",
            value: None,
            band: "sweep thiếu mức chênh 0".to_string(),
            verdict: Verdict::Fail,
        };
    };
    let (win, draw, loss) = (row.pct(row.wins), row.pct(row.draws), row.pct(row.losses));
    let asymmetry = (win - loss).abs();
    let (verdict, band) = match stage {
        Stage::LanCan => (
            if asymmetry <= 3.0 {
                Verdict::Pass
            } else {
                Verdict::Fail
            },
            format!("≤ 3 (đang {win:.1}/{draw:.1}/{loss:.1})"),
        ),
        Stage::Gd5 => {
            let near = |v: f64, target: f64| (v - target).abs() <= 3.0;
            let ok = asymmetry <= 3.0 && near(win, 40.0) && near(draw, 20.0) && near(loss, 40.0);
            (
                if ok { Verdict::Pass } else { Verdict::Fail },
                format!("≤ 3 và 40/20/40 ±3 (đang {win:.1}/{draw:.1}/{loss:.1})"),
            )
        }
    };
    Check {
        name: "chênh 0, đội soi gương: |thắng − thua| (điểm %)",
        value: Some(asymmetry),
        band,
        verdict,
    }
}

fn match_time(result: &SweepResult, stage: Stage) -> Check {
    let p50_ms = result.micros_quantile(0.5) as f64 / 1000.0;
    let limit = match stage {
        Stage::LanCan => 3.5,
        Stage::Gd5 => 2.5,
    };
    let build = if cfg!(debug_assertions) {
        " · bản DEBUG, số đo không có giá trị"
    } else {
        ""
    };
    Check {
        name: "thời gian/trận, trung vị (ms)",
        value: Some(p50_ms),
        band: format!("≤ {limit}{build}"),
        verdict: if cfg!(debug_assertions) {
            Verdict::Measure
        } else if p50_ms <= limit {
            Verdict::Pass
        } else {
            Verdict::Fail
        },
    }
}

fn cross_goal_share(result: &SweepResult, stage: Stage) -> Check {
    let goals = result.stats.total_goals.max(1);
    let value = result.stats.duels.cross_goals as f64 / f64::from(goals) * 100.0;
    let (verdict, band) = judged_at_gd5(stage, value, 16.0, 22.0);
    Check {
        name: "bàn từ tạt + đánh đầu (%)",
        value: Some(value),
        band,
        verdict,
    }
}

fn defender_aerial_win(result: &SweepResult, stage: Stage) -> Check {
    let duels = &result.stats.duels;
    let total = (duels.aerial_won + duels.aerial_lost).max(1);
    let value = duels.aerial_lost as f64 / total as f64 * 100.0;
    let (lo, hi) = match stage {
        Stage::LanCan => (54.0, 62.0),
        Stage::Gd5 => (56.0, 59.0),
    };
    Check {
        name: "hậu vệ thắng không chiến (%)",
        value: Some(value),
        band: format!("{lo}–{hi}"),
        verdict: in_band(value, lo, hi),
    }
}

pub fn any_failed(checks: &[Check]) -> bool {
    checks.iter().any(|c| c.verdict == Verdict::Fail)
}

pub fn print_checks(checks: &[Check], stage: Stage) {
    println!();
    println!("Lan can · stage {stage:?}");
    for c in checks {
        let value = c
            .value
            .map_or_else(|| "—".to_string(), |v| format!("{v:.2}"));
        let verdict = match c.verdict {
            Verdict::Pass => "PASS",
            Verdict::Fail => "FAIL",
            Verdict::Measure => "đo",
            Verdict::NotAvailable => "n/a",
        };
        println!("  {verdict:<5} {:<58} {value:>8}   {}", c.name, c.band);
    }
    println!("  → {}", if any_failed(checks) { "FAIL" } else { "PASS" });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::BenchStats;
    use crate::sweep::GapRow;

    fn row(gap: u8, wins: u32, draws: u32, losses: u32) -> GapRow {
        GapRow {
            gap,
            strong_rating: 70,
            weak_rating: 70,
            games: wins + draws + losses,
            wins,
            draws,
            losses,
            goals: (wins + draws + losses) * 3,
        }
    }

    fn result(rows: Vec<GapRow>) -> SweepResult {
        let mut stats = BenchStats {
            games: 100,
            total_goals: 300,
            ..Default::default()
        };
        stats.duels.cross_goals = 60;
        stats.duels.aerial_won = 42;
        stats.duels.aerial_lost = 58;
        SweepResult {
            rows,
            stats,
            match_micros: vec![400; 10],
            managed: true,
        }
    }

    fn verdict(checks: &[Check], name_prefix: &str) -> Verdict {
        checks
            .iter()
            .find(|c| c.name.starts_with(name_prefix))
            .map(|c| c.verdict)
            .expect("check present")
    }

    /// Given a win rate that rises with the gap,
    /// when the curve is judged,
    /// then it passes.
    #[test]
    fn a_rising_win_curve_passes() {
        let r = result(vec![
            row(0, 800, 400, 800),
            row(2, 900, 400, 700),
            row(4, 1000, 400, 600),
        ]);
        assert_eq!(monotone_gap_curve(&r).verdict, Verdict::Pass);
    }

    /// Given a win rate that falls well beyond sampling noise between two gaps,
    /// when the curve is judged,
    /// then it fails.
    #[test]
    fn a_win_curve_that_falls_beyond_noise_fails() {
        let r = result(vec![
            row(0, 800, 400, 800),
            row(2, 1200, 400, 400),
            row(4, 900, 400, 700),
        ]);
        assert_eq!(monotone_gap_curve(&r).verdict, Verdict::Fail);
    }

    /// Given a small dip inside two standard errors,
    /// when the curve is judged,
    /// then it still passes: noise is not a regression.
    #[test]
    fn a_dip_within_noise_passes() {
        let r = result(vec![
            row(0, 800, 400, 800),
            row(2, 820, 400, 780),
            row(4, 810, 400, 790),
        ]);
        assert_eq!(monotone_gap_curve(&r).verdict, Verdict::Pass);
    }

    /// Given mirrored sides that win 45% and lose 35%,
    /// when gap 0 is judged,
    /// then it fails: identical squads must split evenly.
    #[test]
    fn a_lopsided_mirror_match_fails() {
        let r = result(vec![row(0, 900, 400, 700)]);
        assert_eq!(zero_gap_symmetry(&r, Stage::LanCan).verdict, Verdict::Fail);
        let even = result(vec![row(0, 790, 420, 790)]);
        assert_eq!(
            zero_gap_symmetry(&even, Stage::LanCan).verdict,
            Verdict::Pass
        );
    }

    /// Given an even mirror split of 30/40/30,
    /// when gap 0 is judged at each stage,
    /// then the loose band passes it and GĐ5 fails it for missing 40/20/40.
    #[test]
    fn gd5_also_asks_for_forty_twenty_forty() {
        let r = result(vec![row(0, 600, 800, 600)]);
        assert_eq!(zero_gap_symmetry(&r, Stage::LanCan).verdict, Verdict::Pass);
        assert_eq!(zero_gap_symmetry(&r, Stage::Gd5).verdict, Verdict::Fail);
    }

    /// Given a cross-goal share of 20%,
    /// when it is judged at each stage,
    /// then the loose band only measures it and GĐ5 passes it.
    #[test]
    fn goal_shares_are_only_judged_at_gd5() {
        let r = result(vec![row(0, 800, 400, 800)]);
        assert_eq!(
            cross_goal_share(&r, Stage::LanCan).verdict,
            Verdict::Measure
        );
        assert_eq!(cross_goal_share(&r, Stage::Gd5).verdict, Verdict::Pass);
    }

    /// Given an engine without long shots or direct free kicks,
    /// when the shares are judged,
    /// then they are "not available" in the loose band and failures at GĐ5.
    #[test]
    fn missing_mechanisms_fail_only_at_gd5() {
        let r = result(vec![row(0, 800, 400, 800)]);
        let loose = judge(&r, Stage::LanCan);
        assert_eq!(verdict(&loose, "bàn từ sút xa"), Verdict::NotAvailable);
        let gd5 = judge(&r, Stage::Gd5);
        assert_eq!(verdict(&gd5, "bàn từ sút xa"), Verdict::Fail);
    }

    /// Given three goals a game and defenders winning 58% in the air,
    /// when both are judged,
    /// then both sit inside the loose band.
    #[test]
    fn goals_and_aerial_duels_are_judged_against_their_bands() {
        let r = result(vec![row(0, 800, 400, 800)]);
        assert_eq!(goals_per_game(&r, Stage::LanCan).verdict, Verdict::Pass);
        assert_eq!(goals_per_game(&r, Stage::Gd5).verdict, Verdict::Fail);
        assert_eq!(
            defender_aerial_win(&r, Stage::LanCan).verdict,
            Verdict::Pass
        );
    }
}
