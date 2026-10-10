//! What the user's club expects of a player: its read of his ceiling, and the
//! path his overall would take under the reference conditions — Medium
//! training, about two matches in three, a 7.0 average. A player who does
//! better than that grows faster than projected, one who does worse grows
//! slower; the projection is a forecast, never the truth.
//!
//! Nothing here reads a player's true `potential` except through a scout's
//! read of it (`read_rating`), so a projection can never be used to find the
//! ceiling out.

use crate::game::Game;
use crate::scouting::{believed, judgement_band, read_rating};
use domain::message::ProspectEstimate;
use domain::player::{Player, Position};
use domain::staff::{Staff, StaffRole};
use serde::Serialize;

const ERR_NOT_ASSESSED: &str = "be.error.projection.notAssessed";
const ERR_NO_ASSESSOR: &str = "be.error.projection.noAssessor";

/// Playing time of the reference conditions: a full match in two of every three.
pub const REFERENCE_PLAYING_TIME: u8 = 67;
/// Match form of the reference conditions: a 7.0 average, in tenths.
pub const REFERENCE_MATCH_FORM: u8 = 70;
/// Training intensity of the reference conditions: Medium.
const REFERENCE_INTENSITY: f64 = 1.0;
/// Coaching assumed for a player the club does not coach itself: a staff of
/// average coaching (50), as `training::coaching_mult` rates it.
const STANDARD_COACHING_MULT: f64 = 1.10;
/// Overall a season per unit of every other multiplier. Tuned with the probe
/// (`potential_projection_probe.rs`, 24 compact worlds, three years): players
/// who lived near the reference conditions end within ±0.3 of the expected
/// line on average after one, two and three years, regulars in good form
/// about +1 to +2 ahead, players who rarely play 1.5 to 5 behind. The
/// training doc's +3.5 a season for an 18-year-old starter would give 2.12;
/// a real season has fewer useful sessions than that figure assumed.
const PROJECTION_K: f64 = 1.70;
/// Most seasons a projection looks ahead.
const PROJECTION_SEASONS: u32 = 10;
/// The age a projection stops at.
const PROJECTION_LAST_AGE: u32 = 34;
/// Seasonal aging: technical growth of 0 or 1 a season on four attributes up
/// to this age, which ignores the ceiling (`aging::technical_growth`).
const TECHNICAL_GROWTH_LAST_AGE: u32 = 32;
const EXPECTED_TECHNICAL_GROWTH: f64 = 0.5;
const TECHNICAL_GROWTH_ATTRIBUTES: [&str; 4] = ["passing", "vision", "decisions", "composure"];
/// Seasonal aging: 1–3 pace lost a season from this age (`aging::veteran_pace_loss`).
const PACE_LOSS_FIRST_AGE: u32 = 30;
const EXPECTED_PACE_LOSS: f64 = 2.0;

/// Who made a read: a member of the club's staff.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Assessor {
    pub staff_id: String,
    pub name: String,
    pub role: StaffRole,
}

impl Assessor {
    fn of(staff: &Staff) -> Self {
        Self {
            staff_id: staff.id.clone(),
            name: format!("{} {}", staff.first_name, staff.last_name),
            role: staff.role.clone(),
        }
    }
}

/// Whose coaching a projection assumes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum CoachingBasis {
    /// The user's club's own coaches: the player trains there.
    Club,
    /// An average staff: the player trains elsewhere.
    Standard,
}

/// The conditions a projection assumes, for the UI to state.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ReferenceConditions {
    pub playing_time: u8,
    pub match_form: u8,
    pub coaching: CoachingBasis,
}

/// The projected overall a number of seasons from now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectionPoint {
    /// Seasons from now; 0 is today.
    pub season: u32,
    pub age: u32,
    pub low: u8,
    pub expected: u8,
    pub high: u8,
}

/// The path a player's overall is expected to take, and its highest point.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DevelopmentProjection {
    pub points: Vec<ProjectionPoint>,
    pub peak_expected: u8,
    pub peak_age: u32,
}

/// One player as the club reads him, and where it expects him to go.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlayerProjection {
    pub player_id: String,
    pub assessor: Option<Assessor>,
    pub estimate: ProspectEstimate,
    pub wonderkid: bool,
    pub projection: DevelopmentProjection,
    pub reference: ReferenceConditions,
}

/// The club's read of one of its own players' ceilings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlayerAssessment {
    pub player_id: String,
    pub potential_low: u8,
    pub potential_high: u8,
    pub potential_band: u8,
    /// The ceiling the club believes: the middle of its range, by which the
    /// squad screens rank and average.
    pub potential_believed: u8,
    pub wonderkid: bool,
}

/// The club's read of every one of its players, by its best judge of potential.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ClubAssessments {
    pub assessor: Option<Assessor>,
    pub players: Vec<PlayerAssessment>,
}

/// Everything a projection is computed from: what the club believes, never
/// the truth.
pub(crate) struct ProjectionInput<'a> {
    pub estimate: &'a ProspectEstimate,
    pub age: u32,
    pub position: &'a Position,
    pub development_multiplier: f64,
    pub coaching_mult: f64,
}

/// Who judges the club's own players: whichever scout or assistant manager
/// judges potential best, the lower id on a tie so the choice is stable.
pub(crate) fn club_assessor<'a>(game: &'a Game, team_id: &str) -> Option<&'a Staff> {
    game.staff
        .iter()
        .filter(|staff| staff.team_id.as_deref() == Some(team_id))
        .filter(|staff| matches!(staff.role, StaffRole::Scout | StaffRole::AssistantManager))
        .max_by(|a, b| {
            a.attributes
                .judging_potential
                .cmp(&b.attributes.judging_potential)
                .then_with(|| b.id.cmp(&a.id))
        })
}

/// The club's read of its own `player`: his overall exactly, as the club sees
/// him every day, and his ceiling within `assessor`'s judging band. The read
/// holds for a calendar month and is taken afresh in the next one, or as soon
/// as a different member of staff makes it.
pub(crate) fn own_estimate(game: &Game, player: &Player, assessor: &Staff) -> ProspectEstimate {
    let month = game.clock.current_date.format("%Y-%m").to_string();
    let mut rng = game.rng_for(
        &format!("own-assessment/{}/{}", player.id, assessor.id),
        &month,
    );
    let band = judgement_band(assessor.attributes.judging_potential);
    let (low, high) = read_rating(player.potential, band, &mut rng);
    // A ceiling below the overall the club can see is no read at all.
    ProspectEstimate {
        prospect_id: player.id.clone(),
        ovr_low: player.ovr,
        ovr_high: player.ovr,
        ovr_band: 0,
        potential_low: low.max(player.ovr),
        potential_high: high.max(player.ovr),
        potential_band: band,
        attributes: Vec::new(),
    }
}

/// Whether the club's read makes `age`'s player a wonderkid, on the same rule
/// the true trait uses.
pub(crate) fn scouted_wonderkid(estimate: &ProspectEstimate, age: u32) -> bool {
    crate::player_rating::qualifies_for_wonderkid(
        age,
        believed(estimate.potential_low, estimate.potential_high),
        believed(estimate.ovr_low, estimate.ovr_high),
    )
}

/// The path from the club's read under the reference conditions: the low line
/// from the lowest overall to the lowest ceiling, the expected line between
/// the middles, the high line between the tops.
pub(crate) fn project(input: &ProjectionInput) -> DevelopmentProjection {
    let estimate = input.estimate;
    let midpoint = |low: u8, high: u8| (f64::from(low) + f64::from(high)) / 2.0;
    let path = |start: f64, ceiling: f64| season_path(start, ceiling, input);
    let low = path(
        f64::from(estimate.ovr_low),
        f64::from(estimate.potential_low),
    );
    let expected = path(
        midpoint(estimate.ovr_low, estimate.ovr_high),
        midpoint(estimate.potential_low, estimate.potential_high),
    );
    let high = path(
        f64::from(estimate.ovr_high),
        f64::from(estimate.potential_high),
    );

    let points: Vec<ProjectionPoint> = (0..expected.len())
        .map(|season| ProjectionPoint {
            season: season as u32,
            age: input.age + season as u32,
            low: rating(low[season]),
            expected: rating(expected[season]),
            high: rating(high[season]),
        })
        .collect();
    // The earliest season at the highest expected overall.
    let (peak_expected, peak_age) =
        points
            .iter()
            .fold((0, input.age), |(best, best_age), point| {
                if point.expected > best {
                    (point.expected, point.age)
                } else {
                    (best, best_age)
                }
            });
    DevelopmentProjection {
        points,
        peak_expected,
        peak_age,
    }
}

fn rating(value: f64) -> u8 {
    value.round().clamp(1.0, 99.0) as u8
}

/// The overall at the start of today and of each coming season: training
/// gains up to the ceiling, then the season's aging, which ignores the ceiling
/// as `aging` does (and so, like the game, lifts it).
fn season_path(start: f64, ceiling: f64, input: &ProjectionInput) -> Vec<f64> {
    let seasons = PROJECTION_SEASONS
        .min(PROJECTION_LAST_AGE.saturating_sub(input.age))
        .max(1);
    let growth = PROJECTION_K
        * input.development_multiplier
        * input.coaching_mult
        * REFERENCE_INTENSITY
        * crate::playing_time::development_factor(REFERENCE_PLAYING_TIME)
        * crate::match_form::development_factor(REFERENCE_MATCH_FORM);
    let weights = crate::player_rating::attribute_weights(input.position);
    let weight = |key: &str| {
        weights
            .iter()
            .find(|(weighted, _)| *weighted == key)
            .map_or(0.0, |(_, weight)| f64::from(*weight) / 100.0)
    };
    let technical_weight: f64 = TECHNICAL_GROWTH_ATTRIBUTES
        .iter()
        .map(|key| weight(key))
        .sum();
    let pace_weight = weight("pace");

    let mut ceiling = ceiling.max(start);
    let mut ovr = start;
    let mut path = vec![ovr];
    for season in 0..seasons {
        let age = input.age + season;
        if ovr < ceiling {
            ovr = (ovr + growth * crate::training::age_factor(age)).min(ceiling);
        }
        if age <= TECHNICAL_GROWTH_LAST_AGE {
            ovr += EXPECTED_TECHNICAL_GROWTH * technical_weight;
        }
        if age >= PACE_LOSS_FIRST_AGE {
            ovr -= EXPECTED_PACE_LOSS * pace_weight;
        }
        ovr = ovr.clamp(1.0, 99.0);
        ceiling = ceiling.max(ovr);
        path.push(ovr);
    }
    path
}

/// The user's club's team id, or the error every command gives without one.
fn user_team(game: &Game) -> Result<&str, String> {
    game.manager
        .team_id
        .as_deref()
        .ok_or_else(|| "be.error.noTeamAssigned".to_string())
}

/// Whether `player` is the user's: in the squad, or out on loan from it.
fn belongs_to(player: &Player, team_id: &str) -> bool {
    player.team_id.as_deref() == Some(team_id)
        || player
            .active_loan
            .as_ref()
            .is_some_and(|loan| loan.parent_team_id == team_id)
}

fn age_today(game: &Game, player: &Player) -> u32 {
    let today = game.clock.current_date.date_naive();
    crate::aging::player_age_on(today, &player.date_of_birth).max(0) as u32
}

fn projection_of(
    game: &Game,
    player: &Player,
    estimate: ProspectEstimate,
    assessor: Option<Assessor>,
    coaching: CoachingBasis,
    coaching_mult: f64,
) -> PlayerProjection {
    let age = age_today(game, player);
    let position = crate::player_rating::primary_position(player);
    let projection = project(&ProjectionInput {
        estimate: &estimate,
        age,
        position: &position,
        development_multiplier: game.development_speed.multiplier(),
        coaching_mult,
    });
    PlayerProjection {
        player_id: player.id.clone(),
        assessor,
        wonderkid: scouted_wonderkid(&estimate, age),
        estimate,
        projection,
        reference: ReferenceConditions {
            playing_time: REFERENCE_PLAYING_TIME,
            match_form: REFERENCE_MATCH_FORM,
            coaching,
        },
    }
}

/// Where the club expects `player_id` to go: one of its own players, read by
/// its best judge of potential, or a player on its watchlist, read as the
/// watchlist reads him. Anyone else the club has not assessed.
pub fn player_projection(game: &Game, player_id: &str) -> Result<PlayerProjection, String> {
    let team_id = user_team(game)?;
    if let Some(player) = game
        .players
        .iter()
        .find(|player| player.id == player_id && belongs_to(player, team_id))
    {
        let assessor = club_assessor(game, team_id).ok_or(ERR_NO_ASSESSOR)?;
        let estimate = own_estimate(game, player, assessor);
        // A player out on loan trains at the borrowing club.
        let (coaching, coaching_mult) = if player.team_id.as_deref() == Some(team_id) {
            (
                CoachingBasis::Club,
                crate::training::coaching_mult(game, team_id),
            )
        } else {
            (CoachingBasis::Standard, STANDARD_COACHING_MULT)
        };
        return Ok(projection_of(
            game,
            player,
            estimate,
            Some(Assessor::of(assessor)),
            coaching,
            coaching_mult,
        ));
    }
    let entry = game
        .youth_watchlist
        .iter()
        .find(|entry| entry.prospect.id == player_id)
        .ok_or(ERR_NOT_ASSESSED)?;
    let scout = entry
        .scout_id
        .as_deref()
        .and_then(|scout_id| game.staff.iter().find(|staff| staff.id == scout_id))
        .map(Assessor::of);
    Ok(projection_of(
        game,
        &entry.prospect,
        entry.estimate.clone(),
        scout,
        CoachingBasis::Standard,
        STANDARD_COACHING_MULT,
    ))
}

/// The club's read of every one of its players' ceilings. Empty, with no
/// assessor, when it has nobody to judge them.
pub fn club_assessments(game: &Game) -> Result<ClubAssessments, String> {
    let team_id = user_team(game)?;
    let Some(assessor) = club_assessor(game, team_id) else {
        return Ok(ClubAssessments {
            assessor: None,
            players: Vec::new(),
        });
    };
    let players = game
        .players
        .iter()
        .filter(|player| belongs_to(player, team_id) && !player.retired)
        .map(|player| {
            let estimate = own_estimate(game, player, assessor);
            PlayerAssessment {
                player_id: player.id.clone(),
                potential_low: estimate.potential_low,
                potential_high: estimate.potential_high,
                potential_band: estimate.potential_band,
                potential_believed: believed(estimate.potential_low, estimate.potential_high),
                wonderkid: scouted_wonderkid(&estimate, age_today(game, player)),
            }
        })
        .collect();
    Ok(ClubAssessments {
        assessor: Some(Assessor::of(assessor)),
        players,
    })
}

#[cfg(test)]
#[path = "potential_projection_probe.rs"]
mod probe;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::clock::GameClock;
    use crate::test_support::uniform_attributes;
    use chrono::{TimeZone, Utc};
    use domain::manager::Manager;
    use domain::staff::StaffAttributes;
    use domain::team::Team;

    fn estimate(ovr: (u8, u8), potential: (u8, u8)) -> ProspectEstimate {
        ProspectEstimate {
            prospect_id: "p".to_string(),
            ovr_low: ovr.0,
            ovr_high: ovr.1,
            ovr_band: 0,
            potential_low: potential.0,
            potential_high: potential.1,
            potential_band: 5,
            attributes: Vec::new(),
        }
    }

    fn input(estimate: &ProspectEstimate, age: u32) -> ProjectionInput<'_> {
        ProjectionInput {
            estimate,
            age,
            position: &Position::Striker,
            development_multiplier: 1.0,
            coaching_mult: STANDARD_COACHING_MULT,
        }
    }

    fn staff(id: &str, role: StaffRole, judging_potential: u8) -> Staff {
        let mut staff = Staff::new(
            id.to_string(),
            "Ann".to_string(),
            id.to_string(),
            "1980-01-01".to_string(),
            role,
            StaffAttributes {
                coaching: 50,
                judging_ability: 50,
                judging_potential,
                physiotherapy: 30,
            },
        );
        staff.team_id = Some("club".to_string());
        staff
    }

    fn youngster(id: &str, potential: u8) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2008-03-01".to_string(),
            "GB".to_string(),
            Position::Striker,
            uniform_attributes(55),
        );
        player.team_id = Some("club".to_string());
        player.ovr = 55;
        player.potential = potential;
        player
    }

    /// A club of the user's on 16 June 2025 with `staff` and `players`.
    fn game_with(staff: Vec<Staff>, players: Vec<Player>) -> Game {
        let clock = GameClock::new(Utc.with_ymd_and_hms(2025, 6, 16, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "m".to_string(),
            "Max".to_string(),
            "Manager".to_string(),
            "1980-01-01".to_string(),
            "England".to_string(),
        );
        manager.hire("club".to_string());
        let team = Team::new(
            "club".to_string(),
            "Club FC".to_string(),
            "CLU".to_string(),
            "England".to_string(),
            "London".to_string(),
            "Ground".to_string(),
            20_000,
        );
        Game::new(clock, manager, vec![team], players, staff, vec![])
    }

    /// Given two youngsters alike in all but their true ceilings (70 and 90),
    /// when each is projected from the same read, then the projections are
    /// identical: the path comes from the read, never from the truth.
    #[test]
    fn projection_depends_only_on_the_read() {
        let game = game_with(vec![staff("s1", StaffRole::Scout, 50)], vec![]);
        let read = estimate((55, 55), (72, 84));
        let modest = youngster("a", 70);
        let gifted = youngster("a", 90);
        let project = |player: &Player| {
            projection_of(&game, player, read.clone(), None, CoachingBasis::Club, 1.1)
        };
        assert_eq!(project(&modest), project(&gifted));
    }

    /// Given a 17-year-old read at 55 with a ceiling of 75, when projected,
    /// then he grows every season, never past the ceiling from training, and
    /// the low line stays under the expected line under the high line.
    #[test]
    fn a_youngster_grows_toward_the_read_ceiling() {
        let read = estimate((52, 58), (70, 80));
        let projection = project(&input(&read, 17));
        let points = &projection.points;
        assert_eq!(points[0].expected, 55);
        assert!(points[1].expected > points[0].expected);
        assert!(
            points
                .iter()
                .all(|p| p.low <= p.expected && p.expected <= p.high)
        );
        // Training stops at the ceiling; seasonal aging adds at most a little.
        assert!(projection.peak_expected <= 75 + 3);
        assert!(projection.peak_expected >= 74);
    }

    /// Given the reference conditions, when a 17-year-old is projected at 1×
    /// and at 2×, then the faster career gets there sooner.
    #[test]
    fn a_faster_career_reaches_the_peak_sooner() {
        let read = estimate((50, 50), (80, 80));
        let slow = project(&input(&read, 17));
        let mut fast_input = input(&read, 17);
        fast_input.development_multiplier = 2.0;
        let fast = project(&fast_input);
        assert!(fast.points[2].expected > slow.points[2].expected);
    }

    /// Given a 29-year-old forward already at his ceiling, when projected,
    /// then he holds there to 34: training wins back the pace he loses from
    /// 30, as it does in the game, so he neither climbs nor collapses.
    #[test]
    fn a_veteran_at_his_ceiling_holds_there() {
        let read = estimate((75, 75), (75, 75));
        let projection = project(&input(&read, 29));
        assert!(
            projection
                .points
                .iter()
                .all(|p| (74..=76).contains(&p.expected))
        );
        assert_eq!(projection.points.last().unwrap().age, PROJECTION_LAST_AGE);
    }

    /// Given better coaching, when the same read is projected, then it grows
    /// faster.
    #[test]
    fn better_coaching_grows_faster() {
        let read = estimate((50, 50), (85, 85));
        let average = project(&input(&read, 18));
        let mut coached = input(&read, 18);
        coached.coaching_mult = 1.35;
        let better = project(&coached);
        assert!(better.points[1].expected > average.points[1].expected);
    }

    /// Given a scout and an assistant manager, when the club picks who judges
    /// its players, then the better judge of potential does, and nobody when
    /// it has neither.
    #[test]
    fn the_best_judge_of_potential_assesses() {
        let game = game_with(
            vec![
                staff("scout", StaffRole::Scout, 60),
                staff("assistant", StaffRole::AssistantManager, 75),
                staff("coach", StaffRole::Coach, 95),
            ],
            vec![],
        );
        assert_eq!(club_assessor(&game, "club").unwrap().id, "assistant");

        let nobody = game_with(
            vec![staff("coach", StaffRole::Coach, 95)],
            vec![youngster("a", 80)],
        );
        assert!(club_assessor(&nobody, "club").is_none());
        assert_eq!(
            player_projection(&nobody, "a").unwrap_err(),
            ERR_NO_ASSESSOR
        );
        let assessments = club_assessments(&nobody).unwrap();
        assert!(assessments.assessor.is_none() && assessments.players.is_empty());
    }

    /// Given a club's own youngster, when he is read twice in one month and
    /// again the next, then the month's reads agree, every read holds the
    /// truth, and the overall is exact.
    #[test]
    fn an_own_read_holds_for_the_month_and_contains_the_truth() {
        let mut game = game_with(
            vec![staff("s1", StaffRole::Scout, 10)],
            vec![youngster("a", 78)],
        );
        let assessor = game.staff[0].clone();
        let player = game.players[0].clone();
        let first = own_estimate(&game, &player, &assessor);
        let again = own_estimate(&game, &player, &assessor);
        assert_eq!(first, again);
        assert_eq!((first.ovr_low, first.ovr_high, first.ovr_band), (55, 55, 0));
        assert_eq!(first.potential_band, 12);

        for month in 7..=12 {
            game.clock = GameClock::new(Utc.with_ymd_and_hms(2025, month, 16, 12, 0, 0).unwrap());
            let read = own_estimate(&game, &player, &assessor);
            assert!((read.potential_low..=read.potential_high).contains(&78));
            assert!(read.potential_low >= player.ovr);
        }
    }

    /// Given a read whose middle is 90 or more for a growing teenager, when
    /// the club judges him, then he is its wonderkid, whatever his truth.
    #[test]
    fn a_wonderkid_is_what_the_read_says() {
        assert!(scouted_wonderkid(&estimate((70, 70), (86, 96)), 18));
        assert!(!scouted_wonderkid(&estimate((70, 70), (80, 90)), 18));
        assert!(!scouted_wonderkid(&estimate((70, 70), (86, 96)), 21));
    }

    /// Given a sharp judge (band ±2), when the club reads a youngster on the
    /// edge, then the badge follows the truth closely.
    #[test]
    fn a_sharp_judge_reads_wonderkids_close_to_the_truth() {
        let game = game_with(
            vec![staff("s1", StaffRole::Scout, 90)],
            vec![youngster("a", 97)],
        );
        let assessments = club_assessments(&game).unwrap();
        let read = &assessments.players[0];
        assert_eq!(read.potential_band, 2);
        assert!(read.potential_low >= 93);
        assert_eq!(
            read.potential_believed,
            believed(read.potential_low, read.potential_high)
        );
        assert!(read.wonderkid);
    }

    /// Given a player the club neither owns nor watches, when it is asked for
    /// a projection, then it has none.
    #[test]
    fn a_stranger_is_not_assessed() {
        let mut stranger = youngster("x", 80);
        stranger.team_id = Some("other".to_string());
        let game = game_with(vec![staff("s1", StaffRole::Scout, 70)], vec![stranger]);
        assert_eq!(player_projection(&game, "x").unwrap_err(), ERR_NOT_ASSESSED);
    }

    /// Given the club's own player and the club's own coaches, when he is
    /// projected, then the projection says it assumed the club's coaching.
    #[test]
    fn an_own_player_is_projected_under_the_clubs_coaching() {
        let game = game_with(
            vec![staff("s1", StaffRole::Scout, 70)],
            vec![youngster("a", 80)],
        );
        let projection = player_projection(&game, "a").unwrap();
        assert_eq!(projection.reference.coaching, CoachingBasis::Club);
        assert_eq!(projection.assessor.unwrap().staff_id, "s1");
        assert_eq!(projection.reference.playing_time, REFERENCE_PLAYING_TIME);
    }
}
