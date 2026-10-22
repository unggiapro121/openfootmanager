//! A club's yearly youth intake, the planning half (phase 3, E3-5b): how many youngsters a club
//! takes, where they play, and whether one is a top talent — from its academy and its scouting
//! alone. Shared with the online server; `ofm_core::youth_intake` generates and signs them.

use crate::squad::{group_index, thinnest_first};
use domain::player::{Player, Position};
use domain::team::Team;
use rand::RngExt;

/// Academy players a club aims to hold in each position group, in the squad
/// floor's `[GK, DEF, MID, FWD]` order. Shaped like a squad, a keeper included,
/// so the players who graduate from it can replace the ones who retire.
pub const ACADEMY_TARGET_PER_GROUP: [usize; 4] = [1, 2, 2, 1];

/// Youngsters every club takes in a season, however full its academy is. A
/// club always renews itself a little; the minimum is what keeps one whose
/// academy is full from going a whole season without a newcomer.
pub const MIN_INTAKE: usize = 1;

/// Youngsters a club takes in a season at most, however empty its academy is.
/// A club rebuilding an academy does it over a few seasons, not in one summer.
pub const MAX_INTAKE: usize = 3;

/// Which youngsters a club takes in this season: one position group per
/// recruit, a keeper first when the academy has none.
///
/// Pure and free: what the finance epic will attach an academy cost to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntakePlan {
    pub groups: Vec<Position>,
}

/// The intake a club with `academy` takes: as many youngsters as it is short of
/// [`ACADEMY_TARGET_PER_GROUP`], between [`MIN_INTAKE`] and [`MAX_INTAKE`]; a
/// keeper first when it has none, then its thinnest groups.
pub fn plan_for<'a>(academy: impl IntoIterator<Item = &'a Player>) -> IntakePlan {
    let mut have = [0usize; 4];
    for player in academy {
        have[group_index(&player.position)] += 1;
    }
    let size = intake_size(have);

    let keeper = group_index(&Position::Goalkeeper);
    let mut groups = Vec::with_capacity(size);
    if have[keeper] == 0 {
        groups.push(Position::Goalkeeper);
        have[keeper] += 1;
    }
    while groups.len() < size {
        let thinnest = thinnest_first(have, ACADEMY_TARGET_PER_GROUP).remove(0);
        have[group_index(&thinnest)] += 1;
        groups.push(thinnest);
    }
    IntakePlan { groups }
}

/// How many youngsters a club whose academy holds `have` per group takes: what
/// it lacks of [`ACADEMY_TARGET_PER_GROUP`], between [`MIN_INTAKE`] and
/// [`MAX_INTAKE`]. The one place an intake's size is decided.
pub fn intake_size(have: [usize; 4]) -> usize {
    let lacking: usize = ACADEMY_TARGET_PER_GROUP
        .iter()
        .zip(have)
        .map(|(target, have)| target.saturating_sub(have))
        .sum();
    lacking.clamp(MIN_INTAKE, MAX_INTAKE)
}

/// Which of `plan`'s recruits, if any, is the intake's top talent: once an
/// intake, at the chance `team`'s scouting department gives.
pub fn top_talent_index(team: &Team, plan: &IntakePlan, rng: &mut impl rand::Rng) -> Option<usize> {
    let chance = crate::facilities::intake_top_talent_per_mille(team.facilities.scouting);
    (!plan.groups.is_empty() && rng.random_range(0..1000) < chance)
        .then(|| rng.random_range(0..plan.groups.len()))
}
