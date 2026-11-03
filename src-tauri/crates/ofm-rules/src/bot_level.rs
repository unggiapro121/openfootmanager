//! An online bot's squad brought up to the level of the league it plays in (phase 4, S-34,
//! analysis-bot-progression.md Dbp-1). A bot has no level of its own: the server asks this at a
//! season's opening for every bot seated in a league, with the league's level.
//!
//! The rule is a hidden balance rule: the target is the level's typical strength S(L)
//! ([`LevelCapRules::typical_strength`]) less an offset, read on the same top 18 as the club's
//! `strength_top18`. A squad short of `squad_target` players is filled first; then, while its top
//! 18 stays under the target, its weakest player is replaced by one drawn around the target. A
//! bot is only ever raised, never lowered, and never loses a player: a replacement is one out,
//! one in. Pure: the server draws the newcomers from these specs and pays for nothing.

use domain::player::{Player, Position};
use rand::{Rng, RngExt};
use serde::{Deserialize, Serialize};

use crate::level_caps::{LevelCapRules, avg_strength};
use crate::squad::{MIN_PLAYERS_PER_GROUP, group_index, thinnest_first};

/// The squad a filled bot aims for, per group (GK, DEF, MID, FWD): the server's squad-floor shape.
pub const FILL_SHAPE: [usize; 4] = [2, 6, 6, 4];

/// The values of a season's bot levelling (S-34 S34-1…S34-4, S34-11), all in a ruleset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BotLevelRules {
    /// The lowest league level whose bots are levelled.
    pub from_level: u32,
    /// The target is S(L) less this, in tenths of OVR.
    pub offset_tenths: u32,
    /// A squad within this of its target, in tenths, has no one replaced.
    pub tolerance_tenths: u32,
    /// A squad short of this many players is filled up to it.
    pub squad_target: u32,
    /// The most players a bot signs in a season's levelling, fills and replacements together.
    pub max_signings: u32,
    /// A newcomer's overall is drawn from the target less this, in tenths ...
    pub ovr_below_tenths: u32,
    /// ... to the target plus this, in tenths.
    pub ovr_above_tenths: u32,
    /// A newcomer's age, both ends included.
    pub youngest: u32,
    pub oldest: u32,
    /// No newcomer's potential goes above this.
    pub potential_max: u8,
    /// A replaced player this old retires; a younger one becomes a free agent.
    pub retire_from_age: u32,
    /// The safety net (S34-11 bản 2): a bot holding less than this share of its season's wages,
    /// in thousandths, is granted the rest of it. 0: no net.
    pub wage_cover_permille: u32,
}

impl Default for BotLevelRules {
    /// The values of S-34 bản 2.
    fn default() -> Self {
        Self {
            from_level: 2,
            offset_tenths: 10,
            tolerance_tenths: 5,
            squad_target: 22,
            max_signings: 8,
            ovr_below_tenths: 20,
            ovr_above_tenths: 40,
            youngest: 22,
            oldest: 29,
            potential_max: 90,
            retire_from_age: 31,
            wage_cover_permille: 500,
        }
    }
}

/// The lowest and highest overall a newcomer may be given, whatever the target.
const NEWCOMER_OVR_RANGE: (u8, u8) = (40, 90);

/// The top-18 strength, in tenths, a bot of a level-`level` league is brought to; `None` below
/// `from_level`, where bots are left as they are.
pub fn target_tenths(caps: &LevelCapRules, level: u32, rules: &BotLevelRules) -> Option<u32> {
    (level >= rules.from_level).then(|| {
        caps.typical_strength(level)
            .saturating_sub(rules.offset_tenths)
    })
}

/// One of a bot's players as the levelling reads him: `kept` players (its own young graduates,
/// those up for sale) are never replaced.
#[derive(Debug, Clone, Copy)]
pub struct RefreshMember<'a> {
    pub player: &'a Player,
    pub age: u32,
    pub kept: bool,
}

/// A player to draw: his position group, overall and age.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SigningSpec {
    pub group: Position,
    pub ovr: u8,
    pub age: u32,
}

/// A player let go (by id) and the one drawn in his place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Swap {
    pub out: String,
    pub signing: SigningSpec,
}

/// What a bot's levelling comes to: players added to fill the squad, then replacements.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RefreshPlan {
    pub fills: Vec<SigningSpec>,
    pub swaps: Vec<Swap>,
}

impl RefreshPlan {
    pub fn is_empty(&self) -> bool {
        self.fills.is_empty() && self.swaps.is_empty()
    }

    /// The players drawn, fills first, in the order the server numbers them.
    pub fn signings(&self) -> impl Iterator<Item = &SigningSpec> {
        self.fills
            .iter()
            .chain(self.swaps.iter().map(|swap| &swap.signing))
    }
}

/// A squad place in the plan: a player of the squad (by index) or a newcomer, with his overall.
#[derive(Debug, Clone, Copy)]
struct Place {
    member: Option<usize>,
    ovr: u8,
    group: usize,
}

/// The levelling of `squad` towards `target` (tenths): fill up to `squad_target`, the thinnest
/// group first against [`FILL_SHAPE`]; then, only when the top 18 is more than the tolerance
/// under the target, replace the weakest player not kept (the older first, then by id) by one of
/// his group, until the top 18 reaches the target or `max_signings` is used up. Retired players
/// are not part of the squad.
pub fn plan_refresh(
    squad: &[RefreshMember<'_>],
    target: u32,
    rules: &BotLevelRules,
    rng: &mut impl Rng,
) -> RefreshPlan {
    let mut places: Vec<Place> = squad
        .iter()
        .enumerate()
        .filter(|(_, member)| !member.player.retired)
        .map(|(index, member)| Place {
            member: Some(index),
            ovr: member.player.ovr,
            group: group_index(&member.player.position),
        })
        .collect();
    let mut plan = RefreshPlan::default();
    let mut left = rules.max_signings as usize;

    while places.len() < rules.squad_target as usize && left > 0 {
        let group = thinnest_group(&places);
        let signing = draw_signing(group, target, rules, rng);
        places.push(Place {
            member: None,
            ovr: signing.ovr,
            group: group_index(&signing.group),
        });
        plan.fills.push(signing);
        left -= 1;
    }

    if !below(&places, target.saturating_sub(rules.tolerance_tenths)) {
        return plan;
    }
    while below(&places, target) && left > 0 {
        let Some(slot) = weakest_replaceable(&places, squad) else {
            break;
        };
        let Some(index) = places[slot].member else {
            break;
        };
        let group = MIN_PLAYERS_PER_GROUP[places[slot].group].0.clone();
        let signing = draw_signing(group, target, rules, rng);
        places[slot] = Place {
            member: None,
            ovr: signing.ovr,
            group: places[slot].group,
        };
        plan.swaps.push(Swap {
            out: squad[index].player.id.clone(),
            signing,
        });
        left -= 1;
    }
    plan
}

/// Whether the top 18 of `places` averages under `tenths`, in whole numbers.
fn below(places: &[Place], tenths: u32) -> bool {
    let ovrs: Vec<u8> = places.iter().map(|place| place.ovr).collect();
    let (sum, count) = avg_strength(&ovrs);
    count == 0 || u64::from(sum) * 10 < u64::from(tenths) * u64::from(count)
}

/// The group a fill goes to: keepers while there are fewer than [`FILL_SHAPE`] asks (a club
/// whose only keeper is hurt still puts one in goal), then the group furthest under the shape.
fn thinnest_group(places: &[Place]) -> Position {
    let mut have = [0; 4];
    for place in places {
        have[place.group] += 1;
    }
    if have[0] < FILL_SHAPE[0] {
        return Position::Goalkeeper;
    }
    thinnest_first(have, FILL_SHAPE)
        .into_iter()
        .next()
        .unwrap_or(Position::Midfielder)
}

/// The place of the weakest player of the squad that may be replaced: not kept, not a newcomer;
/// the lowest overall, then the oldest, then by id.
fn weakest_replaceable(places: &[Place], squad: &[RefreshMember<'_>]) -> Option<usize> {
    places
        .iter()
        .enumerate()
        .filter_map(|(slot, place)| place.member.map(|index| (slot, &squad[index])))
        .filter(|(_, member)| !member.kept)
        .min_by(|(_, a), (_, b)| {
            a.player
                .ovr
                .cmp(&b.player.ovr)
                .then(b.age.cmp(&a.age))
                .then(a.player.id.cmp(&b.player.id))
        })
        .map(|(slot, _)| slot)
}

/// A newcomer of `group`: an overall drawn in tenths around `target`, rounded to the nearest
/// whole point, and an age between the rules' ends.
fn draw_signing(
    group: Position,
    target: u32,
    rules: &BotLevelRules,
    rng: &mut impl Rng,
) -> SigningSpec {
    let low = target.saturating_sub(rules.ovr_below_tenths);
    let high = target.saturating_add(rules.ovr_above_tenths).max(low);
    let tenths = rng.random_range(low..=high);
    let (floor, ceiling) = NEWCOMER_OVR_RANGE;
    let ovr = u8::try_from(tenths.saturating_add(5) / 10)
        .unwrap_or(ceiling)
        .clamp(floor, ceiling);
    let age = rng.random_range(rules.youngest..=rules.oldest.max(rules.youngest));
    SigningSpec { group, ovr, age }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seed::rng_from_u64;
    use crate::test_support::uniform_attributes;

    fn player(id: &str, position: Position, ovr: u8) -> Player {
        let mut player = Player::new(
            id.to_string(),
            id.to_string(),
            id.to_string(),
            "2000-01-01".to_string(),
            "ENG".to_string(),
            position,
            uniform_attributes(ovr),
        );
        player.ovr = ovr;
        player
    }

    /// 19 players, 2/6/6/5, everyone at `ovr` but the weakest of each group a point lower.
    fn squad_of_19(ovr: u8) -> Vec<Player> {
        let lines = [
            (Position::Goalkeeper, 2),
            (Position::CenterBack, 6),
            (Position::CentralMidfielder, 6),
            (Position::Striker, 5),
        ];
        lines
            .iter()
            .flat_map(|(position, count)| {
                (0..*count).map(move |n| {
                    let level = if n == 0 { ovr - 1 } else { ovr };
                    player(&format!("{position:?}-{n}"), position.clone(), level)
                })
            })
            .collect()
    }

    fn members(squad: &[Player], age: u32) -> Vec<RefreshMember<'_>> {
        squad
            .iter()
            .map(|player| RefreshMember {
                player,
                age,
                kept: false,
            })
            .collect()
    }

    fn top18_tenths(squad: &[Player], plan: &RefreshPlan) -> u32 {
        let out: Vec<&String> = plan.swaps.iter().map(|swap| &swap.out).collect();
        let mut ovrs: Vec<u8> = squad
            .iter()
            .filter(|player| !out.contains(&&player.id))
            .map(|player| player.ovr)
            .collect();
        ovrs.extend(plan.signings().map(|signing| signing.ovr));
        let (sum, count) = avg_strength(&ovrs);
        sum * 10 / count
    }

    /// Given the v10 level caps,
    /// when the target of a bot is asked at levels 1, 2, 6, 12 and 13,
    /// then level 1 has none and the others are S(L) less a point.
    #[test]
    fn a_bot_aims_a_point_under_its_level_s_typical_strength() {
        let caps = LevelCapRules::default();
        let rules = BotLevelRules::default();
        let at = |level| target_tenths(&caps, level, &rules);
        assert_eq!(at(1), None);
        assert_eq!(at(2), Some(610));
        assert_eq!(at(6), Some(685));
        assert_eq!(at(12), Some(765));
        assert_eq!(at(13), Some(775));
    }

    /// Given a 19-man bot squad around 64 and a target of 77,5,
    /// when it is levelled with 8 signings at most,
    /// then 3 fill it to 22 and 5 replace its five weakest, every newcomer between 75 and 82.
    #[test]
    fn a_weak_bot_is_filled_then_its_weakest_are_replaced() {
        let squad = squad_of_19(64);
        let plan = plan_refresh(
            &members(&squad, 30),
            775,
            &BotLevelRules::default(),
            &mut rng_from_u64(1),
        );

        assert_eq!(plan.fills.len(), 3);
        assert_eq!(plan.swaps.len(), 5);
        for signing in plan.signings() {
            assert!((75..=82).contains(&signing.ovr), "{signing:?}");
            assert!((22..=29).contains(&signing.age), "{signing:?}");
        }
        let weakest: Vec<&str> = squad
            .iter()
            .filter(|player| player.ovr == 63)
            .map(|player| player.id.as_str())
            .collect();
        for out in &plan.swaps[..4] {
            assert!(
                weakest.contains(&out.out.as_str()),
                "{} is not one of the weakest",
                out.out
            );
        }
    }

    /// Given a squad of 22 whose top 18 sits 0,2 under its target,
    /// when it is levelled,
    /// then no one is replaced: it is within the tolerance.
    #[test]
    fn a_bot_within_the_tolerance_keeps_its_players() {
        let mut squad = squad_of_19(78);
        squad
            .extend((0..3).map(|n| player(&format!("extra-{n}"), Position::CentralMidfielder, 77)));
        let plan = plan_refresh(
            &members(&squad, 30),
            780,
            &BotLevelRules::default(),
            &mut rng_from_u64(2),
        );

        assert!(plan.is_empty(), "{plan:?}");
    }

    /// Given a bot already above its target,
    /// when it is levelled,
    /// then nothing changes: a bot is never lowered.
    #[test]
    fn a_strong_bot_is_never_lowered() {
        let mut squad = squad_of_19(80);
        squad.extend((0..3).map(|n| player(&format!("extra-{n}"), Position::Striker, 80)));
        let plan = plan_refresh(
            &members(&squad, 25),
            700,
            &BotLevelRules::default(),
            &mut rng_from_u64(3),
        );

        assert!(plan.is_empty());
    }

    /// Given a weak squad of 22 whose weakest player is a goalkeeper,
    /// when it is levelled,
    /// then the keeper is replaced by a keeper and every replacement keeps its group.
    #[test]
    fn a_replacement_plays_in_the_group_of_the_player_he_replaces() {
        let mut squad = squad_of_19(65);
        squad.extend((0..3).map(|n| player(&format!("extra-{n}"), Position::Defender, 65)));
        squad[0].ovr = 50;
        let plan = plan_refresh(
            &members(&squad, 28),
            760,
            &BotLevelRules::default(),
            &mut rng_from_u64(4),
        );

        assert_eq!(plan.swaps[0].out, squad[0].id);
        assert_eq!(plan.swaps[0].signing.group, Position::Goalkeeper);
        for swap in &plan.swaps {
            let out = squad
                .iter()
                .find(|player| player.id == swap.out)
                .map(|player| group_index(&player.position));
            assert_eq!(out, Some(group_index(&swap.signing.group)));
        }
    }

    /// Given a weak squad whose weakest player is kept (a young graduate),
    /// when it is levelled,
    /// then he stays and the next weakest goes; on equal overalls the older goes first.
    #[test]
    fn kept_players_stay_and_the_older_goes_first() {
        let mut squad = squad_of_19(65);
        squad.extend((0..3).map(|n| player(&format!("extra-{n}"), Position::Defender, 65)));
        squad[2].ovr = 50;
        let mut squad_members = members(&squad, 25);
        squad_members[2].kept = true;
        squad_members[0].age = 33;
        let plan = plan_refresh(
            &squad_members,
            760,
            &BotLevelRules::default(),
            &mut rng_from_u64(5),
        );

        assert!(plan.swaps.iter().all(|swap| swap.out != squad[2].id));
        // The keeper, the midfielder and the striker numbered 0 are all 64: the keeper is 33.
        assert_eq!(plan.swaps[0].out, squad[0].id, "{plan:?}");
    }

    /// Given a weak squad and only 2 signings allowed,
    /// when it is levelled,
    /// then it stops after 2, short of its target.
    #[test]
    fn the_levelling_stops_at_its_most_signings() {
        let mut squad = squad_of_19(60);
        squad.extend((0..3).map(|n| player(&format!("extra-{n}"), Position::Defender, 60)));
        let rules = BotLevelRules {
            max_signings: 2,
            ..BotLevelRules::default()
        };
        let plan = plan_refresh(&members(&squad, 25), 775, &rules, &mut rng_from_u64(6));

        assert_eq!(plan.swaps.len(), 2);
        assert!(top18_tenths(&squad, &plan) < 775);
    }

    /// Given a weak squad and plenty of signings,
    /// when it is levelled,
    /// then its top 18 ends at or above the target.
    #[test]
    fn a_levelled_bot_reaches_its_target() {
        let mut squad = squad_of_19(72);
        squad.extend((0..3).map(|n| player(&format!("extra-{n}"), Position::Defender, 72)));
        let rules = BotLevelRules {
            max_signings: 30,
            ..BotLevelRules::default()
        };
        let plan = plan_refresh(&members(&squad, 25), 765, &rules, &mut rng_from_u64(7));

        assert!(top18_tenths(&squad, &plan) >= 765);
        assert!(plan.swaps.len() < 22);
    }

    /// Given a squad of 16 with no keeper,
    /// when it is filled,
    /// then the first two fills are keepers.
    #[test]
    fn a_fill_goes_to_the_thinnest_group_first() {
        let squad: Vec<Player> = (0..16)
            .map(|n| player(&format!("cb-{n}"), Position::CenterBack, 80))
            .collect();
        let plan = plan_refresh(
            &members(&squad, 25),
            700,
            &BotLevelRules::default(),
            &mut rng_from_u64(8),
        );

        assert_eq!(plan.fills.len(), 6);
        assert_eq!(plan.fills[0].group, Position::Goalkeeper);
        assert_eq!(plan.fills[1].group, Position::Goalkeeper);
    }

    /// Given the same squad and seed twice,
    /// when it is levelled,
    /// then the plans are the same.
    #[test]
    fn the_same_seed_levels_the_same_way() {
        let squad = squad_of_19(62);
        let plan = |seed| {
            plan_refresh(
                &members(&squad, 25),
                775,
                &BotLevelRules::default(),
                &mut rng_from_u64(seed),
            )
        };
        assert_eq!(plan(9), plan(9));
    }

    /// Given a ruleset written with the bot levelling,
    /// then it reads back as the same values, and an unknown field is refused.
    #[test]
    fn the_rules_read_back_from_camel_case() {
        let rules = BotLevelRules::default();
        let json = serde_json::to_value(rules).unwrap();
        assert_eq!(json["fromLevel"], 2);
        assert_eq!(json["wageCoverPermille"], 500);
        assert_eq!(
            serde_json::from_value::<BotLevelRules>(json).unwrap(),
            rules
        );
        assert!(serde_json::from_str::<BotLevelRules>(r#"{"fromLevel":2,"other":1}"#).is_err());
    }
}
