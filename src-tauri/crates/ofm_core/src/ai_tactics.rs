//! The weekly tactical review of the clubs the player does not manage, over a save. The rules —
//! blueprints, what a manager reads in his squad and his results, what he does about it — are
//! `ofm_rules::ai_tactics`, shared with the online server; this module picks the clubs due today,
//! reads their results out of the calendar, and writes the plan back.

use crate::game::Game;
use domain::league::FixtureStatus;
use domain::player::Player;
pub(crate) use ofm_rules::ai_tactics::review_weekday;
#[cfg(test)]
use ofm_rules::ai_tactics::*;
use ofm_rules::ai_tactics::{FormReading, match_plan, read_squad};
pub use ofm_rules::ai_tactics::{blueprint_for, under_priced_dials};

/// The AI clubs whose weekly review falls on this weekday: every club but the
/// player's, each on a day of its own. The one answer to "which clubs sit down
/// to look at themselves today" — the tactical review and the contract review
/// both ask it, so a club reviews its tactics and its contracts together.
pub(crate) fn ai_clubs_reviewing_on(game: &Game, weekday_num: u32) -> Vec<String> {
    ai_clubs(game)
        .into_iter()
        .filter(|team_id| review_weekday(team_id) == weekday_num)
        .collect()
}

/// Every club the AI manages: all but the player's, in the order clubs are
/// stored.
pub(crate) fn ai_clubs(game: &Game) -> Vec<String> {
    let user_team_id = game.manager.team_id.as_deref();
    game.teams
        .iter()
        .filter(|team| Some(team.id.as_str()) != user_team_id)
        .map(|team| team.id.clone())
        .collect()
}

/// Every club's recent results, most recent first, across every competition it
/// plays in — a cup exit says as much about a plan as a league defeat.
///
/// Built as one pass over the world's fixtures and then looked up, rather than
/// scanned once per club: this runs for a seventh of the clubs in the world
/// every day, and a populated world holds tens of thousands of fixtures.
fn read_form(game: &Game) -> std::collections::HashMap<String, FormReading> {
    let results = game
        .competitions_in_play()
        .iter()
        .flat_map(|competition| competition.fixtures.iter())
        .filter(|fixture| fixture.status == FixtureStatus::Completed)
        .filter_map(|fixture| {
            let result = fixture.result.as_ref()?;
            let (home, away) = (u32::from(result.home_goals), u32::from(result.away_goals));
            Some([
                (
                    fixture.home_team_id.as_str(),
                    fixture.date.as_str(),
                    home,
                    away,
                ),
                (
                    fixture.away_team_id.as_str(),
                    fixture.date.as_str(),
                    away,
                    home,
                ),
            ])
        })
        .flatten();
    ofm_rules::ai_tactics::read_form(results)
}

/// Every club the player does not manage looks at how it plays, once a week:
/// its dials, its shape (GĐ5 P5.1) and its players' roles.
///
/// This is what pays for slices 6 and 7 shipping without a backfill. A save made
/// before them carries the neutral blueprint and an empty role map on every AI
/// club; nothing here treats that as a special case, so those clubs simply get
/// their identity at their first review like everyone else.
///
/// Deliberate, and worth saying out loud: a club the player leaves becomes an AI
/// club, and its next review overwrites the tactics and the roles the player set
/// there. That is a new manager taking over and doing it his way.
pub fn apply_ai_tactical_reviews(game: &mut Game, weekday_num: u32) {
    let due = ai_clubs_reviewing_on(game, weekday_num);

    // One pass over the world's fixtures for everybody, not one per club.
    let form = read_form(game);

    for team_id in due {
        let Some(team_index) = game.teams.iter().position(|team| team.id == team_id) else {
            continue;
        };

        // Disjoint field borrows: the squad is read out of `game.players` while
        // the club is written through `game.teams`.
        let squad: Vec<&Player> = game
            .players
            .iter()
            .filter(|player| player.team_id.as_deref() == Some(team_id.as_str()))
            .collect();
        let reading = read_squad(&squad);

        // The shape is judged on who can play this week, like the eleven it
        // is chosen to suit (GĐ5 P5.1, X83).
        let available: Vec<&Player> = squad
            .iter()
            .copied()
            .filter(|player| player.injury.is_none())
            .collect();

        let team = &mut game.teams[team_index];
        team.tactics_phase = match_plan(&team.play_style, reading.as_ref(), form.get(&team_id));
        team.formation =
            crate::ai_formation::reviewed_formation(&team.formation, &available, &team.play_style);
        crate::ai_roles::assign_squad_roles(team, squad.iter().copied());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use domain::league::{Fixture, FixtureCompetition, League, MatchResult};
    use domain::manager::Manager;
    use domain::player::PlayerAttributes;
    use domain::player::Position;
    use domain::team::Team;
    use domain::team::{
        BreakSpeed, BuildUpStyle, CounterPressDuration, CrossStyle, DefensiveLine, DefensiveShape,
        PitchWidth, PlayStyle, PressingIntensity, TacticsPhaseSettings, Tempo,
    };

    fn form_game() -> Game {
        let clock =
            crate::clock::GameClock::new(Utc.with_ymd_and_hms(2026, 8, 1, 12, 0, 0).unwrap());
        let mut manager = Manager::new(
            "manager".into(),
            "Test".into(),
            "Manager".into(),
            "1980-01-01".into(),
            "England".into(),
        );
        manager.hire("user".into());
        let mut teams: Vec<Team> = ["home", "away", "user"]
            .into_iter()
            .map(|id| {
                Team::new(
                    id.into(),
                    id.into(),
                    id.into(),
                    "England".into(),
                    "London".into(),
                    "Ground".into(),
                    20_000,
                )
            })
            .collect();
        teams[0].play_style = PlayStyle::Attacking;
        let participants = teams.iter().map(|team| team.id.clone()).collect::<Vec<_>>();
        let mut league = League::new("league".into(), "League".into(), 2026, &participants);
        for (index, (home, away, home_goals, away_goals)) in [
            ("home", "away", 1, 4),
            ("away", "home", 5, 0),
            ("home", "away", 0, 3),
        ]
        .into_iter()
        .enumerate()
        {
            league.fixtures.push(Fixture {
                id: format!("fixture-{index}"),
                competition_id: "league".into(),
                matchday: index as u32 + 1,
                date: format!("2026-08-{:02}", index + 1),
                home_team_id: home.into(),
                away_team_id: away.into(),
                competition: FixtureCompetition::League,
                status: FixtureStatus::Completed,
                result: Some(MatchResult {
                    home_goals,
                    away_goals,
                    ..Default::default()
                }),
            });
        }
        let mut game = Game::new(clock, manager, teams, vec![], vec![], vec![]);
        game.competitions = vec![league];
        game
    }

    const EVERY_STYLE: [PlayStyle; 6] = [
        PlayStyle::Balanced,
        PlayStyle::Attacking,
        PlayStyle::Defensive,
        PlayStyle::Possession,
        PlayStyle::Counter,
        PlayStyle::HighPress,
    ];

    #[test]
    fn every_style_but_balanced_takes_the_field_with_something_to_say() {
        for style in EVERY_STYLE.iter().filter(|s| **s != PlayStyle::Balanced) {
            assert_ne!(
                blueprint_for(style),
                TacticsPhaseSettings::default(),
                "{style:?} is still running the neutral default blueprint"
            );
        }
    }

    #[test]
    fn balanced_is_the_neutral_blueprint_on_purpose() {
        // Not an oversight: it is the control the other five are read against,
        // and the style whose whole character is having no bias.
        assert_eq!(
            blueprint_for(&PlayStyle::Balanced),
            TacticsPhaseSettings::default()
        );
    }

    #[test]
    fn a_high_press_club_actually_presses() {
        let blueprint = blueprint_for(&PlayStyle::HighPress);
        assert_eq!(blueprint.pressing_intensity, PressingIntensity::Aggressive);
        assert_eq!(blueprint.defensive_line, DefensiveLine::High);
        assert_eq!(
            blueprint.counter_press_duration,
            CounterPressDuration::Long,
            "pressing without winning the ball straight back is not a high press"
        );
    }

    #[test]
    fn a_counter_club_sits_deep_and_breaks_fast() {
        let blueprint = blueprint_for(&PlayStyle::Counter);
        assert_eq!(blueprint.defensive_line, DefensiveLine::Low);
        assert_eq!(blueprint.break_speed, BreakSpeed::Fast);
        assert_eq!(
            blueprint.counter_press_duration,
            CounterPressDuration::None,
            "a counter-attacking side does not want the ball back high up the pitch"
        );
    }

    #[test]
    fn a_possession_club_keeps_the_ball_and_hunts_it_back() {
        let blueprint = blueprint_for(&PlayStyle::Possession);
        assert_eq!(blueprint.build_up_style, BuildUpStyle::Short);
        assert_eq!(blueprint.tempo, Tempo::Patient);
        assert_eq!(
            blueprint.counter_press_duration,
            CounterPressDuration::Long,
            "possession football is counter-pressing football"
        );
    }

    #[test]
    fn a_defensive_club_sits_deeper_than_an_attacking_one() {
        assert_eq!(
            blueprint_for(&PlayStyle::Defensive).defensive_line,
            DefensiveLine::Low
        );
        assert_eq!(
            blueprint_for(&PlayStyle::Attacking).defensive_line,
            DefensiveLine::High
        );
    }

    /// The one-sided dials are rationed, and this is what keeps that honest as
    /// the table gets edited. No style may stack every dial the engine
    /// currently under-prices: that is how an identity becomes a free win.
    #[test]
    fn no_identity_stacks_every_under_priced_dial() {
        for style in EVERY_STYLE {
            let blueprint = blueprint_for(&style);
            let one_sided = [
                blueprint.defensive_line == DefensiveLine::VeryLow
                    || blueprint.defensive_line == DefensiveLine::Low,
                blueprint.defensive_shape == DefensiveShape::Compact,
                blueprint.width == PitchWidth::Narrow,
                blueprint.counter_press_duration == CounterPressDuration::Long,
            ];
            let taken = one_sided.iter().filter(|t| **t).count();
            assert!(
                taken <= 2,
                "{style:?} takes {taken} of the four dials the engine under-prices; \
                 no identity may hold more than two until the engine charges for them"
            );
        }
    }

    #[test]
    fn a_blueprint_is_a_pure_function_of_the_style() {
        for style in EVERY_STYLE {
            assert_eq!(
                blueprint_for(&style),
                blueprint_for(&style),
                "{style:?} gave two different blueprints"
            );
        }
    }

    // -----------------------------------------------------------------------
    // The weekly review
    // -----------------------------------------------------------------------

    fn a_squad_that_can_run() -> SquadReading {
        SquadReading {
            legs: 75.0,
            defensive_pace: 75.0,
            aerial_threat: 75.0,
            ground_threat: 70.0,
        }
    }

    fn a_squad_with_no_legs() -> SquadReading {
        SquadReading {
            legs: 40.0,
            defensive_pace: 75.0,
            aerial_threat: 75.0,
            ground_threat: 70.0,
        }
    }

    fn a_slow_back_line() -> SquadReading {
        SquadReading {
            legs: 75.0,
            defensive_pace: 40.0,
            aerial_threat: 75.0,
            ground_threat: 70.0,
        }
    }

    /// Given an attacking side, which crosses high, with small, sharp forwards,
    /// and one with small forwards who are no sharper on the ground,
    /// when its plan is made,
    /// then the first crosses low and the second mixes it; with forwards who
    /// win it in the air it keeps crossing high (phase 2, P3.4).
    #[test]
    fn a_side_with_nobody_to_head_it_stops_crossing_high() {
        let style = PlayStyle::Attacking;
        assert_eq!(blueprint_for(&style).cross_style, CrossStyle::High);
        let reading = |aerial_threat, ground_threat| SquadReading {
            aerial_threat,
            ground_threat,
            ..a_squad_that_can_run()
        };
        let plan = |r: SquadReading| match_plan(&style, Some(&r), None).cross_style;
        assert_eq!(plan(reading(60.0, 75.0)), CrossStyle::Low);
        assert_eq!(plan(reading(60.0, 65.0)), CrossStyle::Mixed);
        assert_eq!(plan(reading(80.0, 75.0)), CrossStyle::High);
    }

    /// Given each play style,
    /// when its blueprint is read,
    /// then its cross style follows S2 §3.2.
    #[test]
    fn each_style_crosses_its_own_way() {
        let cross = |style| blueprint_for(&style).cross_style;
        assert_eq!(cross(PlayStyle::Balanced), CrossStyle::Mixed);
        assert_eq!(cross(PlayStyle::HighPress), CrossStyle::Mixed);
        assert_eq!(cross(PlayStyle::Attacking), CrossStyle::High);
        assert_eq!(cross(PlayStyle::Defensive), CrossStyle::High);
        assert_eq!(cross(PlayStyle::Possession), CrossStyle::Low);
        assert_eq!(cross(PlayStyle::Counter), CrossStyle::Early);
    }

    /// Conceding at exactly the rate that says the plan is not holding, and
    /// scoring well enough that the other trigger stays quiet.
    fn leaking() -> FormReading {
        FormReading {
            conceded_per_game: LEAKY,
            scored_per_game: 2.0,
        }
    }

    /// Scoring at exactly the blunt rate, and keeping them out at the other end.
    fn toothless() -> FormReading {
        FormReading {
            conceded_per_game: 1.0,
            scored_per_game: BLUNT,
        }
    }

    #[test]
    fn a_squad_good_enough_to_run_the_plan_and_no_bad_run_behind_it_just_plays_the_plan() {
        for style in EVERY_STYLE {
            assert_eq!(
                match_plan(&style, Some(&a_squad_that_can_run()), None),
                blueprint_for(&style),
                "{style:?} was talked out of its own identity for no reason"
            );
        }
    }

    #[test]
    fn a_squad_without_the_legs_is_not_asked_to_press_for_ninety_minutes() {
        let plan = match_plan(&PlayStyle::HighPress, Some(&a_squad_with_no_legs()), None);
        assert_eq!(
            plan.pressing_intensity,
            PressingIntensity::Medium,
            "a squad that cannot run was still sent out to press aggressively"
        );
        assert_eq!(plan.counter_press_duration, CounterPressDuration::Short);
    }

    #[test]
    fn a_slow_back_line_is_not_asked_to_hold_a_high_line() {
        for style in [
            PlayStyle::Attacking,
            PlayStyle::Possession,
            PlayStyle::HighPress,
        ] {
            let plan = match_plan(&style, Some(&a_slow_back_line()), None);
            assert_ne!(
                plan.defensive_line,
                DefensiveLine::High,
                "{style:?} pushed a defence that cannot turn up the pitch"
            );
        }
    }

    #[test]
    fn a_side_that_keeps_conceding_changes_something_at_the_back() {
        for style in EVERY_STYLE {
            let settled = match_plan(&style, Some(&a_squad_that_can_run()), None);
            let reacting = match_plan(&style, Some(&a_squad_that_can_run()), Some(&leaking()));
            assert_ne!(
                settled, reacting,
                "{style:?} conceded three a game for a month and changed nothing"
            );
        }
    }

    #[test]
    fn a_side_that_cannot_score_changes_something_going_forward() {
        for style in EVERY_STYLE {
            let settled = match_plan(&style, Some(&a_squad_that_can_run()), None);
            let reacting = match_plan(&style, Some(&a_squad_that_can_run()), Some(&toothless()));
            assert_ne!(
                settled, reacting,
                "{style:?} has not scored in a month and changed nothing"
            );
        }
    }

    #[test]
    fn blunt_slow_blueprints_gain_an_effective_fast_break() {
        for style in [PlayStyle::Defensive, PlayStyle::Possession] {
            let plan = match_plan(&style, None, Some(&toothless()));
            assert_eq!(
                plan.break_speed,
                BreakSpeed::Fast,
                "{style:?} still cannot break fast"
            );
            assert_ne!(plan.break_speed, blueprint_for(&style).break_speed);
        }
    }

    #[test]
    fn completed_home_and_away_results_read_from_each_clubs_perspective() {
        let game = form_game();
        let form = read_form(&game);
        let home = &form["home"];
        let away = &form["away"];
        assert_eq!(home.scored_per_game, 1.0 / 3.0);
        assert_eq!(home.conceded_per_game, 4.0);
        assert_eq!(away.scored_per_game, 4.0);
        assert_eq!(away.conceded_per_game, 1.0 / 3.0);
    }

    #[test]
    fn a_leaky_club_reacts_to_real_results_at_its_review() {
        let mut game = form_game();
        apply_ai_tactical_reviews(&mut game, review_weekday("home"));
        let home = game.teams.iter().find(|team| team.id == "home").unwrap();
        assert_eq!(home.tactics_phase.defensive_shape, DefensiveShape::Compact);
    }

    /// A squad built for three centre backs and wing-backs, on `team_id`.
    fn back_three_squad(team_id: &str) -> Vec<Player> {
        use domain::player::Footedness;
        [
            (Position::Goalkeeper, 70),
            (Position::LeftWingBack, 72),
            (Position::RightWingBack, 72),
            (Position::CenterBack, 74),
            (Position::CenterBack, 74),
            (Position::CenterBack, 74),
            (Position::DefensiveMidfielder, 70),
            (Position::CentralMidfielder, 70),
            (Position::CentralMidfielder, 70),
            (Position::AttackingMidfielder, 70),
            (Position::Striker, 70),
            (Position::Striker, 70),
            (Position::CentralMidfielder, 62),
        ]
        .into_iter()
        .enumerate()
        .map(|(i, (position, value))| {
            let mut player = Player::new(
                format!("{team_id}-{i:02}"),
                "Test".into(),
                format!("Test {i}"),
                "1998-01-01".into(),
                "England".into(),
                position,
                crate::test_support::uniform_attributes(value),
            );
            player.team_id = Some(team_id.into());
            player.footedness = Footedness::Both;
            player
        })
        .collect()
    }

    /// Given an AI club and the player's club, both with a squad built for a
    /// back three and both still on the default 4-4-2,
    /// when every club's weekly review has run,
    /// then the AI club plays a back three and the player's club keeps the
    /// shape the player chose.
    #[test]
    fn an_ai_club_moves_to_the_shape_its_squad_is_built_for_and_the_players_club_does_not() {
        let mut game = form_game();
        game.players = [back_three_squad("away"), back_three_squad("user")].concat();
        for weekday in 0..7 {
            apply_ai_tactical_reviews(&mut game, weekday);
        }
        let shape = |id: &str| {
            game.teams
                .iter()
                .find(|team| team.id == id)
                .unwrap()
                .formation
                .clone()
        };
        assert!(
            ["5-3-2", "3-4-2-1"].contains(&shape("away").as_str()),
            "the AI club plays {}",
            shape("away")
        );
        assert_eq!(shape("user"), "4-4-2");
    }

    /// Given an AI club with no players to judge a shape by,
    /// when its weekly review runs,
    /// then it keeps the shape it has.
    #[test]
    fn a_club_with_too_few_players_to_judge_keeps_its_shape() {
        let mut game = form_game();
        apply_ai_tactical_reviews(&mut game, review_weekday("home"));
        let home = game.teams.iter().find(|team| team.id == "home").unwrap();
        assert_eq!(home.formation, "4-4-2");
    }

    #[test]
    fn a_second_review_of_the_same_game_changes_nothing() {
        let mut game = form_game();
        let weekday = review_weekday("home");
        apply_ai_tactical_reviews(&mut game, weekday);
        let first = game.teams.clone();
        assert_ne!(first[0].tactics_phase, blueprint_for(&PlayStyle::Attacking));
        apply_ai_tactical_reviews(&mut game, weekday);
        for (first, second) in first.iter().zip(&game.teams) {
            assert_eq!(first.tactics_phase, second.tactics_phase);
            assert_eq!(first.player_roles, second.player_roles);
        }
    }

    #[test]
    fn squad_reading_excludes_injured_stars_and_reads_the_defenders_pace() {
        let make_player = |id: &str, position: Position, stamina: u8, pace: u8, injured: bool| {
            let attributes = PlayerAttributes {
                pace,
                stamina,
                strength: 50,
                agility: 50,
                passing: 50,
                shooting: 50,
                tackling: 50,
                dribbling: 50,
                defending: 50,
                positioning: 50,
                vision: 50,
                decisions: 50,
                composure: 50,
                aggression: 50,
                teamwork: 50,
                leadership: 50,
                handling: 50,
                reflexes: 50,
                aerial: 50,
                long_passing: 0,
                crossing: 0,
                curve: 0,
                free_kick: 0,
                long_shots: 0,
                first_touch: 0,
                heading: 0,
            };
            let mut player = Player::new(
                id.into(),
                id.into(),
                id.into(),
                "1998-01-01".into(),
                "England".into(),
                position,
                attributes,
            );
            player.ovr = if injured { 99 } else { 60 };
            if injured {
                player.injury = Some(domain::player::Injury {
                    name: "Test".into(),
                    days_remaining: 3,
                });
            }
            player
        };
        let players = [
            make_player("defender", Position::Defender, 50, 45, false),
            make_player("forward", Position::Forward, 70, 90, false),
            make_player("injured", Position::Defender, 99, 99, true),
        ];
        let squad = players.iter().collect::<Vec<_>>();
        let reading = read_squad(&squad).unwrap();
        assert_eq!(reading.legs, 60.0);
        assert_eq!(reading.defensive_pace, 45.0);
    }

    /// The ration itself, not just today's blueprints. Every current blueprint
    /// plus one reaction stays within the ration on its own, so the sweep below
    /// cannot tell a review that checks it from one that does not. Here a plan
    /// already at the limit is offered a move that would take a third
    /// under-priced dial, and then a move that would not: the first must be
    /// refused and the second taken.
    #[test]
    fn a_review_will_not_take_a_dial_past_the_ration() {
        let mut plan = TacticsPhaseSettings {
            defensive_line: DefensiveLine::Low,
            defensive_shape: DefensiveShape::Compact,
            ..TacticsPhaseSettings::default()
        };
        assert_eq!(
            under_priced_dials(&plan),
            engine::ai::MAX_UNDER_PRICED_DIALS,
            "the plan should start at the limit, or this test proves nothing"
        );

        fn narrow(settings: &mut TacticsPhaseSettings) -> bool {
            let changed = settings.width != PitchWidth::Narrow;
            settings.width = PitchWidth::Narrow;
            changed
        }
        fn press_harder(settings: &mut TacticsPhaseSettings) -> bool {
            let changed = settings.pressing_intensity != PressingIntensity::Aggressive;
            settings.pressing_intensity = PressingIntensity::Aggressive;
            changed
        }

        shade(&mut plan, &[narrow, press_harder]);

        assert_ne!(
            plan.width,
            PitchWidth::Narrow,
            "a third under-priced dial was taken past the ration"
        );
        assert_eq!(
            plan.pressing_intensity,
            PressingIntensity::Aggressive,
            "the next move within the ration should have been taken instead"
        );
    }

    /// The reason this exists: the natural answer to conceding is a deeper line
    /// and a compact block, two of the four dials the engine priced one-sidedly.
    /// Left alone, adaptation would quietly undo the ration on the blueprints,
    /// and every struggling club in the world would converge on the same shape.
    #[test]
    fn no_adaptation_stacks_every_under_priced_dial() {
        let squads = [
            None,
            Some(a_squad_that_can_run()),
            Some(a_squad_with_no_legs()),
            Some(a_slow_back_line()),
        ];
        let forms = [
            None,
            Some(leaking()),
            Some(toothless()),
            Some(FormReading {
                conceded_per_game: 4.0,
                scored_per_game: 0.0,
            }),
        ];
        for style in EVERY_STYLE {
            for squad in &squads {
                for form in &forms {
                    let plan = match_plan(&style, squad.as_ref(), form.as_ref());
                    let taken = under_priced_dials(&plan);
                    assert!(
                        taken <= engine::ai::MAX_UNDER_PRICED_DIALS,
                        "{style:?} ended up holding {taken} of the four under-priced \
                         dials after adapting: {plan:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn reviewing_twice_says_the_same_thing_twice() {
        // The plan is rebuilt from the blueprint each time rather than nudged
        // from what is stored, so a club cannot ratchet itself somewhere no
        // manager chose. A second review on the same evidence is a no-op.
        let first = match_plan(
            &PlayStyle::HighPress,
            Some(&a_squad_with_no_legs()),
            Some(&leaking()),
        );
        let second = match_plan(
            &PlayStyle::HighPress,
            Some(&a_squad_with_no_legs()),
            Some(&leaking()),
        );
        assert_eq!(first, second);
    }

    #[test]
    fn a_clubs_review_day_is_its_own_and_does_not_move() {
        assert_eq!(review_weekday("club-42"), review_weekday("club-42"));

        let mut days = std::collections::HashSet::new();
        for index in 0..500 {
            days.insert(review_weekday(&format!("club-{index}")));
        }
        assert_eq!(
            days.len(),
            REVIEW_CYCLE_DAYS as usize,
            "the review lands on {} of the seven days, so it is not spread across \
             the week at all",
            days.len()
        );
    }
}
