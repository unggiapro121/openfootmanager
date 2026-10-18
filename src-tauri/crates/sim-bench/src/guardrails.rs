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
//! produce them arrive during those stages. `gd5` is the calibration target:
//! its bands come from `engine::targets`, the table the real-world probes
//! read too. Rows the probes judge (goals, goal sources) are only measured
//! here, at either stage (GĐ5-tech-spec §11.2).

use clap::ValueEnum;
use engine::targets::{self, Band};
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
        } else if value <= targets::BALANCE_MAX {
            Verdict::Pass
        } else {
            Verdict::Fail
        },
    }
}

fn in_band(value: f64, band: Band) -> Verdict {
    if band.contains(value) {
        Verdict::Pass
    } else {
        Verdict::Fail
    }
}

/// A row the real-world probes judge: measured here at both stages, with the
/// probe's band beside it.
fn judged_by_probe(band: Band) -> (Verdict, String) {
    (Verdict::Measure, format!("đo (đích probe GĐ5: {band})"))
}

pub fn judge(result: &SweepResult, stage: Stage) -> Vec<Check> {
    vec![
        goals_per_game(result, stage),
        monotone_gap_curve(result),
        zero_gap_symmetry(result, stage),
        match_time(result, stage),
        cross_goal_share(result),
        long_shot_goal_share(result),
        long_shot_share(result),
        direct_free_kick_share(result),
        direct_free_kicks(result),
        defender_aerial_win(result, stage),
        second_balls(result, stage),
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
        build_up_passers(result),
        long_balls(result),
        direct_wins(result),
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
    let per_side = (tally.build_ups + tally.long_balls) as f64 / f64::from(stats.games.max(1) * 2);
    Check {
        name: "phát động thành công (%)",
        value: Some(tally.build_up_success_pct()),
        band: format!("đo ({per_side:.1} pha/đội/trận; GĐ4 đích ≈ 15–25)"),
        verdict: Verdict::Measure,
    }
}

/// Long balls out of the own third and the loose balls after them (P4.2).
/// Real football (`gd4-real-reference.txt`): a third of the passes out of
/// the own third go long, 13% reach the final third, 60% leave the side
/// still on the ball, and the side that kicked it wins 33% of the loose balls.
fn long_balls(result: &SweepResult) -> Check {
    let stats = &result.stats;
    let tally = &stats.duels.tally;
    let (over, kept) = tally.long_ball_pct();
    let share =
        tally.long_balls as f64 / (tally.long_balls + tally.build_ups).max(1) as f64 * 100.0;
    Check {
        name: "phát động bằng bóng dài (%)",
        value: Some(share),
        band: format!(
            "đo (qua tuyến {over:.1}% · còn giữ bóng {kept:.1}% · đua tốc độ {:.2}/trận, thắng {:.1}% · bóng hai đội phất thắng {:.1}%; thật 33/13/60, bóng hai 33)",
            tally.races as f64 / f64::from(stats.games.max(1)),
            tally.races_won as f64 / tally.races.max(1) as f64 * 100.0,
            tally.second_balls_kicker_won as f64 / tally.second_balls.max(1) as f64 * 100.0
        ),
        verdict: Verdict::Measure,
    }
}

/// Who plays a build-up out, by the slot he kicked off in (P4.1, X65). Real
/// football, keepers left out (they never play a short build-up here): CB 46
/// · FB 22 · DM 16 · CM 6 · others 10% (`gd4-real-reference.txt`, item 7).
fn build_up_passers(result: &SweepResult) -> Check {
    let [cb, fb, dm, cm, other] = result.stats.duels.tally.build_up_passer_pct();
    Check {
        name: "người phát động là CB (%)",
        value: Some(cb),
        band: format!(
            "đo (FB {fb:.1} · DM {dm:.1} · CM {cm:.1} · khác {other:.1}; thật 46/22/16/6/10)"
        ),
        verdict: Verdict::Measure,
    }
}

/// How often a defence that wins the ball in its own third goes straight up
/// the pitch rather than playing out (X77). Real football reaches the final
/// third within 10 s of such a win 9% of the time, later 41%.
fn direct_wins(result: &SweepResult) -> Check {
    let tally = &result.stats.duels.tally;
    Check {
        name: "thắng bóng ở sân nhà, đi thẳng (%)",
        value: Some(tally.direct_win_pct()),
        band: format!(
            "đo ({} đi thẳng · {} phát động; thật 9% trong 10 s, 41% sau đó)",
            tally.direct_wins, tally.played_out_wins
        ),
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

/// Goals a game: the loose band gates it at every stage; GĐ5's target is the
/// European probe's (T1), real players in real leagues.
fn goals_per_game(result: &SweepResult, stage: Stage) -> Check {
    const LOOSE: Band = Band::new(1.5, 4.5);
    let value = result.stats.gpg();
    let (verdict, band) = match stage {
        Stage::LanCan => (in_band(value, LOOSE), LOOSE.to_string()),
        Stage::Gd5 => (
            in_band(value, LOOSE),
            format!("{LOOSE} (đích probe GĐ5: {})", targets::GOALS_PER_GAME),
        ),
    };
    Check {
        name: "bàn/trận",
        value: Some(value),
        band,
        verdict,
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
            let ok = symmetric
                && targets::MIRROR_WIN.contains(win)
                && targets::MIRROR_DRAW.contains(draw)
                && targets::MIRROR_WIN.contains(loss);
            (
                if ok { Verdict::Pass } else { Verdict::Fail },
                format!(
                    "≤ 3 hoặc ≤ 3σ = {noise:.1}, thắng/thua {} và hoà {} (đang {win:.1}/{draw:.1}/{loss:.1})",
                    targets::MIRROR_WIN,
                    targets::MIRROR_DRAW
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
        Stage::Gd5 => targets::MATCH_MS_P50.hi,
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
/// The match probe judges it (T8).
fn cross_goal_share(result: &SweepResult) -> Check {
    let goals = result.stats.total_goals.max(1);
    let value = result.stats.headed_goals as f64 / f64::from(goals) * 100.0;
    let (verdict, band) = judged_by_probe(targets::HEADED_GOALS);
    Check {
        name: "bàn đánh đầu, cả phạt góc (%)",
        value: Some(value),
        band,
        verdict,
    }
}

/// Goals from shots outside the box in open play. The match probe judges
/// them with direct free kicks added (T9b, X79).
fn long_shot_goal_share(result: &SweepResult) -> Check {
    let value = result.stats.long_shot_goal_pct();
    let (verdict, band) = judged_by_probe(targets::OUTSIDE_BOX_GOALS);
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

/// Goals scored straight from a free kick (decision X39). The match probe
/// judges them (T10).
fn direct_free_kick_share(result: &SweepResult) -> Check {
    let value = result.stats.direct_free_kick_goal_pct();
    let (verdict, band) = judged_by_probe(targets::DIRECT_FREE_KICK_GOALS);
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
    // the duel's anchor for defenders to win 58% (decision X22). Widened down
    // to 48 at GĐ5 P5.0, when real crosses showed 51.8% (Đ2).
    let band = match stage {
        Stage::LanCan => Band::new(48.0, 62.0),
        Stage::Gd5 => targets::DEFENDER_AERIAL_WIN,
    };
    Check {
        name: "hậu vệ thắng không chiến (%)",
        value: Some(value),
        band: band.to_string(),
        verdict: in_band(value, band),
    }
}

/// The loose balls after a long ball, won by the side that kicked it: GĐ4
/// anchored the duel evenly (X71, about 48%); real football gives the kicker
/// 30.4%, and GĐ5 brings it to 30–36% (X84, T15).
fn second_balls(result: &SweepResult, stage: Stage) -> Check {
    let tally = &result.stats.duels.tally;
    let value = tally.second_balls_kicker_won as f64 / tally.second_balls.max(1) as f64 * 100.0;
    let band = targets::SECOND_BALL_KICKER_WIN;
    let (verdict, shown) = match stage {
        Stage::LanCan => (Verdict::Measure, format!("đo (GĐ5: {band}; thật 30,4)")),
        Stage::Gd5 => (in_band(value, band), band.to_string()),
    };
    Check {
        name: "bóng hai sau phất dài, đội phất thắng (%)",
        value: Some(value),
        band: shown,
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

    /// Given goal shares far outside GĐ5's bands (headers 20%, long shots 5%,
    /// direct free kicks 4%),
    /// when they are judged at either stage,
    /// then they are only measured: the match probe judges them, on real
    /// players (GĐ5-tech-spec §11.2).
    #[test]
    fn goal_shares_are_left_to_the_probe() {
        let mut r = result(vec![row(0, 800, 400, 800)]);
        r.stats.long_shot_goals = 15;
        r.stats.direct_free_kick_goals = 12;
        for stage in [Stage::LanCan, Stage::Gd5] {
            let checks = judge(&r, stage);
            assert_eq!(verdict(&checks, "bàn đánh đầu"), Verdict::Measure);
            assert_eq!(verdict(&checks, "bàn từ sút xa"), Verdict::Measure);
            assert_eq!(
                verdict(&checks, "bàn từ đá phạt trực tiếp"),
                Verdict::Measure
            );
        }
    }

    /// Given three goals a game, and then five,
    /// when they are judged,
    /// then both stages gate only the loose 1.5–4.5: GĐ5's 2.6–2.9 is the
    /// European probe's, since mirror squads of synthetic players are not a
    /// league.
    #[test]
    fn goals_are_judged_against_the_loose_band() {
        let mut r = result(vec![row(0, 800, 400, 800)]);
        assert_eq!(goals_per_game(&r, Stage::LanCan).verdict, Verdict::Pass);
        assert_eq!(goals_per_game(&r, Stage::Gd5).verdict, Verdict::Pass);
        r.stats.total_goals = 500;
        assert_eq!(goals_per_game(&r, Stage::LanCan).verdict, Verdict::Fail);
        assert_eq!(goals_per_game(&r, Stage::Gd5).verdict, Verdict::Fail);
    }

    /// Given the kicker winning 48% of second balls, as GĐ4 left it, and then
    /// 33%,
    /// when the row is judged,
    /// then the loose band only measures it and GĐ5 fails 48 and passes 33
    /// (30–36%, X84).
    #[test]
    fn second_balls_are_gated_at_gd5() {
        let mut r = result(vec![row(0, 800, 400, 800)]);
        r.stats.duels.tally.second_balls = 100;
        r.stats.duels.tally.second_balls_kicker_won = 48;
        assert_eq!(second_balls(&r, Stage::LanCan).verdict, Verdict::Measure);
        assert_eq!(second_balls(&r, Stage::Gd5).verdict, Verdict::Fail);
        r.stats.duels.tally.second_balls_kicker_won = 33;
        assert_eq!(second_balls(&r, Stage::Gd5).verdict, Verdict::Pass);
    }

    /// Given defenders winning 45% in the air, then 52% as real crosses show,
    /// then 58% as GĐ2 anchored it,
    /// when the aerial row is judged,
    /// then both stages gate it: 45% fails both, 52% passes both, and 58%
    /// passes the loose 48–62 band but fails GĐ5's 50–54 (Đ2).
    #[test]
    fn aerial_duels_are_gated_since_the_two_stage_aerial_duel() {
        let mut r = result(vec![row(0, 800, 400, 800)]);
        let mut defenders_win = |won: u32| {
            r.stats.duels.tally.aerial_won = u64::from(100 - won);
            r.stats.duels.tally.aerial_lost = u64::from(won);
            (
                defender_aerial_win(&r, Stage::LanCan).verdict,
                defender_aerial_win(&r, Stage::Gd5).verdict,
            )
        };
        assert_eq!(defenders_win(45), (Verdict::Fail, Verdict::Fail));
        assert_eq!(defenders_win(52), (Verdict::Pass, Verdict::Pass));
        assert_eq!(defenders_win(58), (Verdict::Pass, Verdict::Fail));
    }
}
