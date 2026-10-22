//! Players and staff written in a world package: what the author gave is kept, the rest is drawn
//! the way a generated person is (`ofm_rules::worldgen::generation`). Kept here because it reads
//! the package's own types.

use domain::player::{Player, PlayerAttributes, Position};
use domain::staff::Staff;
use rand::{Rng, RngExt};

use super::authored_player::resolve_authored_contract;
use super::definitions::NamesDefinition;
use crate::player_rating::{generate_potential_for, refresh_player_derived};
use ofm_rules::worldgen::generation::*;
use ofm_rules::worldgen::physique::sample_physique;

// ---------------------------------------------------------------------------
// Authored staff (world packages)
// ---------------------------------------------------------------------------

/// Convert a hand-authored [`super::package::StaffDef`] into a domain [`Staff`].
/// Fills any missing fields (id, dob, attributes) with sensible random defaults.
pub(super) fn generate_staff_from_authored_def(
    def: &super::package::StaffDef,
    team_id: Option<&str>,
    opening_year: u32,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> Staff {
    let nationality = if def.nationality.is_empty() {
        "ENG"
    } else {
        def.nationality.as_str()
    };
    let first_name = if def.first_name.is_empty() {
        let (f, _) = pick_name_from_def(nationality, names_def, rng);
        f
    } else {
        def.first_name.clone()
    };
    let last_name = if def.last_name.is_empty() {
        let (_, l) = pick_name_from_def(nationality, names_def, rng);
        l
    } else {
        def.last_name.clone()
    };

    let current_year: u32 = opening_year;
    let birth_year = if let Some(dob) = &def.date_of_birth {
        dob.split('-')
            .next()
            .and_then(|y| y.parse::<u32>().ok())
            .unwrap_or(current_year.saturating_sub(40))
    } else if let Some(age) = def.age {
        current_year.saturating_sub(age)
    } else {
        current_year.saturating_sub(rng.random_range(30..55))
    };
    let dob = def
        .date_of_birth
        .clone()
        .unwrap_or_else(|| format!("{birth_year:04}-01-01"));

    let attributes = def.attributes.clone().unwrap_or_else(|| {
        generate_random_staff_from_def(
            team_id.unwrap_or(""),
            def.role.clone(),
            nationality,
            opening_year,
            names_def,
            rng,
        )
        .attributes
    });

    let id = if def.id.is_empty() {
        crate::seed::uuid_from(rng)
    } else {
        def.id.clone()
    };
    let mut s = Staff::new(id, first_name, last_name, dob, def.role.clone(), attributes);
    s.nationality = nationality.to_string();
    s.team_id = team_id.map(|t| t.to_string());
    s.specialization = def.specialization.clone();
    s
}

fn resolve_def_name(
    def: &super::package::PlayerDef,
    nationality: &str,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> (String, String) {
    if !def.first_name.is_empty() || !def.last_name.is_empty() {
        (def.first_name.clone(), def.last_name.clone())
    } else if !def.name.is_empty() {
        let mut parts = def.name.splitn(2, ' ');
        let first = parts.next().unwrap_or("").to_string();
        let last = parts.next().unwrap_or("").to_string();
        (first, last)
    } else {
        pick_name_from_def(nationality, names_def, rng)
    }
}

fn resolve_birth_year(
    def: &super::package::PlayerDef,
    opening_year: u32,
    rng: &mut impl Rng,
) -> u32 {
    if let Some(dob) = &def.date_of_birth {
        dob.get(0..4)
            .and_then(|year| year.parse::<u32>().ok())
            .unwrap_or(opening_year.saturating_sub(24))
    } else if let Some(age) = def.age {
        opening_year.saturating_sub(age)
    } else {
        opening_year.saturating_sub(rng.random_range(18..34))
    }
}

/// The ability an authored player gets when they declare neither `overall` nor
/// an `attributes` block.
///
/// Shared with `package`'s potential validation on purpose: that check has to
/// compare against the ability generation will actually use, and a second copy
/// of this number would let a package validate and then be generated against a
/// different floor.
pub(crate) const DEFAULT_AUTHORED_OVERALL: u8 = 65;

/// Pull an engine-invented attribute spread down until it sits at or below an
/// authored ceiling.
///
/// `attributes_for_overall` jitters around its target and clamps every attribute
/// to a floor of 30, so the ovr it produces lands *near* the authored `overall`
/// rather than on it — and below 30 it cannot land there at all. Since
/// `refresh_player_derived` floors potential at ovr, that quietly raised a
/// ceiling the author had written: measured at 26-32% for mid-range abilities,
/// and every single time below the clamp floor.
///
/// The rule this keeps: **the engine may bound what the engine invented, and
/// never touches what the author wrote.** It is applied only to a spread
/// synthesized from `overall`; an explicit `attributes` block is left exactly as
/// written, and a ceiling below what that block is worth is reported by package
/// validation instead.
///
/// Converges in a pass or two — ovr is a weighted mean of the attributes minus a
/// penalty, so subtracting the overshoot from every attribute overshoots
/// downward at worst. The iteration cap is a belt-and-braces stop, not a
/// expectation of slow convergence.
fn bound_attributes_by_ceiling(
    attributes: &mut PlayerAttributes,
    position: &Position,
    ceiling: u8,
) {
    for _ in 0..4 {
        let ovr = crate::player_rating::ovr_from_attributes(attributes, position).round() as u8;
        let Some(overshoot) = ovr.checked_sub(ceiling).filter(|delta| *delta > 0) else {
            return;
        };
        for slot in [
            &mut attributes.pace,
            &mut attributes.stamina,
            &mut attributes.strength,
            &mut attributes.agility,
            &mut attributes.passing,
            &mut attributes.shooting,
            &mut attributes.tackling,
            &mut attributes.dribbling,
            &mut attributes.defending,
            &mut attributes.positioning,
            &mut attributes.vision,
            &mut attributes.decisions,
            &mut attributes.composure,
            &mut attributes.aggression,
            &mut attributes.teamwork,
            &mut attributes.leadership,
            &mut attributes.handling,
            &mut attributes.reflexes,
            &mut attributes.aerial,
        ] {
            *slot = slot.saturating_sub(overshoot).max(1);
        }
        // Split attributes still at 0 are undeclared and derived later; only
        // declared ones are bounded, and never down to 0.
        for slot in [
            &mut attributes.long_passing,
            &mut attributes.crossing,
            &mut attributes.curve,
            &mut attributes.free_kick,
            &mut attributes.long_shots,
            &mut attributes.first_touch,
            &mut attributes.heading,
        ] {
            if *slot != 0 {
                *slot = slot.saturating_sub(overshoot).max(1);
            }
        }
    }
}

/// Convert a hand-authored [`PlayerDef`](super::package::PlayerDef) into a full
/// player for `team_id`. Ability comes from an explicit `attributes` block or is
/// generated around `overall`; identity falls back to the name pools when not
/// given.
pub(super) fn generate_player_from_def(
    def: &super::package::PlayerDef,
    team_id: &str,
    opening_year: u32,
    names_def: &NamesDefinition,
    rng: &mut impl Rng,
) -> Player {
    let nationality = canonicalize_generated_nationality(&def.nationality);
    let (first_name, last_name) = resolve_def_name(def, &nationality, names_def, rng);
    let full_name = format!("{first_name} {last_name}").trim().to_string();
    let match_name = if last_name.is_empty() {
        full_name.clone()
    } else {
        last_name
    };

    let current_year: u32 = opening_year;
    let birth_year = resolve_birth_year(def, opening_year, rng);
    let dob = def
        .date_of_birth
        .clone()
        .unwrap_or_else(|| format!("{birth_year:04}-01-01"));
    let age = current_year.saturating_sub(birth_year);

    // Drawn whether or not the author fixed a height or weight, so authoring one
    // does not shift the random numbers every later draw sees.
    let body = sample_physique(&def.position, def.height_cm, def.weight_kg, rng);
    let mut attributes = def.attributes.clone().unwrap_or_else(|| {
        attributes_for_overall(
            def.overall.unwrap_or(DEFAULT_AUTHORED_OVERALL),
            &def.position,
            &body,
            rng,
        )
    });

    // Only a spread this function invented, and only when a ceiling was authored.
    // Bounding it here rather than after `Player::new` keeps market value and
    // wage sized from the attributes the player actually ends up with.
    // A package from before the 26-attribute split carries the seven split
    // attributes as 0: derive them before anything rates the player.
    crate::attribute_split::split_legacy_attributes(&mut attributes, &def.position);
    if let (Some(ceiling), None) = (def.potential, def.attributes.as_ref()) {
        bound_attributes_by_ceiling(&mut attributes, &def.position, ceiling);
    }

    // Rolled whether or not a contract was authored, so a package that authors none
    // draws exactly the random numbers it always did and generates the same players.
    let contract_years = if age <= 27 {
        rng.random_range(2..6)
    } else {
        rng.random_range(1..4)
    };
    let generated_contract_end = format!("{}-06-30", opening_year.saturating_add(contract_years));
    // Validation is what tells an author their contract cannot be resolved. Generation
    // never panics on one and falls back to the roll, as it would for no contract.
    let authored_contract =
        resolve_authored_contract(def, opening_year, contract_years).unwrap_or_default();
    let contract_date = |date: chrono::NaiveDate| date.format("%Y-%m-%d").to_string();

    let id = if def.id.is_empty() {
        crate::seed::uuid_from(rng)
    } else {
        def.id.clone()
    };
    let mut player = Player::new(
        id,
        match_name,
        full_name,
        dob,
        nationality,
        def.position.clone(),
        attributes,
    );
    player.team_id = Some(team_id.to_string());
    // An authored photo is write-only metadata unless it is copied onto the
    // domain player: `PlayerAvatar` renders `media.face`, and the procedural
    // portrait generator stands down whenever it is set.
    player.media.face = def
        .photo
        .as_ref()
        .map(|photo| photo.trim().to_string())
        .filter(|photo| !photo.is_empty());
    player.stage_contract_start(authored_contract.start.map(contract_date));
    player.stage_contract_end(Some(
        authored_contract
            .end
            .map(contract_date)
            .unwrap_or(generated_contract_end),
    ));
    player.condition = def.condition.unwrap_or_else(|| rng.random_range(75..100));
    player.morale = def.morale.unwrap_or_else(|| rng.random_range(40..76));
    if let Some(ref foot_str) = def.footedness {
        player.footedness = match foot_str.as_str() {
            "Left" => domain::player::Footedness::Left,
            "Both" => domain::player::Footedness::Both,
            _ => domain::player::Footedness::Right,
        };
    }
    if let Some(weak_foot) = def.weak_foot {
        player.weak_foot = weak_foot;
    }
    player.height_cm = body.height_cm;
    player.weight_kg = body.weight_kg;
    if !def.alternate_positions.is_empty() {
        player.alternate_positions = def.alternate_positions.clone();
    }
    // A club the package does not define has no id, so the domain's empty-string
    // convention for "no team" stands in; the name is what the profile shows.
    player.career = def
        .career_history
        .iter()
        .map(|entry| domain::player::CareerEntry {
            season: entry.season,
            team_id: entry.team_id.clone().unwrap_or_default(),
            team_name: entry.team_name.clone(),
            appearances: entry.appearances,
            goals: entry.goals,
            assists: entry.assists,
        })
        .collect();
    if def.youth {
        player.squad_role = domain::player::SquadRole::Youth;
    }
    // `build_package_club` settles clashes with the generated backfill and numbers
    // whoever is still without a shirt.
    player.jersey_number = def.jersey_number;

    let temp_ovr = {
        use crate::player_rating::natural_ovr;
        natural_ovr(&player).round() as u8
    };
    // An authored ceiling is the author's to set; only roll one when they did
    // not. `refresh_player_derived` then leaves a non-zero potential alone,
    // floored at current ovr — so nothing further is needed to make it stick.
    player.potential = def
        .potential
        .unwrap_or_else(|| generate_potential_for(&player.id, temp_ovr, age));
    refresh_player_derived(&mut player, current_year);
    // A habit, drawn once from the player's id (see `assigned_traits`).
    crate::assigned_traits::assign_traits(&mut player, current_year);
    // An authored figure wins; one left out is priced like any generated
    // player's, from the rating and potential he ended up with.
    player.market_value = def
        .value
        .unwrap_or_else(|| generated_market_value(&player, opening_year));
    player.stage_wage(
        def.wage
            .unwrap_or_else(|| crate::economy::valuation::market_wage(&player, None)),
    );
    player
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a `PlayerDef` from JSON rather than a struct literal.
    ///
    /// Deliberate: `potential` is new, so a struct literal naming it would not
    /// compile on a tree that predates the field — and this project requires a
    /// regression test to be *run* against the unfixed code. `PlayerDef` has no
    /// `deny_unknown_fields`, so the old tree ignores the key and these tests
    /// fail on behaviour rather than failing to build.
    fn player_def_from_json(value: serde_json::Value) -> super::super::package::PlayerDef {
        serde_json::from_value(value).expect("the fixture deserializes")
    }

    fn generate_from_json(value: serde_json::Value, opening_year: u32) -> Player {
        let names_def = super::super::definitions::default_names_definition();
        let mut rng = crate::seed::rng_from_u64(7);
        generate_player_from_def(
            &player_def_from_json(value),
            "club-id",
            opening_year,
            &names_def,
            &mut rng,
        )
    }

    /// An authored ceiling is the author's to set.
    ///
    /// A package could set a player's current ability but never their ceiling —
    /// it was always rolled from `ovr` and age, so a modder could write a
    /// 17-year-old at 55 but not say that he becomes a 92.
    #[test]
    fn an_authored_potential_is_kept() {
        let player = generate_from_json(
            serde_json::json!({
                "id": "wonder-kid",
                "firstName": "Wonder",
                "lastName": "Kid",
                "club": "club-id",
                "nationality": "ENG",
                "position": "Striker",
                "dateOfBirth": "2009-01-01",
                "overall": 55,
                "potential": 92,
            }),
            2026,
        );

        assert_eq!(player.potential, 92, "the authored ceiling was overwritten");
    }

    /// The same, for the author who specifies attributes rather than an overall.
    #[test]
    fn an_authored_potential_is_kept_in_attributes_mode() {
        let player = generate_from_json(
            serde_json::json!({
                "id": "precise-kid",
                "firstName": "Precise",
                "lastName": "Kid",
                "club": "club-id",
                "nationality": "ENG",
                "position": "CentralMidfielder",
                "dateOfBirth": "2009-01-01",
                "attributes": {
                    "pace": 50, "stamina": 50, "strength": 50,
                    "passing": 50, "shooting": 50, "tackling": 50,
                    "dribbling": 50, "defending": 50,
                    "positioning": 50, "vision": 50, "decisions": 50,
                },
                "potential": 88,
            }),
            2026,
        );

        assert_eq!(player.potential, 88, "the authored ceiling was overwritten");
    }

    /// Omitting it keeps the roll. The back-compat guarantee for every package
    /// already in the wild.
    ///
    /// Asserted against the age bonus band rather than "non-zero and >= ovr",
    /// which a regression that simply set `potential = ovr` would also pass.
    #[test]
    fn an_omitted_potential_is_still_rolled() {
        let player = generate_from_json(
            serde_json::json!({
                "id": "ordinary-kid",
                "firstName": "Ordinary",
                "lastName": "Kid",
                "club": "club-id",
                "nationality": "ENG",
                "position": "Striker",
                "dateOfBirth": "2009-01-01",
                "overall": 55,
            }),
            2026,
        );

        // `generate_potential_for` gives an under-18 a 15..=30 bonus over ovr,
        // capped at 99.
        let floor = player.ovr.saturating_add(15).min(99);
        let ceiling = player.ovr.saturating_add(30).min(99);
        assert!(
            (floor..=ceiling).contains(&player.potential),
            "a 17-year-old's rolled ceiling should sit {floor}..={ceiling}, got {}",
            player.potential
        );
    }

    // -- authored contract, wage, value and status ---------------------------
    //
    // Built from JSON for the same reason as the tests above. The dates used here
    // are ones generation can never produce (it always ends a contract on 30 June),
    // so an unfixed tree cannot pass by coincidence.

    fn striker_json(extra: serde_json::Value) -> serde_json::Value {
        let mut base = serde_json::json!({
            "id": "authored-striker",
            "firstName": "Authored",
            "lastName": "Striker",
            "club": "club-id",
            "nationality": "ENG",
            "position": "Striker",
            "dateOfBirth": "1990-05-01",
            "overall": 70,
        });
        base.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        base
    }

    #[test]
    fn an_authored_contract_end_is_kept() {
        let player = generate_from_json(
            striker_json(serde_json::json!({ "contractEnd": "2031-03-15" })),
            2026,
        );

        assert_eq!(player.contract_end(), Some("2031-03-15"));
        assert_eq!(
            player.contract_start(),
            None,
            "no start was authored, and one is given when the career opens, not here"
        );
    }

    /// A length resolves against the year the career opens in, which is what lets a
    /// package written for one era be played in another without every contract
    /// having already run out.
    #[test]
    fn a_contract_length_counts_from_the_opening_year() {
        for (opening_year, expected_end) in [(1962, "1965-06-30"), (2026, "2029-06-30")] {
            let player = generate_from_json(
                striker_json(serde_json::json!({ "contractLength": 3 })),
                opening_year,
            );

            assert_eq!(
                player.contract_end(),
                Some(expected_end),
                "a 3-year length opened in {opening_year}"
            );
            assert_eq!(player.contract_start(), None);
        }
    }

    #[test]
    fn a_contract_length_counts_from_an_authored_start() {
        let player = generate_from_json(
            striker_json(serde_json::json!({
                "contractStart": "2024-01-15",
                "contractLength": 2,
            })),
            2026,
        );

        assert_eq!(player.contract_start(), Some("2024-01-15"));
        assert_eq!(player.contract_end(), Some("2026-01-15"));
    }

    /// A start alone is half an interval. Rather than invent an end date, the engine
    /// rolls a length the way it always has, counted from the author's start, so the
    /// interval is whole and the start is the author's.
    #[test]
    fn a_start_with_no_end_keeps_the_start_and_rolls_a_length_from_it() {
        let player = generate_from_json(
            striker_json(serde_json::json!({ "contractStart": "2024-01-15" })),
            2026,
        );

        assert_eq!(player.contract_start(), Some("2024-01-15"));
        let end = player.contract_end().expect("an end was rolled");
        assert!(end > "2024-01-15", "ended {end}, not after the start");
        assert!(
            end <= "2029-01-15",
            "{end} is more than five years from the start"
        );
        assert!(
            end.ends_with("-01-15"),
            "{end}: the length should count in whole years from the start"
        );
    }

    #[test]
    fn an_authored_wage_and_value_are_kept() {
        let player = generate_from_json(
            striker_json(serde_json::json!({ "wage": 12_345, "value": 9_000_000 })),
            2026,
        );

        assert_eq!(player.wage(), 12_345);
        assert_eq!(player.market_value, 9_000_000);
    }

    /// Omit the wage and it is sized from what the player can do, whatever
    /// value the author wrote: pay follows ability, not the price tag.
    #[test]
    fn an_omitted_wage_follows_the_players_ability() {
        let player = generate_from_json(
            striker_json(serde_json::json!({ "value": 4_000_000 })),
            2026,
        );

        assert_eq!(player.market_value, 4_000_000);
        assert_eq!(
            player.wage(),
            crate::economy::valuation::market_wage(&player, None),
            "wage should be sized from the player's ability"
        );
    }

    /// Zero is a value, not an absence. A `0` that fell back to the roll would make
    /// it impossible to author a player on no wage or with no condition.
    #[test]
    fn an_explicit_zero_survives() {
        let player = generate_from_json(
            striker_json(serde_json::json!({ "wage": 0, "condition": 0, "morale": 0 })),
            2026,
        );

        assert_eq!(player.wage(), 0);
        assert_eq!(player.condition, 0);
        assert_eq!(player.morale, 0);
    }

    #[test]
    fn authored_status_and_identity_fields_are_kept() {
        let player = generate_from_json(
            striker_json(serde_json::json!({
                "condition": 64,
                "morale": 51,
                "weakFoot": 4,
                "alternatePositions": ["LeftWinger"],
                "careerHistory": [
                    { "season": 2019, "teamName": "Juventus",
                      "appearances": 30, "goals": 10, "assists": 5 },
                    { "season": 2020, "teamId": "club-x", "teamName": "Club X",
                      "appearances": 12, "goals": 1, "assists": 2 },
                ],
            })),
            2026,
        );

        assert_eq!(player.condition, 64);
        assert_eq!(player.morale, 51);
        assert_eq!(player.weak_foot, 4);
        assert_eq!(player.alternate_positions, vec![Position::LeftWinger]);
        assert_eq!(player.career.len(), 2);
        // A club that is not in the package has no id, and keeps its name.
        assert_eq!(player.career[0].team_id, "");
        assert_eq!(player.career[0].team_name, "Juventus");
        assert_eq!(player.career[0].goals, 10);
        assert_eq!(player.career[1].team_id, "club-x");
    }

    /// Everything here is optional, and leaving it out must change nothing: every
    /// package written before these fields existed has to generate as it always did.
    #[test]
    fn omitted_status_fields_are_still_generated() {
        let player = generate_from_json(striker_json(serde_json::json!({})), 2026);

        assert!(
            (75..100).contains(&player.condition),
            "condition {}",
            player.condition
        );
        assert!(
            (40..76).contains(&player.morale),
            "morale {}",
            player.morale
        );
        assert!(player.market_value > 0);
        assert!(player.wage() >= 500);
        assert!(player.contract_end().is_some());
        assert_eq!(player.contract_start(), None);
        assert!(
            player.career.is_empty(),
            "history is not invented for an authored player here"
        );
    }

    /// An authored weak foot and alternate positions have to survive the identity
    /// upgrade that runs when a career opens and when a save loads, or they would be
    /// accepted and then silently replaced. That holds for a specific position; for
    /// a general group (Midfielder, Forward, …) the upgrade re-infers them, which is
    /// why validation refuses the fields there rather than letting them be discarded.
    #[test]
    fn an_authored_weak_foot_and_alternates_survive_the_identity_upgrade() {
        let mut player = generate_from_json(
            striker_json(serde_json::json!({
                "weakFoot": 5,
                "alternatePositions": ["LeftWinger"],
            })),
            2026,
        );

        crate::player_identity::upgrade_player_identity(&mut player, None);

        assert_eq!(
            player.weak_foot, 5,
            "the identity upgrade replaced the authored weak foot"
        );
        assert_eq!(player.alternate_positions, vec![Position::LeftWinger]);
    }

    /// An authored ceiling is exact, not a suggestion.
    ///
    /// An `overall` is turned into a *jittered* attribute spread and the real ovr
    /// derived from that, so it lands near the target rather than on it. Since
    /// `refresh_player_derived` floors potential at ovr, a ceiling the author
    /// wrote could be quietly raised — measured at 26-32% for mid-range
    /// abilities, and every single time below the attribute clamp floor.
    #[test]
    fn an_authored_ceiling_is_never_raised_by_attribute_jitter() {
        for _ in 0..200 {
            let player = generate_from_json(
                serde_json::json!({
                    "id": "veteran",
                    "firstName": "Fin", "lastName": "Ished",
                    "club": "club-id", "nationality": "ENG", "position": "Striker",
                    "dateOfBirth": "1990-01-01",
                    "overall": 70,
                    "potential": 70,
                }),
                2026,
            );
            assert_eq!(
                player.potential, 70,
                "the authored ceiling was raised to match a jittered ovr of {}",
                player.ovr
            );
        }
    }

    /// The same, where it used to fail every time rather than sometimes.
    ///
    /// Attributes are clamped to a floor of 30 (`jitter(base, 8, 30, 97, ..)`),
    /// so a deliberately poor player could never be generated at the ability
    /// they were authored with, and their ceiling rose with it.
    #[test]
    fn a_deliberately_limited_player_keeps_their_low_ceiling() {
        let player = generate_from_json(
            serde_json::json!({
                "id": "journeyman",
                "firstName": "Jour", "lastName": "Neyman",
                "club": "club-id", "nationality": "ENG", "position": "Striker",
                "dateOfBirth": "1990-01-01",
                "overall": 10,
                "potential": 10,
            }),
            2026,
        );

        assert_eq!(player.potential, 10, "the authored ceiling was raised");
        assert!(
            player.ovr <= 10,
            "a player cannot be generated above their own ceiling, got ovr {}",
            player.ovr
        );
    }

    /// Authoring a ceiling for a youth prospect is the case the field exists for.
    #[test]
    fn a_youth_prospect_keeps_both_their_squad_role_and_their_ceiling() {
        let player = generate_from_json(
            serde_json::json!({
                "id": "academy-star",
                "firstName": "Academy", "lastName": "Star",
                "club": "club-id", "nationality": "ENG", "position": "AttackingMidfielder",
                "dateOfBirth": "2009-06-02",
                "overall": 58,
                "potential": 88,
                "youth": true,
            }),
            2026,
        );

        assert_eq!(player.potential, 88);
        assert_eq!(player.squad_role, domain::player::SquadRole::Youth);
    }

    /// Authoring a generational talent also authors the badge.
    ///
    /// `refresh_player_derived` awards Wonderkid from age, ceiling and headroom,
    /// so it follows from the ceiling rather than being set separately. The
    /// modding reference promises this; without a test the promise is unbacked.
    #[test]
    fn an_authored_ceiling_can_earn_the_wonderkid_trait() {
        let player = generate_from_json(
            serde_json::json!({
                "id": "generational",
                "firstName": "Gene", "lastName": "Rational",
                "club": "club-id", "nationality": "ENG", "position": "Striker",
                "dateOfBirth": "2009-01-01",
                "overall": 55,
                "potential": 92,
            }),
            2026,
        );

        assert!(
            player
                .traits
                .contains(&domain::player::PlayerTrait::Wonderkid),
            "17, ceiling 92, ovr {} — that is a wonderkid: {:?}",
            player.ovr,
            player.traits
        );
    }

    /// And only then. Otherwise every authored ceiling would earn the badge.
    #[test]
    fn an_authored_ceiling_alone_does_not_earn_the_wonderkid_trait() {
        // Old enough that the age gate refuses regardless of the ceiling.
        let veteran = generate_from_json(
            serde_json::json!({
                "id": "late-bloomer",
                "firstName": "Late", "lastName": "Bloomer",
                "club": "club-id", "nationality": "ENG", "position": "Striker",
                "dateOfBirth": "1996-01-01",
                "overall": 70,
                "potential": 95,
            }),
            2026,
        );
        assert!(
            !veteran
                .traits
                .contains(&domain::player::PlayerTrait::Wonderkid),
            "a 30-year-old is not a wonderkid whatever his ceiling: {:?}",
            veteran.traits
        );

        // Young, but the ceiling is nowhere near the elite threshold.
        let ordinary = generate_from_json(
            serde_json::json!({
                "id": "ordinary-prospect",
                "firstName": "Ordinary", "lastName": "Prospect",
                "club": "club-id", "nationality": "ENG", "position": "Striker",
                "dateOfBirth": "2009-01-01",
                "overall": 55,
                "potential": 70,
            }),
            2026,
        );
        assert!(
            !ordinary
                .traits
                .contains(&domain::player::PlayerTrait::Wonderkid),
            "a ceiling of 70 is not wonderkid territory: {:?}",
            ordinary.traits
        );
    }
}
