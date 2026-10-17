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

use crate::balance::{self, BalanceRow};
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

/// Matches per formation in the formation-balance table (decision X60).
const BALANCE_GAMES: u32 = 4_000;

/// Whether the formation-balance row is a gate yet. It becomes one at P3.2,
/// when the ball's lane starts to decide who plays (GĐ3-tech-spec §12.2).
const FORMATION_BALANCE_GATED: bool = false;

pub fn spec(seed: u64, formation_mix: bool) -> SweepSpec<'static> {
    SweepSpec {
        centre: CENTRE,
        gaps: (0..=20).step_by(2).collect(),
        pairs: PAIRS,
        games_per_gap: GAMES_PER_GAP,
        managed: true,
        formation: "4-4-2",
        formation_mix,
        seed,
    }
}

/// Play the guardrail sweep and judge it. Returns the sweep and, with the
/// formation mix, the formation-balance table too, for printing.
pub fn run(
    config: &MatchConfig,
    stage: Stage,
    seed: u64,
    formation_mix: bool,
) -> (SweepResult, Option<Vec<BalanceRow>>, Vec<Check>) {
    let result = sweep::run(config, &spec(seed, formation_mix));
    let mut checks = judge(&result, stage);
    let balance = formation_mix.then(|| balance::run(config, seed, BALANCE_GAMES));
    if let Some(rows) = &balance {
        checks.push(formation_balance(rows));
    }
    (result, balance, checks)
}

/// The formation-balance table (phase 2, GĐ3, X60): at gap 0 no formation may
/// beat 4-4-2 by more than 5 points of wins over losses, about 3.8σ over
/// 4,000 matches and about 6 points over a 38-match season. Measured until
/// P3.2, a gate from then on.
fn formation_balance(rows: &[BalanceRow]) -> Check {
    let worst = rows
        .iter()
        .max_by(|a, b| a.edge().abs().total_cmp(&b.edge().abs()))
        .expect("the balance table has rows");
    let value = worst.edge().abs();
    let band = format!(
        "≤ 5 ({} {:+.1} ± {:.1})",
        worst.formation,
        worst.edge(),
        worst.edge_se()
    );
    Check {
        name: "cân bằng sơ đồ: max |thắng − thua| khi gặp 4-4-2 (điểm %)",
        value: Some(value),
        band: if FORMATION_BALANCE_GATED {
            band
        } else {
            format!("đo, chặn từ P3.2: {band}")
        },
        verdict: if !FORMATION_BALANCE_GATED {
            Verdict::Measure
        } else if value <= 5.0 {
            Verdict::Pass
        } else {
            Verdict::Fail
        },
    }
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
        long_shot_goal_share(result, stage),
        long_shot_share(result),
        direct_free_kick_share(result, stage),
        direct_free_kicks(result),
        defender_aerial_win(result, stage),
        goals_per_corner(result),
        break_value(result),
        centre_lane_share(result),
        crosses_per_match(result),
        box_shot_groups(result),
        one_v_one_win(result),
        final_third_carriers(result),
        free_kick_goal_share(result),
        open_flank_breaks(result),
        build_ups(result),
        high_turnovers(result),
        midfield_duels(result),
    ]
}

/// Build-ups from a side's own third (phase 2, GĐ4, P4.0): how many a side
/// plays a match and how many reach midfield. GĐ4 lifts the count (X77,
/// target ≈ 15–25) and anchors the success rate at P4.0's (X66).
fn build_ups(result: &SweepResult) -> Check {
    let stats = &result.stats;
    let tally = &stats.duels.tally;
    let per_side = tally.build_ups as f64 / f64::from(stats.games.max(1) * 2);
    Check {
        name: "phát động thành công (%)",
        value: Some(tally.build_up_success_pct()),
        band: format!("đo ({per_side:.1} pha/đội/trận; GĐ4 đích ≈ 15–25)"),
        verdict: Verdict::Measure,
    }
}

/// Build-ups lost in the own third, and what the side that won the ball made
/// of them before the other side touched it again (P4.0; X67 labels them).
fn high_turnovers(result: &SweepResult) -> Check {
    let stats = &result.stats;
    let tally = &stats.duels.tally;
    let turnovers = tally.high_turnovers.max(1) as f64;
    Check {
        name: "mất bóng ở 1/3 sân nhà/trận",
        value: Some(tally.high_turnovers as f64 / f64::from(stats.games.max(1))),
        band: format!(
            "đo ({:.3} cú sút, {:.3} bàn mỗi lần mất bóng)",
            tally.high_turnover_shots as f64 / turnovers,
            tally.high_turnover_goals as f64 / turnovers
        ),
        verdict: Verdict::Measure,
    }
}

/// Midfield duels: how often the side on the ball wins one, and the winner's
/// group (P4.0). P4.3 re-anchors the first and opens the second to players
/// outside the midfield.
fn midfield_duels(result: &SweepResult) -> Check {
    let stats = &result.stats;
    let tally = &stats.duels.tally;
    let [def, mid, fwd, subs] = tally.midfield_winner_group_pct();
    Check {
        name: "giữa sân, đội công thắng (%)",
        value: Some(tally.midfield_attack_won_pct()),
        band: format!(
            "đo ({:.1} tranh chấp/trận; người thắng MID {mid:.1} · DEF {def:.1} · FWD {fwd:.1} · dự bị {subs:.1})",
            tally.midfield_duels as f64 / f64::from(stats.games.max(1))
        ),
        verdict: Verdict::Measure,
    }
}

/// Breaks into a flank a full back left open (phase 2, P3.6): how many a
/// match, and how much more often the attacker wins that one-on-one than
/// down a covered flank — the space behind is meant to be worth +20–30%.
fn open_flank_breaks(result: &SweepResult) -> Check {
    let stats = &result.stats;
    let tally = &stats.duels.tally;
    let breaks = tally.exploit_won + tally.exploit_lost;
    let per_match = breaks as f64 / f64::from(stats.games.max(1));
    let rate = |won: u64, lost: u64| won as f64 / (won + lost).max(1) as f64 * 100.0;
    Check {
        name: "khai thác cánh hở: lợi thế 1v1 (% tương đối)",
        value: Some(tally.exploit_advantage_pct()),
        band: format!(
            "đo, đích +20–30 (thắng {:.1}% so với {:.1}% ở biên thường; {per_match:.2} pha/trận, {:.3} bàn mỗi pha)",
            rate(tally.exploit_won, tally.exploit_lost),
            rate(tally.flank_won, tally.flank_lost),
            tally.exploit_goals as f64 / breaks.max(1) as f64
        ),
        verdict: Verdict::Measure,
    }
}

/// Goals from free kicks, struck at goal or crossed in (decision X39, option
/// b; measurable from P3.4, when a wide free kick is crossed).
fn free_kick_goal_share(result: &SweepResult) -> Check {
    let stats = &result.stats;
    let goals = f64::from(stats.total_goals.max(1));
    let direct = stats.direct_free_kick_goals as f64 / goals * 100.0;
    let crossed = stats.free_kick_goals as f64 / goals * 100.0;
    Check {
        name: "bàn từ đá phạt, trực tiếp + tạt (%)",
        value: Some(direct + crossed),
        band: format!("đo (trực tiếp {direct:.2} · tạt {crossed:.2})"),
        verdict: Verdict::Measure,
    }
}

/// How often the attacker wins the attacking third's one-on-one: GĐ3 anchored
/// it where it stood before lanes (P3.2, X49), about 56–57%.
fn one_v_one_win(result: &SweepResult) -> Check {
    Check {
        name: "1v1 ở 1/3 cuối, đội công thắng (%)",
        value: Some(result.stats.duels.one_v_one_win_pct()),
        band: "đo (neo ở mức trước GĐ3, ≈ 56–57)".to_string(),
        verdict: Verdict::Measure,
    }
}

/// Who carries the ball in the attacking third's one-on-one, by the group of
/// his slot (phase 2, P3.2). Real football: FWD 45.6 · MID 37.8 · DEF 16.6%
/// of final-third take-ons (StatsBomb 2015/16).
fn final_third_carriers(result: &SweepResult) -> Check {
    let [def, mid, fwd, subs] = result.stats.duels.tally.final_third_group_pct();
    Check {
        name: "người đi bóng 1v1 ở 1/3 cuối là FWD (%)",
        value: Some(fwd),
        band: format!("đo (MID {mid:.1} · DEF {def:.1} · dự bị {subs:.1}; thật 45,6/37,8/16,6)"),
        verdict: Verdict::Measure,
    }
}

/// Share of the attacking third's one-on-ones played down the centre
/// (phase 2, GĐ3). Before P3.1 the lane is the attacker's slot, so this reads
/// the formation; from P3.3 it reads where the ball went.
fn centre_lane_share(result: &SweepResult) -> Check {
    let tally = &result.stats.duels.tally;
    let [left, centre, right] = tally.final_third_lanes;
    let total = (left + centre + right).max(1) as f64;
    Check {
        name: "1v1 ở 1/3 cuối theo làn giữa (%)",
        value: Some(tally.centre_lane_pct()),
        band: format!(
            "đo (trái {:.1} / phải {:.1}; đích theo số thật §4.3)",
            left as f64 / total * 100.0,
            right as f64 / total * 100.0
        ),
        verdict: Verdict::Measure,
    }
}

/// Open-play crosses a match, both sides, against real football's 22, with
/// those that never reached the contest and those along the ground (phase 2,
/// GĐ3, P3.4).
fn crosses_per_match(result: &SweepResult) -> Check {
    let stats = &result.stats;
    let tally = &stats.duels.tally;
    let [left, centre, right] = tally.crosses_by_lane;
    let per_match = |n: u64| n as f64 / f64::from(stats.games.max(1));
    Check {
        name: "quả tạt bóng sống/trận",
        value: Some(per_match(tally.open_play_crosses)),
        band: format!(
            "đo (thật 22,2; không tới {:.1}, sệt {:.1}/trận; mọi quả tạt trái/giữa/phải {left}/{centre}/{right})",
            per_match(tally.unreached_crosses),
            per_match(tally.low_crosses)
        ),
        verdict: Verdict::Measure,
    }
}

/// Who shoots in the box: forwards' share, with midfielders', defenders' and
/// substitutes' alongside (phase 2, GĐ3; the check on ω in P3.5).
fn box_shot_groups(result: &SweepResult) -> Check {
    let [def, mid, fwd, subs] = result.stats.duels.tally.box_shot_group_pct();
    Check {
        name: "cú sút trong vòng cấm của FWD (%)",
        value: Some(fwd),
        band: format!("đo (MID {mid:.1} · DEF {def:.1} · dự bị {subs:.1})"),
        verdict: Verdict::Measure,
    }
}

/// `g`, the goals a one-on-one won on the break goes on to score: what a
/// sweeper keeper must beat to be worth his risk (phase 2, P2.6, decision
/// X41). Measured; only sides that break fast (or beat a counter-press) play
/// any.
fn break_value(result: &SweepResult) -> Check {
    let stats = &result.stats;
    Check {
        name: "g: bàn mỗi 1v1 thắng khi phản công",
        value: Some(stats.goals_per_counter_one_v_one()),
        band: format!("đo ({:.2} pha/trận)", stats.counter_one_v_ones_pg()),
        verdict: Verdict::Measure,
    }
}

/// What a corner is worth, measured at every stage (phase 2, P2.3): real
/// football scores from about 2.5–3% of corners, and P2.3 calibrates corners
/// to it. No decision makes it a gate.
fn goals_per_corner(result: &SweepResult) -> Check {
    Check {
        name: "bàn mỗi quả phạt góc (%)",
        value: Some(result.stats.goals_per_corner_pct()),
        band: "đo (thực tế 2,5–3)".to_string(),
        verdict: Verdict::Measure,
    }
}

fn goals_per_game(result: &SweepResult, stage: Stage) -> Check {
    let value = result.stats.gpg();
    let (lo, hi) = match stage {
        Stage::LanCan => (1.5, 4.5),
        // Where the 2024-25 leagues sit: 2.69 across 18, 2.83 in the top five
        // (fm-document/comon/sim-bench/reference/).
        Stage::Gd5 => (2.6, 2.9),
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
/// and loss rates must agree. They are judged against sampling noise: a gap
/// over 3 points fails only when it is also beyond three standard errors of a
/// fair split, about 5.8 points over the sweep's 2,000 games. A bare "≤ 3"
/// failed a fair engine about one run in eight (phase 2, P2.2). Two standard
/// errors still failed one in twenty, and every package that changes results
/// reshuffles the random stream: P2.4 read 4.04 on seed 42 against 2σ = 3.9,
/// while seeds 43-47 read -1.6, +1.9, +0.9, +1.6 and +0.2. At three, a fair
/// engine fails about one run in 370, and a side bias of 6 points is caught. At GĐ5 the split must also be near 35/30/35: two even
/// sides draw about 30% of the time in real football.
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
    // Standard error of (win − loss), in points: Var = (pW + pL − (pW − pL)²) / n.
    let (p_win, p_loss) = (win / 100.0, loss / 100.0);
    let noise = 3.0
        * ((p_win + p_loss - (p_win - p_loss).powi(2)) / f64::from(row.games.max(1))).sqrt()
        * 100.0;
    let symmetric = asymmetry <= 3.0_f64.max(noise);
    let (verdict, band) = match stage {
        Stage::LanCan => (
            if symmetric {
                Verdict::Pass
            } else {
                Verdict::Fail
            },
            format!("≤ 3 hoặc ≤ 3σ = {noise:.1} (đang {win:.1}/{draw:.1}/{loss:.1})"),
        ),
        Stage::Gd5 => {
            let near = |v: f64, target: f64| (v - target).abs() <= 3.0;
            let ok = symmetric && near(win, 35.0) && near(draw, 30.0) && near(loss, 35.0);
            (
                if ok { Verdict::Pass } else { Verdict::Fail },
                format!(
                    "≤ 3 hoặc ≤ 3σ = {noise:.1}, và 35/30/35 ±3 (đang {win:.1}/{draw:.1}/{loss:.1})"
                ),
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

/// Goals scored with the head, from open play and corners alike: the shot's
/// kind, not the goal's source, which credits a header from a corner to the
/// corner. Read this way from GĐ3 (GĐ3-tech-spec §12.2), so GĐ3 and GĐ5
/// compare; until P3.0 it counted goals after a won cross duel in open play.
fn cross_goal_share(result: &SweepResult, stage: Stage) -> Check {
    let goals = result.stats.total_goals.max(1);
    let value = result.stats.headed_goals as f64 / f64::from(goals) * 100.0;
    let (verdict, band) = judged_at_gd5(stage, value, 16.0, 22.0);
    Check {
        name: "bàn đánh đầu, cả phạt góc (%)",
        value: Some(value),
        band,
        verdict,
    }
}

/// Goals from shots outside the box in open play, measured until GĐ5 and
/// judged at 10–14% there (decision X7).
fn long_shot_goal_share(result: &SweepResult, stage: Stage) -> Check {
    let value = result.stats.long_shot_goal_pct();
    let (verdict, band) = judged_at_gd5(stage, value, 10.0, 14.0);
    Check {
        name: "bàn từ sút xa (%)",
        value: Some(value),
        band,
        verdict,
    }
}

/// The share of shots struck from outside the box, which P2.5 calibrated to
/// the Premier League's 30–35%, and how many of them go in. Measured.
fn long_shot_share(result: &SweepResult) -> Check {
    let stats = &result.stats;
    Check {
        name: "cú sút ngoài vòng cấm (%)",
        value: Some(stats.long_shot_share_pct()),
        band: format!(
            "đo (thực tế 30–35; thành bàn {:.1}%, thực tế ≈ 3,7)",
            stats.long_shot_conversion_pct()
        ),
        verdict: Verdict::Measure,
    }
}

/// Goals scored straight from a free kick, measured until GĐ5 and judged at
/// 1.5–3% there (decision X39: the Premier League scores 1.6–1.8% this way).
fn direct_free_kick_share(result: &SweepResult, stage: Stage) -> Check {
    let value = result.stats.direct_free_kick_goal_pct();
    let (verdict, band) = judged_at_gd5(stage, value, 1.5, 3.0);
    Check {
        name: "bàn từ đá phạt trực tiếp (%)",
        value: Some(value),
        band,
        verdict,
    }
}

/// How many direct free kicks a match sees, and how many go in: P2.4
/// calibrated them to the Premier League's 0.8–1.0 a match and about 6%.
/// Measured at every stage.
fn direct_free_kicks(result: &SweepResult) -> Check {
    let stats = &result.stats;
    Check {
        name: "cú đá phạt trực tiếp/trận",
        value: Some(stats.direct_free_kicks_pg()),
        band: format!(
            "đo (thực tế 0,8–1,0; thành bàn {:.1}%, thực tế 5–7)",
            stats.direct_free_kick_conversion_pct()
        ),
        verdict: Verdict::Measure,
    }
}

fn defender_aerial_win(result: &SweepResult, stage: Stage) -> Check {
    let duels = &result.stats.duels;
    let value = duels.tally.defender_aerial_win_pct();
    // Gated in the loose band since P2.2, the two-stage aerial duel, which set
    // the duel's anchor for defenders to win 58% (decision X22).
    let (verdict, band) = match stage {
        Stage::LanCan => (in_band(value, 54.0, 62.0), "54–62".to_string()),
        Stage::Gd5 => (in_band(value, 56.0, 59.0), "56–59".to_string()),
    };
    Check {
        name: "hậu vệ thắng không chiến (%)",
        value: Some(value),
        band,
        verdict,
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
        stats.headed_goals = 60;
        stats.duels.tally.aerial_won = 42;
        stats.duels.tally.aerial_lost = 58;
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

    /// Given mirrored sides 3.1 points apart over 2,000 games (36.9/23.1/40.0),
    /// within three standard errors of an even split,
    /// when gap 0 is judged,
    /// then it passes, and so does a 4.0-point gap past two standard errors:
    /// both are the sampling noise of a fair split, which a bare "≤ 3" would
    /// fail one run in eight and 2σ one in twenty. The 3.1-point gap over
    /// 20,000 games is no longer noise, and fails.
    #[test]
    fn a_mirror_gap_within_sampling_noise_passes() {
        // 4.0 points over 2,000 games: past 2σ (3.9), within 3σ (5.8).
        let past_two_sigma = result(vec![row(0, 785, 455, 760)]);
        assert_eq!(
            zero_gap_symmetry(&past_two_sigma, Stage::LanCan).verdict,
            Verdict::Pass
        );
        let noisy = result(vec![row(0, 738, 462, 800)]);
        assert_eq!(
            zero_gap_symmetry(&noisy, Stage::LanCan).verdict,
            Verdict::Pass
        );
        let real = result(vec![row(0, 7_380, 4_620, 8_000)]);
        assert_eq!(
            zero_gap_symmetry(&real, Stage::LanCan).verdict,
            Verdict::Fail
        );
    }

    /// Given an even mirror split of 30/40/30,
    /// when gap 0 is judged at each stage,
    /// then the loose band passes it and GĐ5 fails it for missing 35/30/35,
    /// the split real even matches show (about 30% draws).
    #[test]
    fn gd5_also_asks_for_thirty_five_thirty_thirty_five() {
        let r = result(vec![row(0, 600, 800, 600)]);
        assert_eq!(zero_gap_symmetry(&r, Stage::LanCan).verdict, Verdict::Pass);
        assert_eq!(zero_gap_symmetry(&r, Stage::Gd5).verdict, Verdict::Fail);
        let real = result(vec![row(0, 700, 600, 700)]);
        assert_eq!(zero_gap_symmetry(&real, Stage::Gd5).verdict, Verdict::Pass);
    }

    /// Given headed goals making 20% of goals,
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

    /// Given long shots that make 12% of goals and direct free kicks 2%, and
    /// then 5% and 4%,
    /// when the shares are judged,
    /// then the loose band only measures them, GĐ5 passes the first pair
    /// (10–14%, X7; 1.5–3%, X39) and fails the second.
    #[test]
    fn long_shot_and_free_kick_shares_are_judged_at_gd5() {
        let mut r = result(vec![row(0, 800, 400, 800)]);
        r.stats.long_shot_goals = 36;
        r.stats.direct_free_kick_goals = 6;
        let loose = judge(&r, Stage::LanCan);
        assert_eq!(verdict(&loose, "bàn từ sút xa"), Verdict::Measure);
        assert_eq!(verdict(&loose, "bàn từ đá phạt"), Verdict::Measure);
        let gd5 = judge(&r, Stage::Gd5);
        assert_eq!(verdict(&gd5, "bàn từ sút xa"), Verdict::Pass);
        assert_eq!(verdict(&gd5, "bàn từ đá phạt"), Verdict::Pass);
        r.stats.long_shot_goals = 15;
        r.stats.direct_free_kick_goals = 12;
        let gd5 = judge(&r, Stage::Gd5);
        assert_eq!(verdict(&gd5, "bàn từ sút xa"), Verdict::Fail);
        assert_eq!(verdict(&gd5, "bàn từ đá phạt"), Verdict::Fail);
    }

    /// Given three goals a game,
    /// when they are judged,
    /// then they pass the loose band and fail GĐ5's 2.6–2.9, which is where the
    /// 2024-25 leagues sit (2.69 across 18, 2.83 in the top five).
    #[test]
    fn goals_are_judged_against_their_bands() {
        let mut r = result(vec![row(0, 800, 400, 800)]);
        assert_eq!(goals_per_game(&r, Stage::LanCan).verdict, Verdict::Pass);
        assert_eq!(goals_per_game(&r, Stage::Gd5).verdict, Verdict::Fail);
        r.stats.total_goals = 275;
        assert_eq!(goals_per_game(&r, Stage::Gd5).verdict, Verdict::Pass);
    }

    /// Given defenders winning 48% in the air, as before P2.2, and then 58%,
    /// when the aerial row is judged,
    /// then since the two-stage aerial duel both stages gate it: 48% fails
    /// both, 58% passes the loose 54–62 band and GĐ5's 56–59.
    #[test]
    fn aerial_duels_are_gated_since_the_two_stage_aerial_duel() {
        let mut r = result(vec![row(0, 800, 400, 800)]);
        r.stats.duels.tally.aerial_won = 52;
        r.stats.duels.tally.aerial_lost = 48;
        assert_eq!(
            defender_aerial_win(&r, Stage::LanCan).verdict,
            Verdict::Fail
        );
        assert_eq!(defender_aerial_win(&r, Stage::Gd5).verdict, Verdict::Fail);
        r.stats.duels.tally.aerial_won = 42;
        r.stats.duels.tally.aerial_lost = 58;
        assert_eq!(
            defender_aerial_win(&r, Stage::LanCan).verdict,
            Verdict::Pass
        );
        assert_eq!(defender_aerial_win(&r, Stage::Gd5).verdict, Verdict::Pass);
    }
}
